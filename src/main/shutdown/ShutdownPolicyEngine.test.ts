import { describe, expect, it } from 'vitest';
import type {
  ShutdownPolicyConfig,
  ShutdownPolicyContext,
  ShutdownPolicyRule,
} from '../../shared/shutdownPolicy/types';
import { defaultShutdownPolicyConfig } from './schema/shutdownPolicySchema';
import { ShutdownPolicyEngine } from './ShutdownPolicyEngine';

describe('ShutdownPolicyEngine', () => {
  it('waits for hold duration before producing a decision', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeRule({
        id: 'held-warning',
        action: { type: 'showWarning' },
        holdForSeconds: 5,
      }),
    ]));

    expect(engine.evaluate(makeContext({ now: 0 })).type).toBe('none');
    expect(engine.evaluate(makeContext({ now: 4000 })).type).toBe('none');
    expect(engine.evaluate(makeContext({ now: 5000 }))).toEqual({
      type: 'showWarning',
      ruleId: 'held-warning',
      message: undefined,
    });
  });

  it('applies rule cooldown after a decision is emitted', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeRule({
        id: 'cooldown-warning',
        action: { type: 'showWarning' },
        cooldownSeconds: 10,
      }),
    ]));

    expect(engine.evaluate(makeContext({ now: 0 })).type).toBe('showWarning');
    expect(engine.evaluate(makeContext({ now: 5000 })).type).toBe('none');
    expect(engine.evaluate(makeContext({ now: 11000 })).type).toBe('showWarning');
  });

  it('resolves matching rules by priority, severity, then stable order', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeRule({
        id: 'first',
        priority: 100,
        severity: 'warning',
        action: { type: 'showWarning' },
      }),
      makeRule({
        id: 'second',
        priority: 200,
        severity: 'info',
        action: { type: 'showCriticalAlert' },
      }),
      makeRule({
        id: 'third',
        priority: 200,
        severity: 'critical',
        action: { type: 'showWarning' },
      }),
    ]));

    expect(engine.evaluate(makeContext({ now: 0 }))).toEqual({
      type: 'showWarning',
      ruleId: 'third',
      message: undefined,
    });
  });

  it('uses original rule order as the final tie-breaker', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeRule({
        id: 'first',
        priority: 100,
        severity: 'warning',
        action: { type: 'showWarning' },
      }),
      makeRule({
        id: 'second',
        priority: 100,
        severity: 'warning',
        action: { type: 'showCriticalAlert' },
      }),
    ]));

    expect(engine.evaluate(makeContext({ now: 0 }))).toEqual({
      type: 'showWarning',
      ruleId: 'first',
      message: undefined,
    });
  });

  it('cancels an active countdown when cancelWhen matches', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeBatteryCountdownRule(),
    ]));

    expect(engine.evaluate(makeContext({
      now: 0,
      battery: { chargePercent: 10 },
    }))).toEqual({
      type: 'startShutdownCountdown',
      ruleId: 'battery-countdown',
      countdownSeconds: 60,
      method: 'shutdown',
      cancelWhen: {
        all: [
          { field: 'ups.online', op: 'eq', value: true },
          { field: 'ups.fsd', op: 'eq', value: false },
        ],
      },
    });

    expect(engine.evaluate(makeContext({
      now: 1000,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: false,
        statusTokens: ['OL'],
      },
    }))).toEqual({
      type: 'cancelShutdownCountdown',
      ruleId: 'battery-countdown',
      reason: 'All conditions matched',
    });
  });

  it('does not emit duplicate countdown decisions while the same countdown is active', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeBatteryCountdownRule(),
    ]));

    expect(engine.evaluate(makeContext({
      now: 0,
      battery: { chargePercent: 10 },
    })).type).toBe('startShutdownCountdown');

    expect(engine.evaluate(makeContext({
      now: 1000,
      battery: { chargePercent: 10 },
    }))).toEqual({ type: 'none' });
  });

  it('does not let a lower-ranked shutdown rule override active countdown cancellation', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeBatteryCountdownRule(),
      makeRule({
        id: 'lower-online-countdown',
        priority: 50,
        severity: 'forced',
        trigger: { field: 'ups.online', op: 'eq', value: true },
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 30,
          method: 'shutdown',
        },
        cancelWhen: null,
      }),
    ]));

    expect(engine.evaluate(makeContext({
      now: 0,
      battery: { chargePercent: 10 },
    })).type).toBe('startShutdownCountdown');

    expect(engine.evaluate(makeContext({
      now: 1000,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: false,
        statusTokens: ['OL'],
      },
    }))).toEqual({
      type: 'cancelShutdownCountdown',
      ruleId: 'battery-countdown',
      reason: 'All conditions matched',
    });
  });

  it('clears an active countdown when an explicit cancel rule wins', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeRule({
        id: 'manual-countdown',
        priority: 100,
        severity: 'critical',
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 60,
          method: 'shutdown',
        },
        cancelWhen: null,
      }),
      makeRule({
        id: 'manual-cancel',
        priority: 200,
        severity: 'critical',
        trigger: { field: 'ups.online', op: 'eq', value: true },
        action: { type: 'cancelShutdownCountdown' },
      }),
    ]));

    expect(engine.evaluate(makeContext({ now: 0 }))).toMatchObject({
      type: 'startShutdownCountdown',
      ruleId: 'manual-countdown',
    });

    expect(engine.evaluate(makeContext({
      now: 1000,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: false,
        statusTokens: ['OL'],
      },
    }))).toEqual({
      type: 'cancelShutdownCountdown',
      ruleId: 'manual-cancel',
      reason: 'Rule action requested countdown cancellation',
    });

    expect(engine.evaluate(makeContext({ now: 2000 }))).toMatchObject({
      type: 'startShutdownCountdown',
      ruleId: 'manual-countdown',
    });
  });

  it('lets FSD override an active battery countdown instead of cancelling it', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeBatteryCountdownRule(),
      makeFsdCountdownRule(),
    ]));

    expect(engine.evaluate(makeContext({
      now: 0,
      battery: { chargePercent: 10 },
    }))).toMatchObject({ ruleId: 'battery-countdown' });

    expect(engine.evaluate(makeContext({
      now: 1000,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: true,
        statusTokens: ['OL', 'FSD'],
      },
    }))).toEqual({
      type: 'startShutdownCountdown',
      ruleId: 'fsd-countdown',
      countdownSeconds: 30,
      method: 'shutdown',
      cancelWhen: null,
    });
  });

  it('does not cancel a non-cancellable active FSD countdown when UPS returns online', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeFsdCountdownRule(),
    ]));

    expect(engine.evaluate(makeContext({
      now: 0,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: true,
        statusTokens: ['OL', 'FSD'],
      },
    }))).toMatchObject({ ruleId: 'fsd-countdown' });

    expect(engine.evaluate(makeContext({
      now: 1000,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: false,
        statusTokens: ['OL'],
      },
    }))).toEqual({ type: 'none' });
  });

  it('lets shutdownNow override and clear an active countdown', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeBatteryCountdownRule(),
      makeFsdImmediateRule(),
    ]));

    expect(engine.evaluate(makeContext({
      now: 0,
      battery: { chargePercent: 10 },
    }))).toMatchObject({
      type: 'startShutdownCountdown',
      ruleId: 'battery-countdown',
    });

    expect(engine.evaluate(makeContext({
      now: 1000,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: true,
        statusTokens: ['OL', 'FSD'],
      },
    }))).toEqual({
      type: 'shutdownNow',
      ruleId: 'fsd-immediate',
      method: 'shutdown',
    });

    expect(engine.evaluate(makeContext({
      now: 2000,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: false,
        statusTokens: ['OL'],
      },
    }))).toEqual({ type: 'none' });
  });

  it('triggers runtime remaining shutdown only while UPS is on battery', () => {
    const engine = new ShutdownPolicyEngine(makeConfig([
      makeRuntimeCountdownRule(),
    ]));

    expect(engine.evaluate(makeContext({
      now: 0,
      ups: {
        online: true,
        onBattery: false,
        lowBattery: false,
        fsd: false,
        statusTokens: ['OL'],
      },
      battery: { runtimeSeconds: 120 },
    }))).toEqual({ type: 'none' });

    expect(engine.evaluate(makeContext({
      now: 1000,
      battery: { runtimeSeconds: 120 },
    }))).toEqual({
      type: 'startShutdownCountdown',
      ruleId: 'runtime-countdown',
      countdownSeconds: 45,
      method: 'sleep',
      cancelWhen: {
        all: [
          { field: 'ups.online', op: 'eq', value: true },
          { field: 'ups.fsd', op: 'eq', value: false },
        ],
      },
    });
  });

  it('only triggers the communication-loss fail-safe when the rule is enabled', () => {
    const disabledEngine = new ShutdownPolicyEngine(makeConfig([
      makeCommunicationLossRule({ enabled: false }),
    ]));
    const enabledEngine = new ShutdownPolicyEngine(makeConfig([
      makeCommunicationLossRule({ enabled: true }),
    ]));
    const context = makeContext({
      now: 0,
      ups: {
        online: false,
        onBattery: false,
        lowBattery: false,
        fsd: false,
        statusTokens: [],
      },
      connection: {
        state: 'disconnected',
        secondsSinceLastSuccessfulPoll: 300,
      },
      state: {
        secondsOnBattery: 60,
        secondsOnline: 0,
        secondsLowBattery: 0,
        secondsInFsd: 0,
      },
    });

    expect(disabledEngine.evaluate(context)).toEqual({ type: 'none' });
    expect(enabledEngine.evaluate(context)).toEqual({
      type: 'startShutdownCountdown',
      ruleId: 'communication-loss',
      countdownSeconds: 60,
      method: 'shutdown',
      cancelWhen: {
        all: [
          { field: 'connection.state', op: 'eq', value: 'connected' },
          { field: 'ups.online', op: 'eq', value: true },
        ],
      },
    });
  });
});

