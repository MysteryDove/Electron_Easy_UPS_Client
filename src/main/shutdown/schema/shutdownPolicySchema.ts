import { z } from 'zod';
import {
  DEFAULT_SHUTDOWN_POLICY_CONFIG,
  DEFAULT_SHUTDOWN_POLICY_SAFETY,
  MAX_POLICY_COOLDOWN_SECONDS,
  MAX_POLICY_COUNTDOWN_SECONDS,
  MAX_POLICY_HOLD_SECONDS,
  MAX_SHUTDOWN_POLICY_RULES,
  MIN_POLICY_HOLD_SECONDS,
  SHUTDOWN_POLICY_CREATORS,
  SHUTDOWN_POLICY_MODES,
  SHUTDOWN_POLICY_SEVERITIES,
  SHUTDOWN_POLICY_VERSION,
} from '../../../shared/shutdownPolicy/constants';
import type {
  ShutdownPolicyAction,
  ShutdownPolicyConfig,
  ShutdownPolicyRule,
} from '../../../shared/shutdownPolicy/types';
import { policyActionSchema } from './policyActionSchema';
import {
  conditionContainsFsdTrigger,
  conditionContainsSafeShutdownTrigger,
  policyConditionSchema,
} from './policyConditionSchema';

const safeTextSchema = z.string().trim().min(1).max(200);

const shutdownPolicySafetySchema = z
  .object({
    requireHoldForShutdownSeconds: z
      .number()
      .int()
      .min(MIN_POLICY_HOLD_SECONDS)
      .max(MAX_POLICY_HOLD_SECONDS),
    maxCountdownSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_POLICY_COUNTDOWN_SECONDS),
    allowImmediateShutdown: z.boolean(),
    allowFsdAutoCancel: z.boolean(),
  })
  .strict();

const shutdownPolicyRuleBaseSchema = z
  .object({
    id: safeTextSchema,
    name: safeTextSchema,
    description: z.string().trim().min(1).max(1000).optional(),
    enabled: z.boolean(),
    priority: z.number().int().min(-10000).max(10000),
    severity: z.enum(SHUTDOWN_POLICY_SEVERITIES),
    trigger: policyConditionSchema,
    holdForSeconds: z
      .number()
      .int()
      .min(MIN_POLICY_HOLD_SECONDS)
      .max(MAX_POLICY_HOLD_SECONDS)
      .optional(),
    action: policyActionSchema,
    cancelWhen: policyConditionSchema.nullable().optional(),
    cooldownSeconds: z
      .number()
      .int()
      .min(0)
      .max(MAX_POLICY_COOLDOWN_SECONDS)
      .optional(),
    createdBy: z.enum(SHUTDOWN_POLICY_CREATORS),
  })
  .strict();

export const shutdownPolicySchema = z
  .object({
    version: z.literal(SHUTDOWN_POLICY_VERSION),
    mode: z.enum(SHUTDOWN_POLICY_MODES),
    rules: z
      .array(shutdownPolicyRuleBaseSchema)
      .max(MAX_SHUTDOWN_POLICY_RULES),
    safety: shutdownPolicySafetySchema,
  })
  .strict()
  .superRefine((config, context) => {
    const seenRuleIds = new Set<string>();

    config.rules.forEach((rule, index) => {
      if (seenRuleIds.has(rule.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', index, 'id'],
          message: `Duplicate shutdown policy rule id: ${rule.id}`,
        });
      }
      seenRuleIds.add(rule.id);

      validateRuleSafety(
        config as ShutdownPolicyConfig,
        rule as ShutdownPolicyRule,
        index,
        context,
      );
    });
  });

export const shutdownPolicyPatchSchema = z
  .object({
    version: z.literal(SHUTDOWN_POLICY_VERSION).optional(),
    mode: z.enum(SHUTDOWN_POLICY_MODES).optional(),
    rules: z
      .array(shutdownPolicyRuleBaseSchema)
      .max(MAX_SHUTDOWN_POLICY_RULES)
      .optional(),
    safety: shutdownPolicySafetySchema.partial().optional(),
  })
  .strict();

export const defaultShutdownPolicyConfig: ShutdownPolicyConfig = {
  ...DEFAULT_SHUTDOWN_POLICY_CONFIG,
  safety: {
    ...DEFAULT_SHUTDOWN_POLICY_SAFETY,
  },
  rules: [],
};

function validateRuleSafety(
  config: ShutdownPolicyConfig,
  rule: ShutdownPolicyRule,
  index: number,
  context: z.RefinementCtx,
): void {
  const action = rule.action;

  // SAFETY: A user-authored cancelShutdownCountdown rule with a non-FSD trigger
  // can otherwise reach BatterySafetyService.cancelPolicyCountdown while an FSD
  // countdown is active and silently abort the queued OS-level FSD shutdown
  // (L2-F1 from .omc/research/shutdown-policy-review-2026-05-14.md).
  // System-created rules (e.g. the default battery rule's implicit cancel path
  // is expressed via `cancelWhen` on the rule itself, not via a standalone
  // `cancelShutdownCountdown` action, so they are not affected) are allowed
  // for forward compatibility.
  if (
    action.type === 'cancelShutdownCountdown' &&
    rule.createdBy !== 'system' &&
    !config.safety.allowFsdAutoCancel
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rules', index, 'action'],
      message:
        'User-created cancelShutdownCountdown rules require shutdownPolicy.safety.allowFsdAutoCancel',
    });
  }

  if (action.type === 'startShutdownCountdown') {
    if (action.countdownSeconds > config.safety.maxCountdownSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'action', 'countdownSeconds'],
        message:
          'Countdown seconds cannot exceed shutdownPolicy.safety.maxCountdownSeconds',
      });
    }

    if (rule.cancelWhen === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'cancelWhen'],
        message:
          'Countdown shutdown rules must explicitly set cancelWhen or null',
      });
    }
  }

  if (isDangerousAction(action)) {
    if (!conditionContainsSafeShutdownTrigger(rule.trigger)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'trigger'],
        message:
          'Shutdown actions require an on-battery, low-battery, FSD, or connection-loss trigger',
      });
    }

    if (
      action.type === 'shutdownNow' &&
      !config.safety.allowImmediateShutdown
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'action'],
        message:
          'shutdownNow requires shutdownPolicy.safety.allowImmediateShutdown',
      });
    }

    const isFsdRule = conditionContainsFsdTrigger(rule.trigger);
    const holdForSeconds = rule.holdForSeconds ?? 0;

    if (
      !isFsdRule &&
      holdForSeconds < config.safety.requireHoldForShutdownSeconds
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'holdForSeconds'],
        message:
          'Shutdown rules must satisfy shutdownPolicy.safety.requireHoldForShutdownSeconds',
      });
    }

    if (
      isFsdRule &&
      !config.safety.allowFsdAutoCancel &&
      rule.cancelWhen !== null &&
      rule.cancelWhen !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'cancelWhen'],
        message:
          'FSD shutdown rules cannot auto-cancel unless allowFsdAutoCancel is enabled',
      });
    }
  }
}

function isDangerousAction(action: ShutdownPolicyAction): boolean {
  return action.type === 'startShutdownCountdown' || action.type === 'shutdownNow';
}
