import { describe, expect, it } from 'vitest';
import { evaluatePolicyCondition } from './evaluation';
import type { ShutdownPolicyContext } from './types';

function makeContext(
  overrides: Partial<ShutdownPolicyContext> = {},
): ShutdownPolicyContext {
  return {
    now: 1000,
    ups: {
      online: false,
      onBattery: false,
      lowBattery: false,
      fsd: false,
      statusTokens: [],
      ...overrides.ups,
    },
    battery: {
      chargePercent: 100,
      runtimeSeconds: 3600,
      ...overrides.battery,
    },
    connection: {
      state: 'connected',
      secondsSinceLastSuccessfulPoll: 0,
      ...overrides.connection,
    },
    state: {
      secondsOnBattery: 0,
      secondsOnline: 0,
      secondsLowBattery: 0,
      secondsInFsd: 0,
      ...overrides.state,
    },
  };
}

describe('evaluatePolicyCondition — exists / notExists operators', () => {
  it('exists: matched true when field is present', () => {
    const result = evaluatePolicyCondition(
      { field: 'ups.online', op: 'exists' },
      makeContext(),
    );
    expect(result.matched).toBe(true);
    expect(result.reason).toBe('ups.online exists matched');
  });

  it('exists: matched false when field is undefined', () => {
    const result = evaluatePolicyCondition(
      { field: 'ups.unknownField' as never, op: 'exists' },
      makeContext(),
    );
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('ups.unknownField exists did not match');
  });

  it('notExists: matched true when field is undefined', () => {
    const result = evaluatePolicyCondition(
      { field: 'ups.unknownField' as never, op: 'notExists' },
      makeContext(),
    );
    expect(result.matched).toBe(true);
    expect(result.reason).toBe('ups.unknownField notExists matched');
  });

  it('notExists: matched false when field is present', () => {
    const result = evaluatePolicyCondition(
      { field: 'ups.online', op: 'notExists' },
      makeContext(),
    );
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('ups.online notExists did not match');
  });

  it('exists and notExists produce distinct reason strings for the same field', () => {
    const existsResult = evaluatePolicyCondition(
      { field: 'ups.online', op: 'exists' },
      makeContext(),
    );
    const notExistsResult = evaluatePolicyCondition(
      { field: 'ups.online', op: 'notExists' },
      makeContext(),
    );
    expect(existsResult.reason).not.toBe(notExistsResult.reason);
    expect(existsResult.reason).toContain('exists');
    expect(notExistsResult.reason).toContain('notExists');
  });
});
