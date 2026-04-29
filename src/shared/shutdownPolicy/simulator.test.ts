import { describe, expect, it } from 'vitest';
import { explainDecision, flattenConditionExplanation } from './explain';
import { simulateShutdownPolicy } from './simulator';
import type {
  ShutdownPolicyConfig,
  ShutdownPolicyContext,
  ShutdownPolicyRule,
} from './types';

describe('shutdown policy simulator and explanations', () => {
  it('selects the highest ranked matching rule and explains the decision', () => {
    const shutdownRule = makeRule({
      id: 'shutdown',
      name: 'Runtime shutdown',
      priority: 100,
      severity: 'critical',
      trigger: {
        all: [
          { field: 'ups.onBattery', op: 'eq', value: true },
          { field: 'battery.runtimeSeconds', op: 'lte', value: 300 },
        ],
      },
      action: {
        type: 'startShutdownCountdown',
        countdownSeconds: 60,
        method: 'shutdown',
      },
    });
    const warningRule = makeRule({
      id: 'warning',
      name: 'Battery warning',
      priority: 50,
      severity: 'warning',
      trigger: { field: 'ups.onBattery', op: 'eq', value: true },
    });

    const result = simulateShutdownPolicy(
      makeConfig([warningRule, shutdownRule]),
      makeContext(),
    );

    expect(result.selectedRule?.id).toBe('shutdown');
    expect(result.decision).toMatchObject({
      type: 'startShutdownCountdown',
      ruleId: 'shutdown',
    });
    expect(explainDecision(result.decision, result.selectedRule)).toContain(
      'Runtime shutdown',
    );
  });

  it('includes unmatched condition details for simulator output', () => {
    const result = simulateShutdownPolicy(
      makeConfig([
        makeRule({
          trigger: {
            all: [
              { field: 'ups.onBattery', op: 'eq', value: true },
              { field: 'battery.chargePercent', op: 'lte', value: 10 },
            ],
          },
        }),
      ]),
      makeContext({ battery: { chargePercent: 80, runtimeSeconds: 600 } }),
    );

    expect(result.decision).toEqual({ type: 'none' });
    expect(result.ruleResults[0].matched).toBe(false);
    expect(flattenConditionExplanation(result.ruleResults[0].condition)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('battery.chargePercent lte did not match'),
      ]),
    );
  });

  it('lets an equal-rank earlier shutdown rule override active countdown cancellation', () => {
    const replacementRule = makeRule({
      id: 'replacement',
      name: 'Replacement countdown',
      priority: 100,
      severity: 'critical',
      trigger: { field: 'ups.online', op: 'eq', value: true },
      action: {
        type: 'startShutdownCountdown',
        countdownSeconds: 30,
        method: 'shutdown',
      },
      cancelWhen: null,
    });
    const activeRule = makeRule({
      id: 'active-countdown',
      name: 'Active countdown',
      priority: 100,
      severity: 'critical',
      action: {
        type: 'startShutdownCountdown',
        countdownSeconds: 60,
        method: 'shutdown',
      },
      cancelWhen: { field: 'ups.online', op: 'eq', value: true },
    });

    const result = simulateShutdownPolicy(
      makeConfig([replacementRule, activeRule]),
      makeContext({
        ups: {
          online: true,
          onBattery: false,
          lowBattery: false,
          fsd: false,
          statusTokens: ['OL'],
        },
        state: {
          secondsOnBattery: 0,
          secondsOnline: 120,
          secondsLowBattery: 0,
          secondsInFsd: 0,
          activeCountdownRuleId: 'active-countdown',
        },
      }),
    );

    expect(result.selectedRule?.id).toBe('replacement');
    expect(result.decision).toMatchObject({
      type: 'startShutdownCountdown',
      ruleId: 'replacement',
      countdownSeconds: 30,
    });
  });
});

function makeConfig(rules: ShutdownPolicyRule[]): ShutdownPolicyConfig {
  return {
    version: 1,
    mode: 'advanced',
    rules,
    safety: {
      requireHoldForShutdownSeconds: 0,
      maxCountdownSeconds: 300,
      allowImmediateShutdown: false,
      allowFsdAutoCancel: false,
    },
  };
}

function makeRule(overrides: Partial<ShutdownPolicyRule> = {}): ShutdownPolicyRule {
  return {
    id: 'rule',
    name: 'Rule',
    enabled: true,
    priority: 10,
    severity: 'warning',
    trigger: { field: 'ups.onBattery', op: 'eq', value: true },
    action: { type: 'showWarning' },
    createdBy: 'user',
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<ShutdownPolicyContext> = {},
): ShutdownPolicyContext {
  return {
    now: 1000,
    ups: {
      online: false,
      onBattery: true,
      lowBattery: false,
      fsd: false,
      statusTokens: ['OB'],
      ...overrides.ups,
    },
    battery: {
      chargePercent: 18,
      runtimeSeconds: 240,
      ...overrides.battery,
    },
    connection: {
      state: 'connected',
      secondsSinceLastSuccessfulPoll: 0,
      ...overrides.connection,
    },
    state: {
      secondsOnBattery: 120,
      secondsOnline: 0,
      secondsLowBattery: 0,
      secondsInFsd: 0,
      ...overrides.state,
    },
  };
}
