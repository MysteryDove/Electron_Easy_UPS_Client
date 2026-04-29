import { describe, expect, it } from 'vitest';
import type {
  PolicyCondition,
  ShutdownPolicyContext,
} from '../../shared/shutdownPolicy/types';
import { ShutdownPolicyEvaluator } from './ShutdownPolicyEvaluator';

describe('ShutdownPolicyEvaluator', () => {
  const evaluator = new ShutdownPolicyEvaluator();

  it('evaluates simple boolean conditions', () => {
    const result = evaluator.evaluate(
      { field: 'ups.onBattery', op: 'eq', value: true },
      makeContext(),
    );

    expect(result.matched).toBe(true);
    expect(result.actualValue).toBe(true);
  });

  it('evaluates numeric threshold conditions', () => {
    const result = evaluator.evaluate(
      { field: 'battery.chargePercent', op: 'lte', value: 20 },
      makeContext(),
    );

    expect(result.matched).toBe(true);
    expect(result.actualValue).toBe(18);
  });

  it('evaluates nested all any and not conditions', () => {
    const condition: PolicyCondition = {
      all: [
        { field: 'ups.onBattery', op: 'eq', value: true },
        {
          any: [
            { field: 'ups.fsd', op: 'eq', value: true },
            {
              not: { field: 'ups.online', op: 'eq', value: true },
            },
          ],
        },
      ],
    };

    const result = evaluator.evaluate(condition, makeContext());
    expect(result.matched).toBe(true);
    expect(result.children).toHaveLength(2);
  });

  it('reports missing fields as unmatched for comparisons', () => {
    const result = evaluator.evaluate(
      { field: 'battery.runtimeSeconds', op: 'lte', value: 300 },
      makeContext({
        battery: {
          chargePercent: 18,
          runtimeSeconds: undefined,
        },
      }),
    );

    expect(result.matched).toBe(false);
    expect(result.actualValue).toBeUndefined();
  });

  it('supports existence checks for optional fields', () => {
    const result = evaluator.evaluate(
      { field: 'state.activeCountdownRuleId', op: 'notExists' },
      makeContext(),
    );

    expect(result.matched).toBe(true);
  });

  it('returns an unmatched explanation for invalid operators at runtime', () => {
    const result = evaluator.evaluate(
      {
        field: 'ups.onBattery',
        op: 'bad-operator',
        value: true,
      } as unknown as PolicyCondition,
      makeContext(),
    );

    expect(result.matched).toBe(false);
    expect(result.reason).toContain('Unsupported operator');
  });

  it('matches status token includes conditions', () => {
    const result = evaluator.evaluate(
      { field: 'ups.statusTokens', op: 'includes', value: 'LB' },
      makeContext(),
    );

    expect(result.matched).toBe(true);
    expect(result.actualValue).toEqual(['OB', 'LB']);
  });
});

function makeContext(
  overrides: Partial<ShutdownPolicyContext> = {},
): ShutdownPolicyContext {
  return {
    now: 1000,
    ups: {
      online: false,
      onBattery: true,
      lowBattery: true,
      fsd: false,
      statusTokens: ['OB', 'LB'],
      ...overrides.ups,
    },
    battery: {
      chargePercent: 18,
      runtimeSeconds: 120,
      voltage: 12.4,
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
      secondsLowBattery: 10,
      secondsInFsd: 0,
      ...overrides.state,
    },
  };
}
