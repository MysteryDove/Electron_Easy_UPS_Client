import { describe, expect, it } from 'vitest';
import {
  MAX_POLICY_CONDITIONS_PER_GROUP,
  MAX_POLICY_HOLD_SECONDS,
  MAX_SHUTDOWN_POLICY_RULES,
  MIN_POLICY_HOLD_SECONDS,
} from '../../../shared/shutdownPolicy/constants';
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

  it('rejects rules with holdForSeconds below the minimum boundary', () => {
    const config = makeConfig([
      makeRule({
        action: { type: 'showWarning' },
        holdForSeconds: MIN_POLICY_HOLD_SECONDS - 1,
      }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects rules with holdForSeconds above the maximum boundary', () => {
    const config = makeConfig([
      makeRule({
        action: { type: 'showWarning' },
        holdForSeconds: MAX_POLICY_HOLD_SECONDS + 1,
      }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts rules with holdForSeconds at the exact boundaries', () => {
    const minimumResult = shutdownPolicySchema.safeParse(
      makeConfig([
        makeRule({
          action: { type: 'showWarning' },
          holdForSeconds: MIN_POLICY_HOLD_SECONDS,
        }),
      ]),
    );
    const maximumResult = shutdownPolicySchema.safeParse(
      makeConfig([
        makeRule({
          action: { type: 'showWarning' },
          holdForSeconds: MAX_POLICY_HOLD_SECONDS,
        }),
      ]),
    );

    expect(minimumResult.success).toBe(true);
    expect(maximumResult.success).toBe(true);
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

  it('treats FSD triggers nested in any and not groups as FSD rules', () => {
    const anyWrappedFsd = makeConfig([
      {
        ...makeRule({
          priority: 1000,
          severity: 'forced',
          trigger: {
            any: [
              { field: 'ups.fsd', op: 'eq', value: true },
              { field: 'ups.onBattery', op: 'eq', value: true },
            ],
          },
          action: {
            type: 'startShutdownCountdown',
            countdownSeconds: 30,
            method: 'shutdown',
          },
        }),
        holdForSeconds: 0,
        cancelWhen: null,
      },
    ]);
    const negatedFsd = makeConfig([
      {
        ...makeRule({
          priority: 1000,
          severity: 'forced',
          trigger: {
            all: [
              { field: 'ups.onBattery', op: 'eq', value: true },
              { not: { field: 'ups.fsd', op: 'neq', value: true } },
            ],
          },
          action: {
            type: 'startShutdownCountdown',
            countdownSeconds: 30,
            method: 'shutdown',
          },
        }),
        holdForSeconds: 0,
        cancelWhen: null,
      },
    ]);

    expect(shutdownPolicySchema.safeParse(anyWrappedFsd).success).toBe(true);
    expect(shutdownPolicySchema.safeParse(negatedFsd).success).toBe(true);
  });

  it('rejects duplicate rule ids', () => {
    const config = makeConfig([
      makeRule({ id: 'duplicate', action: { type: 'showWarning' } }),
      makeRule({ id: 'duplicate', action: { type: 'showWarning' } }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects policies with more than the maximum number of rules', () => {
    const tooManyRules = Array.from(
      { length: MAX_SHUTDOWN_POLICY_RULES + 1 },
      (_, index) => makeRule({
        id: `rule-${index + 1}`,
        name: `Rule ${index + 1}`,
        action: { type: 'showWarning' },
      }),
    );

    const result = shutdownPolicySchema.safeParse(makeConfig(tooManyRules));
    expect(result.success).toBe(false);
  });

  it('rejects condition groups with more than the maximum number of conditions', () => {
    const config = makeConfig([
      makeRule({
        action: { type: 'showWarning' },
        trigger: {
          all: Array.from(
            { length: MAX_POLICY_CONDITIONS_PER_GROUP + 1 },
            (_, index) => makeLeafCondition(index),
          ),
        },
      }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  // L2-F1 (Phase 0) — schema-level defense in depth: user-authored rules whose
  // action emits cancelShutdownCountdown can otherwise silently abort an active
  // FSD shutdown via BatterySafetyService.cancelPolicyCountdown.
  it('rejects user-created cancelShutdownCountdown rules when allowFsdAutoCancel is false', () => {
    const config = makeConfig([
      makeRule({
        id: 'user-cancel-on-online',
        action: { type: 'cancelShutdownCountdown' },
        cancelWhen: undefined,
        trigger: { field: 'ups.online', op: 'eq', value: true },
      }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('allows user-created cancelShutdownCountdown rules when allowFsdAutoCancel is true', () => {
    const config = makeConfig(
      [
        makeRule({
          id: 'user-cancel-on-online',
          action: { type: 'cancelShutdownCountdown' },
          cancelWhen: undefined,
          trigger: { field: 'ups.online', op: 'eq', value: true },
        }),
      ],
      {
        safety: {
          ...defaultShutdownPolicyConfig.safety,
          allowFsdAutoCancel: true,
        },
      },
    );

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('allows system-created cancelShutdownCountdown rules regardless of allowFsdAutoCancel', () => {
    const config = makeConfig([
      makeRule({
        id: 'system-cancel-on-online',
        action: { type: 'cancelShutdownCountdown' },
        cancelWhen: undefined,
        trigger: { field: 'ups.online', op: 'eq', value: true },
        createdBy: 'system',
      }),
    ]);

    const result = shutdownPolicySchema.safeParse(config);
    expect(result.success).toBe(true);
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

function makeLeafCondition(index = 0): PolicyCondition {
  return {
    field: 'battery.chargePercent',
    op: 'lte',
    value: 50 - index,
  };
}
