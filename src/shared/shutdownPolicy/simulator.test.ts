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

  describe('hold-time inference for numeric duration fields', () => {
    it('blocks a connection-loss rule when hold is not yet met', () => {
      const rule = makeRule({
        trigger: {
          field: 'connection.secondsSinceLastSuccessfulPoll',
          op: 'gte',
          value: 60,
        },
        holdForSeconds: 30,
        action: { type: 'showWarning' },
      });

      const result = simulateShutdownPolicy(
        makeConfig([rule]),
        makeContext({
          connection: { state: 'connected', secondsSinceLastSuccessfulPoll: 10 },
        }),
      );

      expect(result.decision).toEqual({ type: 'none' });
      expect(result.ruleResults[0].matched).toBe(false);
    });

    it('matches a connection-loss rule when hold is satisfied', () => {
      const rule = makeRule({
        trigger: {
          field: 'connection.secondsSinceLastSuccessfulPoll',
          op: 'gte',
          value: 60,
        },
        holdForSeconds: 30,
        action: { type: 'showWarning' },
      });

      const result = simulateShutdownPolicy(
        makeConfig([rule]),
        makeContext({
          connection: { state: 'connected', secondsSinceLastSuccessfulPoll: 90 },
        }),
      );

      expect(result.ruleResults[0].matched).toBe(true);
    });

    it('infers hold duration from state.secondsOnBattery numeric field', () => {
      const rule = makeRule({
        trigger: { field: 'state.secondsOnBattery', op: 'gte', value: 10 },
        holdForSeconds: 60,
        action: { type: 'showWarning' },
      });

      const result = simulateShutdownPolicy(
        makeConfig([rule]),
        makeContext({ state: { secondsOnBattery: 20, secondsOnline: 0, secondsLowBattery: 0, secondsInFsd: 0 } }),
      );

      expect(result.ruleResults[0].matched).toBe(false);
      expect(result.ruleResults[0].condition.reason).toContain('20s/60s');
    });

    it('conservatively fails hold when trigger field has no duration mapping', () => {
      const rule = makeRule({
        trigger: { field: 'battery.chargePercent', op: 'lte', value: 50 },
        holdForSeconds: 10,
        action: { type: 'showWarning' },
      });

      const result = simulateShutdownPolicy(
        makeConfig([rule]),
        makeContext({ battery: { chargePercent: 20 } }),
      );

      expect(result.ruleResults[0].matched).toBe(false);
      expect(result.ruleResults[0].skippedReason).toBe('hold');
      expect(result.ruleResults[0].condition.reason).toContain('0s/10s');
    });
  });

  describe('cancellation path preserves pre-computed ruleResults', () => {
    it('preserves disabled skippedReason for disabled rules in cancellation result', () => {
      const disabledRule = makeRule({
        id: 'disabled-rule',
        enabled: false,
        trigger: { field: 'ups.onBattery', op: 'eq', value: true },
        action: { type: 'showWarning' },
      });
      const activeRule = makeRule({
        id: 'active-countdown',
        priority: 100,
        trigger: { field: 'ups.onBattery', op: 'eq', value: true },
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 60,
          method: 'shutdown',
        },
        cancelWhen: { field: 'ups.online', op: 'eq', value: true },
      });

      const result = simulateShutdownPolicy(
        makeConfig([disabledRule, activeRule]),
        makeContext({
          ups: { online: true, onBattery: true, lowBattery: false, fsd: false, statusTokens: ['OL', 'OB'] },
          state: { secondsOnBattery: 120, secondsOnline: 10, secondsLowBattery: 0, secondsInFsd: 0, activeCountdownRuleId: 'active-countdown' },
        }),
      );

      expect(result.decision).toMatchObject({ type: 'cancelShutdownCountdown' });
      const disabledResult = result.ruleResults.find((r) => r.rule.id === 'disabled-rule');
      expect(disabledResult?.skippedReason).toBe('disabled');
      expect(disabledResult?.matched).toBe(false);
      expect(disabledResult?.condition.matched).toBe(false);
    });

    it('preserves hold skippedReason for hold-blocked rules in cancellation result', () => {
      const holdRule = makeRule({
        id: 'hold-rule',
        priority: 5,
        trigger: { field: 'ups.onBattery', op: 'eq', value: true },
        holdForSeconds: 300,
        action: { type: 'showWarning' },
      });
      const activeRule = makeRule({
        id: 'active-countdown',
        priority: 100,
        trigger: { field: 'ups.onBattery', op: 'eq', value: true },
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 60,
          method: 'shutdown',
        },
        cancelWhen: { field: 'ups.online', op: 'eq', value: true },
      });

      const result = simulateShutdownPolicy(
        makeConfig([holdRule, activeRule]),
        makeContext({
          ups: { online: true, onBattery: true, lowBattery: false, fsd: false, statusTokens: ['OL', 'OB'] },
          state: { secondsOnBattery: 10, secondsOnline: 5, secondsLowBattery: 0, secondsInFsd: 0, activeCountdownRuleId: 'active-countdown' },
        }),
      );

      expect(result.decision).toMatchObject({ type: 'cancelShutdownCountdown' });
      const holdResult = result.ruleResults.find((r) => r.rule.id === 'hold-rule');
      expect(holdResult?.skippedReason).toBe('hold');
      expect(holdResult?.matched).toBe(false);
      expect(holdResult?.condition.matched).toBe(false);
    });

    it('keeps matched consistent with condition.matched for non-active rules in cancellation result', () => {
      const otherRule = makeRule({
        id: 'other-rule',
        priority: 5,
        trigger: { field: 'ups.onBattery', op: 'eq', value: true },
        action: { type: 'showWarning' },
      });
      const activeRule = makeRule({
        id: 'active-countdown',
        priority: 100,
        trigger: { field: 'ups.online', op: 'eq', value: true },
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 60,
          method: 'shutdown',
        },
        cancelWhen: { field: 'ups.online', op: 'eq', value: true },
      });

      const result = simulateShutdownPolicy(
        makeConfig([otherRule, activeRule]),
        makeContext({
          ups: { online: true, onBattery: true, lowBattery: false, fsd: false, statusTokens: ['OL', 'OB'] },
          state: { secondsOnBattery: 10, secondsOnline: 5, secondsLowBattery: 0, secondsInFsd: 0, activeCountdownRuleId: 'active-countdown' },
        }),
      );

      expect(result.decision).toMatchObject({ type: 'cancelShutdownCountdown' });
      for (const r of result.ruleResults) {
        expect(r.matched).toBe(r.condition.matched);
      }
    });

    it('marks only the active rule as matched in the cancellation result', () => {
      const activeRule = makeRule({
        id: 'active-countdown',
        priority: 100,
        trigger: { field: 'ups.onBattery', op: 'eq', value: true },
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 60,
          method: 'shutdown',
        },
        cancelWhen: { field: 'ups.online', op: 'eq', value: true },
      });

      const result = simulateShutdownPolicy(
        makeConfig([activeRule]),
        makeContext({
          ups: { online: true, onBattery: true, lowBattery: false, fsd: false, statusTokens: ['OL', 'OB'] },
          state: { secondsOnBattery: 10, secondsOnline: 5, secondsLowBattery: 0, secondsInFsd: 0, activeCountdownRuleId: 'active-countdown' },
        }),
      );

      expect(result.decision).toMatchObject({ type: 'cancelShutdownCountdown' });
      const activeResult = result.ruleResults.find((r) => r.rule.id === 'active-countdown');
      expect(activeResult?.matched).toBe(true);
      expect(activeResult?.condition.matched).toBe(true);
      expect(activeResult?.skippedReason).toBeUndefined();
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
