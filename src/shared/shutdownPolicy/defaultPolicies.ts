import type {
  PolicyCondition,
  ShutdownMethod,
  ShutdownPolicyConfig,
  ShutdownPolicyRule,
} from './types';

export const DEFAULT_BATTERY_WARNING_RULE_ID = 'default-battery-warning';
export const DEFAULT_BATTERY_SHUTDOWN_RULE_ID = 'default-battery-shutdown';
export const DEFAULT_FSD_SHUTDOWN_RULE_ID = 'default-fsd-shutdown';
export const DEFAULT_COMMUNICATION_LOSS_RULE_ID =
  'default-comms-lost-on-battery';

export type LegacyBatteryShutdownPolicyInput = {
  warningPct: number;
  shutdownPct: number;
  warningToastEnabled: boolean;
  shutdownEnabled: boolean;
  criticalAlertEnabled: boolean;
  criticalShutdownAlertEnabled: boolean;
  shutdownCountdownSeconds: number;
  shutdownMethod: ShutdownMethod;
};

export type LegacyFsdShutdownPolicyInput = {
  shutdownEnabled: boolean;
  shutdownDelaySeconds: number;
  shutdownMethod: ShutdownMethod;
  overlayEnabled: boolean;
};

export type LegacyShutdownPolicyInput = {
  battery: LegacyBatteryShutdownPolicyInput;
  fsd: LegacyFsdShutdownPolicyInput;
};

export type CommunicationLossPolicyInput = {
  enabled?: boolean;
  secondsOnBattery?: number;
  secondsSinceLastSuccessfulPoll?: number;
  countdownSeconds?: number;
  method?: ShutdownMethod;
};

export type RuntimeRemainingPolicyInput = {
  id?: string;
  name?: string;
  enabled?: boolean;
  runtimeSeconds?: number;
  countdownSeconds?: number;
  method?: ShutdownMethod;
};

export type SimpleShutdownPolicyInput = LegacyShutdownPolicyInput & {
  communicationLoss?: CommunicationLossPolicyInput;
  mode?: ShutdownPolicyConfig['mode'];
};

export function createBatteryWarningPolicy(
  battery: LegacyBatteryShutdownPolicyInput,
): ShutdownPolicyRule {
  return {
    id: DEFAULT_BATTERY_WARNING_RULE_ID,
    name: 'Warn when battery is low while on battery',
    enabled: battery.warningToastEnabled || battery.criticalAlertEnabled,
    priority: 50,
    severity: 'warning',
    trigger: {
      all: [
        { field: 'ups.onBattery', op: 'eq', value: true },
        lowBatteryPercentOrTokenCondition(battery.warningPct),
      ],
    },
    holdForSeconds: 0,
    action: {
      type: 'showWarning',
    },
    cancelWhen: {
      field: 'ups.online',
      op: 'eq',
      value: true,
    },
    cooldownSeconds: 0,
    createdBy: 'migration',
  };
}

export function createBatteryShutdownPolicy(
  battery: LegacyBatteryShutdownPolicyInput,
): ShutdownPolicyRule {
  const action = createLegacyBatteryShutdownAction(battery);

  return {
    id: DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
    name: 'Shutdown when battery is critically low while on battery',
    enabled: battery.shutdownEnabled || battery.criticalShutdownAlertEnabled,
    priority: 100,
    severity: 'critical',
    trigger: {
      all: [
        { field: 'ups.onBattery', op: 'eq', value: true },
        lowBatteryPercentOrTokenCondition(battery.shutdownPct),
      ],
    },
    holdForSeconds: 0,
    action,
    cancelWhen: {
      any: [
        {
          all: [
            { field: 'ups.online', op: 'eq', value: true },
            { field: 'ups.fsd', op: 'eq', value: false },
          ],
        },
        {
          field: 'battery.chargePercent',
          op: 'gt',
          value: battery.warningPct + 5,
        },
      ],
    },
    cooldownSeconds: 0,
    createdBy: 'migration',
  };
}

export function createFsdShutdownPolicy(
  fsd: LegacyFsdShutdownPolicyInput,
): ShutdownPolicyRule {
  const action = !fsd.shutdownEnabled
    ? { type: 'showCriticalAlert' as const }
    : fsd.overlayEnabled
      ? {
        type: 'startShutdownCountdown' as const,
        countdownSeconds: fsd.shutdownDelaySeconds,
        method: fsd.shutdownMethod,
      }
      : {
        type: 'shutdownNow' as const,
        method: fsd.shutdownMethod,
      };

  return {
    id: DEFAULT_FSD_SHUTDOWN_RULE_ID,
    name: 'Shutdown when UPS reports FSD',
    enabled: fsd.shutdownEnabled,
    priority: 1000,
    severity: 'forced',
    trigger: {
      field: 'ups.fsd',
      op: 'eq',
      value: true,
    },
    holdForSeconds: 0,
    action,
    cancelWhen: null,
    cooldownSeconds: 0,
    createdBy: 'migration',
  };
}

