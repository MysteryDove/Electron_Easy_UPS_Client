import { describe, expect, it } from 'vitest';
import type {
  PolicyCondition,
  ShutdownPolicyConfig,
  ShutdownPolicyRule,
} from '../../../shared/shutdownPolicy/types';
import {
  defaultShutdownPolicyConfig,
  shutdownPolicySchema,
} from './shutdownPolicySchema';

describe('shutdownPolicySchema', () => {
  it('accepts a safe countdown rule with explicit cancellation', () => {
    const config = makeConfig([
      {
        ...makeRule(),
        trigger: {
          all: [
            { field: 'ups.onBattery', op: 'eq', value: true },
            { field: 'battery.chargePercent', op: 'lte', value: 20 },
          ],
        },
        holdForSeconds: 5,
        cancelWhen: {
          all: [
            { field: 'ups.online', op: 'eq', value: true },
            { field: 'ups.fsd', op: 'eq', value: false },
          ],
        },
      },
    ]);

    expect(shutdownPolicySchema.safeParse(config).success).toBe(true);
  });

  it('rejects a shutdown rule that only checks battery percentage', () => {
    const config = makeConfig([
      {
        ...makeRule(),
        trigger: { field: 'battery.chargePercent', op: 'lte', value: 20 },
        holdForSeconds: 5,
        cancelWhen: null,
      },
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('does not count negated safe fields as safe shutdown triggers', () => {
    const config = makeConfig([
      {
        ...makeRule(),
        trigger: {
          all: [
            { not: { field: 'ups.onBattery', op: 'eq', value: true } },
            { field: 'battery.chargePercent', op: 'lte', value: 20 },
          ],
        },
        holdForSeconds: 5,
        cancelWhen: null,
      },
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid field and operator combinations', () => {
    const config = makeConfig([
      {
        ...makeRule({ action: { type: 'showWarning' } }),
        trigger: { field: 'ups.onBattery', op: 'lte', value: 1 } as PolicyCondition,
      },
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects wrong value types for field metadata', () => {
    const config = makeConfig([
      {
        ...makeRule({ action: { type: 'showWarning' } }),
        trigger: { field: 'battery.chargePercent', op: 'lte', value: '20' },
      },
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects condition nesting beyond the configured maximum', () => {
    const config = makeConfig([
      {
        ...makeRule({ action: { type: 'showWarning' } }),
        trigger: {
          all: [
            {
              any: [
                {
                  not: {
                    field: 'ups.onBattery',
                    op: 'eq',
                    value: true,
                  },
                },
              ],
            },
          ],
        },
      },
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects countdown values above the configured safety maximum', () => {
    const config = makeConfig(
      [
        {
          ...makeRule({
            action: {
              type: 'startShutdownCountdown',
              countdownSeconds: 120,
              method: 'shutdown',
            },
          }),
          holdForSeconds: 5,
          cancelWhen: null,
        },
      ],
      {
        safety: {
          ...defaultShutdownPolicyConfig.safety,
          maxCountdownSeconds: 60,
        },
      },
    );

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects shutdownNow unless immediate shutdown is explicitly allowed', () => {
    const config = makeConfig([
      makeRule({
        action: {
          type: 'shutdownNow',
          method: 'shutdown',
        },
      }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('allows a non-cancellable FSD rule with shorter hold time', () => {
    const config = makeConfig([
      {
        ...makeRule({
          priority: 1000,
          severity: 'forced',
          trigger: { field: 'ups.fsd', op: 'eq', value: true },
          action: {
            type: 'startShutdownCountdown',
            countdownSeconds: 30,
            method: 'shutdown',
          },
        }),
        holdForSeconds: 3,
        cancelWhen: null,
      },
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects duplicate rule ids', () => {
    const config = makeConfig([
      makeRule({ id: 'duplicate', action: { type: 'showWarning' } }),
      makeRule({ id: 'duplicate', action: { type: 'showWarning' } }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

function makeConfig(
  rules: ShutdownPolicyRule[],
  overrides: Partial<ShutdownPolicyConfig> = {},
): ShutdownPolicyConfig {
  return {
    ...defaultShutdownPolicyConfig,
    ...overrides,
    safety: {
      ...defaultShutdownPolicyConfig.safety,
      ...overrides.safety,
    },
    rules,
  };
}

function makeRule(
  overrides: Partial<ShutdownPolicyRule> = {},
): ShutdownPolicyRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    enabled: true,
    priority: 100,
    severity: 'critical',
    trigger: { field: 'ups.onBattery', op: 'eq', value: true },
    holdForSeconds: 5,
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds: 60,
      method: 'shutdown',
    },
    cancelWhen: null,
    createdBy: 'user',
    ...overrides,
  };
}