function makeConfig(rules: ShutdownPolicyRule[]): ShutdownPolicyConfig {
  return {
    ...defaultShutdownPolicyConfig,
    rules,
  };
}

function makeRule(overrides: Partial<ShutdownPolicyRule> = {}): ShutdownPolicyRule {
  return {
    id: 'rule',
    name: 'Rule',
    enabled: true,
    priority: 100,
    severity: 'warning',
    trigger: { field: 'ups.onBattery', op: 'eq', value: true },
    action: { type: 'showWarning' },
    createdBy: 'user',
    ...overrides,
  };
}

function makeBatteryCountdownRule(): ShutdownPolicyRule {
  return makeRule({
    id: 'battery-countdown',
    priority: 100,
    severity: 'critical',
    trigger: {
      all: [
        { field: 'ups.onBattery', op: 'eq', value: true },
        { field: 'battery.chargePercent', op: 'lte', value: 20 },
      ],
    },
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds: 60,
      method: 'shutdown',
    },
    cancelWhen: {
      all: [
        { field: 'ups.online', op: 'eq', value: true },
        { field: 'ups.fsd', op: 'eq', value: false },
      ],
    },
  });
}

function makeFsdCountdownRule(): ShutdownPolicyRule {
  return makeRule({
    id: 'fsd-countdown',
    priority: 1000,
    severity: 'forced',
    trigger: { field: 'ups.fsd', op: 'eq', value: true },
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds: 30,
      method: 'shutdown',
    },
    cancelWhen: null,
  });
}