function createLegacyBatteryShutdownAction(
  battery: LegacyBatteryShutdownPolicyInput,
): ShutdownPolicyRule['action'] {
  if (!battery.shutdownEnabled) {
    return {
      type: 'showCriticalAlert',
    };
  }

  if (!battery.criticalShutdownAlertEnabled) {
    return {
      type: 'shutdownNow',
      method: battery.shutdownMethod,
    };
  }

  return {
    type: 'startShutdownCountdown',
    countdownSeconds: battery.shutdownCountdownSeconds,
    method: battery.shutdownMethod,
  };
}

export function createCommunicationLossPolicy(
  input: CommunicationLossPolicyInput = {},
): ShutdownPolicyRule {
  const secondsOnBattery = input.secondsOnBattery ?? 60;
  const secondsSinceLastSuccessfulPoll =
    input.secondsSinceLastSuccessfulPoll ?? 300;
  const countdownSeconds = input.countdownSeconds ?? 60;

  return {
    id: DEFAULT_COMMUNICATION_LOSS_RULE_ID,
    name: 'Shutdown if communication is lost while previously on battery',
    enabled: input.enabled ?? false,
    priority: 200,
    severity: 'critical',
    trigger: {
      all: [
        {
          field: 'state.secondsOnBattery',
          op: 'gte',
          value: secondsOnBattery,
        },
        {
          field: 'connection.secondsSinceLastSuccessfulPoll',
          op: 'gte',
          value: secondsSinceLastSuccessfulPoll,
        },
      ],
    },
    holdForSeconds: 0,
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds,
      method: input.method ?? 'shutdown',
    },
    cancelWhen: {
      all: [
        { field: 'connection.state', op: 'eq', value: 'connected' },
        { field: 'ups.online', op: 'eq', value: true },
      ],
    },
    cooldownSeconds: 0,
    createdBy: 'system',
  };
}

export function createRuntimeRemainingPolicy(
  input: RuntimeRemainingPolicyInput = {},
): ShutdownPolicyRule {
  const runtimeSeconds = input.runtimeSeconds ?? 300;
  const countdownSeconds = input.countdownSeconds ?? 60;

  return {
    id: input.id ?? 'default-runtime-remaining-shutdown',
    name: input.name ?? 'Shutdown when runtime remaining is low while on battery',
    enabled: input.enabled ?? false,
    priority: 150,
    severity: 'critical',
    trigger: {
      all: [
        { field: 'ups.onBattery', op: 'eq', value: true },
        {
          field: 'battery.runtimeSeconds',
          op: 'lte',
          value: runtimeSeconds,
        },
      ],
    },
    holdForSeconds: 0,
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds,
      method: input.method ?? 'shutdown',
    },
    cancelWhen: {
      all: [
        { field: 'ups.online', op: 'eq', value: true },
        { field: 'ups.fsd', op: 'eq', value: false },
      ],
    },
    cooldownSeconds: 0,
    createdBy: 'system',
  };
}

export function createSimpleShutdownPolicyConfig(
  input: SimpleShutdownPolicyInput,
  existing?: ShutdownPolicyConfig,
): ShutdownPolicyConfig {
  const requiresImmediateShutdown = simplePolicyRequiresImmediateShutdown(input);

  return {
    version: 1,
    mode: input.mode ?? existing?.mode ?? 'simple',
    safety: {
      requireHoldForShutdownSeconds: 0,
      maxCountdownSeconds: existing?.safety.maxCountdownSeconds ?? 300,
      allowImmediateShutdown:
        existing?.safety.allowImmediateShutdown === true ||
        requiresImmediateShutdown,
      allowFsdAutoCancel: existing?.safety.allowFsdAutoCancel ?? false,
    },
    rules: [
      createBatteryWarningPolicy(input.battery),
      createBatteryShutdownPolicy(input.battery),
      createFsdShutdownPolicy(input.fsd),
      createCommunicationLossPolicy(input.communicationLoss),
    ],
  };
}

function simplePolicyRequiresImmediateShutdown(
  input: SimpleShutdownPolicyInput,
): boolean {
  return (
    (input.battery.shutdownEnabled && !input.battery.criticalShutdownAlertEnabled) ||
    (input.fsd.shutdownEnabled && !input.fsd.overlayEnabled)
  );
}

export function getRuleById(
  config: ShutdownPolicyConfig,
  ruleId: string,
): ShutdownPolicyRule | undefined {
  return config.rules.find((rule) => rule.id === ruleId);
}

export function getNumericConditionValue(
  condition: PolicyCondition,
  field: string,
): number | undefined {
  if ('all' in condition) {
    return getNumericConditionValueFromGroup(condition.all, field);
  }

  if ('any' in condition) {
    return getNumericConditionValueFromGroup(condition.any, field);
  }

  if ('not' in condition) {
    return getNumericConditionValue(condition.not, field);
  }

  if (condition.field === field && typeof condition.value === 'number') {
    return condition.value;
  }

  return undefined;
}

function lowBatteryPercentOrTokenCondition(thresholdPct: number): PolicyCondition {
  return {
    any: [
      {
        field: 'battery.chargePercent',
        op: 'lte',
        value: thresholdPct,
      },
      {
        field: 'ups.lowBattery',
        op: 'eq',
        value: true,
      },
    ],
  };
}

function getNumericConditionValueFromGroup(
  conditions: PolicyCondition[],
  field: string,
): number | undefined {
  for (const condition of conditions) {
    const value = getNumericConditionValue(condition, field);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}
