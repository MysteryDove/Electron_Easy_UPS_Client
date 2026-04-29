export type ShutdownPolicyVersion = 1;

export type ShutdownPolicyMode = 'simple' | 'advanced';

export type ShutdownPolicySeverity =
  | 'info'
  | 'warning'
  | 'critical'
  | 'forced';

export type ShutdownPolicyRuleCreator = 'system' | 'user' | 'migration';

export type ShutdownMethod = 'shutdown' | 'sleep';

export type PolicyOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'includes'
  | 'notIncludes'
  | 'exists'
  | 'notExists';

export type PolicyField =
  | 'ups.online'
  | 'ups.onBattery'
  | 'ups.lowBattery'
  | 'ups.fsd'
  | 'ups.statusTokens'
  | 'battery.chargePercent'
  | 'battery.runtimeSeconds'
  | 'connection.state'
  | 'connection.secondsSinceLastSuccessfulPoll'
  | 'state.secondsOnBattery'
  | 'state.secondsOnline'
  | 'state.secondsLowBattery'
  | 'state.secondsInFsd'
  | 'state.activeCountdownRuleId';

export type PolicyCondition =
  | {
      all: PolicyCondition[];
    }
  | {
      any: PolicyCondition[];
    }
  | {
      not: PolicyCondition;
    }
  | {
      field: PolicyField;
      op: PolicyOperator;
      value?: string | number | boolean;
    };

export type ShutdownPolicyAction =
  | {
      type: 'showWarning';
      message?: string;
    }
  | {
      type: 'showCriticalAlert';
      message?: string;
    }
  | {
      type: 'startShutdownCountdown';
      countdownSeconds: number;
      method: ShutdownMethod;
    }
  | {
      type: 'shutdownNow';
      method: ShutdownMethod;
    }
  | {
      type: 'cancelShutdownCountdown';
    };

export type ShutdownPolicyRule = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  severity: ShutdownPolicySeverity;
  trigger: PolicyCondition;
  holdForSeconds?: number;
  action: ShutdownPolicyAction;
  cancelWhen?: PolicyCondition | null;
  cooldownSeconds?: number;
  createdBy: ShutdownPolicyRuleCreator;
};

export type ShutdownPolicySafety = {
  requireHoldForShutdownSeconds: number;
  maxCountdownSeconds: number;
  allowImmediateShutdown: boolean;
  allowFsdAutoCancel: boolean;
};

export type ShutdownPolicyConfig = {
  version: ShutdownPolicyVersion;
  mode: ShutdownPolicyMode;
  rules: ShutdownPolicyRule[];
  safety: ShutdownPolicySafety;
};

export type ShutdownPolicyConnectionState =
  | 'connected'
  | 'degraded'
  | 'disconnected';

export type ShutdownPolicyPlatform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd';

export type ShutdownPolicyContext = {
  now: number;
  ups: {
    online: boolean;
    onBattery: boolean;
    lowBattery: boolean;
    fsd: boolean;
    statusTokens: string[];
  };
  battery: {
    chargePercent?: number;
    runtimeSeconds?: number;
    voltage?: number;
  };
  connection: {
    state: ShutdownPolicyConnectionState;
    secondsSinceLastSuccessfulPoll: number;
  };
  state: {
    secondsOnBattery: number;
    secondsOnline: number;
    secondsLowBattery: number;
    secondsInFsd: number;
    activeCountdownRuleId?: string;
  };
};

export type ConditionEvaluationResult = {
  matched: boolean;
  reason: string;
  actualValue?: unknown;
  expectedValue?: unknown;
  children?: ConditionEvaluationResult[];
};

export type ShutdownPolicyDecision =
  | { type: 'none' }
  | { type: 'showWarning'; ruleId: string; message?: string }
  | { type: 'showCriticalAlert'; ruleId: string; message?: string }
  | {
      type: 'startShutdownCountdown';
      ruleId: string;
      countdownSeconds: number;
      method: ShutdownMethod;
      cancelWhen?: PolicyCondition | null;
    }
  | {
      type: 'shutdownNow';
      ruleId: string;
      method: ShutdownMethod;
    }
  | {
      type: 'cancelShutdownCountdown';
      ruleId: string;
      reason: string;
    };

export type ShutdownPolicyDecisionLogEvent =
  | 'decision'
  | 'execution'
  | 'cancellation'
  | 'failure';

export type ShutdownPolicyDecisionLogContext = {
  statusTokens: string[];
  batteryChargePercent?: number;
  runtimeSeconds?: number;
  connectionState: ShutdownPolicyConnectionState;
  secondsSinceLastSuccessfulPoll: number;
  secondsOnBattery: number;
  activeCountdownRuleId?: string;
};

export type ShutdownPolicyDecisionLogEntry = {
  id: string;
  timestampIso: string;
  event: ShutdownPolicyDecisionLogEvent;
  decision: ShutdownPolicyDecision;
  ruleId?: string;
  ruleName?: string;
  summary: string;
  conditionExplanation?: string[];
  context: ShutdownPolicyDecisionLogContext;
  execution?: {
    method: ShutdownMethod;
    platform: ShutdownPolicyPlatform;
    supported: boolean;
    success: boolean;
    command?: string;
    message?: string;
    errorMessage?: string;
  };
};