function makeFsdImmediateRule(): ShutdownPolicyRule {
  return makeRule({
    id: 'fsd-immediate',
    priority: 1000,
    severity: 'forced',
    trigger: { field: 'ups.fsd', op: 'eq', value: true },
    action: {
      type: 'shutdownNow',
      method: 'shutdown',
    },
    cancelWhen: null,
  });
}

function makeRuntimeCountdownRule(): ShutdownPolicyRule {
  return makeRule({
    id: 'runtime-countdown',
    priority: 150,
    severity: 'critical',
    trigger: {
      all: [
        { field: 'ups.onBattery', op: 'eq', value: true },
        { field: 'battery.runtimeSeconds', op: 'lte', value: 300 },
      ],
    },
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds: 45,
      method: 'sleep',
    },
    cancelWhen: {
      all: [
        { field: 'ups.online', op: 'eq', value: true },
        { field: 'ups.fsd', op: 'eq', value: false },
      ],
    },
  });
}

function makeCommunicationLossRule(
  overrides: Partial<ShutdownPolicyRule> = {},
): ShutdownPolicyRule {
  return makeRule({
    id: 'communication-loss',
    priority: 200,
    severity: 'critical',
    trigger: {
      all: [
        { field: 'state.secondsOnBattery', op: 'gte', value: 60 },
        {
          field: 'connection.secondsSinceLastSuccessfulPoll',
          op: 'gte',
          value: 300,
        },
      ],
    },
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds: 60,
      method: 'shutdown',
    },
    cancelWhen: {
      all: [
        { field: 'connection.state', op: 'eq', value: 'connected' },
        { field: 'ups.online', op: 'eq', value: true },
      ],
    },
    ...overrides,
  });
}

function makeContext(
  overrides: Partial<ShutdownPolicyContext> = {},
): ShutdownPolicyContext {
  return {
    now: overrides.now ?? 1000,
    ups: {
      online: false,
      onBattery: true,
      lowBattery: false,
      fsd: false,
      statusTokens: ['OB'],
      ...overrides.ups,
    },
    battery: {
      chargePercent: 80,
      runtimeSeconds: 300,
      ...overrides.battery,
    },
    connection: {
      state: 'connected',
      secondsSinceLastSuccessfulPoll: 0,
      ...overrides.connection,
    },
    state: {
      secondsOnBattery: 30,
      secondsOnline: 0,
      secondsLowBattery: 0,
      secondsInFsd: 0,
      ...overrides.state,
    },
  };
}
