import type {
  ConditionEvaluationResult,
  ShutdownPolicyConfig,
  ShutdownPolicyContext,
  ShutdownPolicyDecision,
  ShutdownPolicyRule,
} from './types';
import { evaluatePolicyCondition } from './evaluation';
import { compareShutdownPolicyRuleResults } from './ordering';

export type ShutdownPolicySimulationRuleResult = {
  rule: ShutdownPolicyRule;
  order: number;
  matched: boolean;
  condition: ConditionEvaluationResult;
  skippedReason?: string;
};

export type ShutdownPolicySimulationResult = {
  decision: ShutdownPolicyDecision;
  selectedRule?: ShutdownPolicyRule;
  ruleResults: ShutdownPolicySimulationRuleResult[];
};

export function simulateShutdownPolicy(
  config: ShutdownPolicyConfig,
  context: ShutdownPolicyContext,
): ShutdownPolicySimulationResult {
  const ruleResults = config.rules.map((rule, order) => {
    if (!rule.enabled) {
      return {
        rule,
        order,
        matched: false,
        condition: {
          matched: false,
          reason: 'Rule is disabled',
        },
        skippedReason: 'disabled',
      };
    }

    const condition = evaluatePolicyCondition(rule.trigger, context);
    const holdForSeconds = rule.holdForSeconds ?? 0;
    if (condition.matched && holdForSeconds > 0) {
      const matchedSeconds = inferMatchedDurationSeconds(rule, context);
      if (matchedSeconds < holdForSeconds) {
        return {
          rule,
          order,
          matched: false,
          condition: {
            matched: false,
            reason:
              `Hold duration not satisfied (${Math.floor(matchedSeconds)}s/${holdForSeconds}s)`,
            actualValue: matchedSeconds,
            expectedValue: holdForSeconds,
            children: [condition],
          },
          skippedReason: 'hold',
        };
      }
    }

    return {
      rule,
      order,
      matched: condition.matched,
      condition,
    };
  });

  const selected = ruleResults
    .filter((result) => result.matched)
    .reduce<ShutdownPolicySimulationRuleResult | undefined>((best, result) => {
      if (!best) {
        return result;
      }

      return compareShutdownPolicyRuleResults(result, best) > 0
        ? result
        : best;
    }, undefined);
  const cancellation = simulateActiveCountdownCancellation(
    config,
    context,
    selected,
    ruleResults,
  );

  if (cancellation) {
    return cancellation;
  }

  if (!selected) {
    return {
      decision: { type: 'none' },
      ruleResults,
    };
  }

  return {
    decision: createDecision(selected.rule),
    selectedRule: selected.rule,
    ruleResults,
  };
}

function simulateActiveCountdownCancellation(
  config: ShutdownPolicyConfig,
  context: ShutdownPolicyContext,
  selected: ShutdownPolicySimulationRuleResult | undefined,
  ruleResults: ShutdownPolicySimulationRuleResult[],
): ShutdownPolicySimulationResult | null {
  const activeRuleId = context.state.activeCountdownRuleId;
  if (!activeRuleId) {
    return null;
  }

  const activeRule = config.rules.find((rule) => rule.id === activeRuleId);
  const activeRuleOrder = config.rules.findIndex((rule) => rule.id === activeRuleId);
  if (!activeRule?.cancelWhen) {
    return null;
  }

  const cancelResult = evaluatePolicyCondition(activeRule.cancelWhen, context);
  if (!cancelResult.matched) {
    return null;
  }

  if (
    selected &&
    isShutdownAction(selected.rule) &&
    compareShutdownPolicyRuleResults(selected, {
      rule: activeRule,
      order: activeRuleOrder,
      matched: true,
      condition: cancelResult,
    }) > 0
  ) {
    return null;
  }

  return {
    decision: {
      type: 'cancelShutdownCountdown',
      ruleId: activeRule.id,
      reason: cancelResult.reason,
    },
    selectedRule: activeRule,
    ruleResults: ruleResults.map((r) =>
      r.rule.id === activeRule.id
        ? { ...r, matched: true, condition: cancelResult, skippedReason: undefined }
        : r,
    ),
  };
}

function createDecision(rule: ShutdownPolicyRule): ShutdownPolicyDecision {
  const action = rule.action;

  switch (action.type) {
    case 'showWarning':
      return {
        type: 'showWarning',
        ruleId: rule.id,
        message: action.message,
      };
    case 'showCriticalAlert':
      return {
        type: 'showCriticalAlert',
        ruleId: rule.id,
        message: action.message,
      };
    case 'startShutdownCountdown':
      return {
        type: 'startShutdownCountdown',
        ruleId: rule.id,
        countdownSeconds: action.countdownSeconds,
        method: action.method,
        cancelWhen: rule.cancelWhen,
      };
    case 'shutdownNow':
      return {
        type: 'shutdownNow',
        ruleId: rule.id,
        method: action.method,
      };
    case 'cancelShutdownCountdown':
      return {
        type: 'cancelShutdownCountdown',
        ruleId: rule.id,
        reason: 'Rule action requested countdown cancellation',
      };
    default:
      return assertNever(action);
  }
}

function inferMatchedDurationSeconds(
  rule: ShutdownPolicyRule,
  context: ShutdownPolicyContext,
): number {
  if (conditionContains(rule.trigger, 'ups.fsd', true)) {
    return context.state.secondsInFsd;
  }

  if (conditionContains(rule.trigger, 'ups.lowBattery', true)) {
    return context.state.secondsLowBattery;
  }

  if (conditionContains(rule.trigger, 'ups.onBattery', true)) {
    return context.state.secondsOnBattery;
  }

  if (conditionContains(rule.trigger, 'ups.online', true)) {
    return context.state.secondsOnline;
  }

  if (conditionMentionsField(rule.trigger, 'state.secondsOnBattery')) {
    return context.state.secondsOnBattery;
  }

  if (conditionMentionsField(rule.trigger, 'state.secondsInFsd')) {
    return context.state.secondsInFsd;
  }

  if (conditionMentionsField(rule.trigger, 'state.secondsLowBattery')) {
    return context.state.secondsLowBattery;
  }

  if (conditionMentionsField(rule.trigger, 'state.secondsOnline')) {
    return context.state.secondsOnline;
  }

  if (conditionMentionsField(rule.trigger, 'connection.secondsSinceLastSuccessfulPoll')) {
    return context.connection.secondsSinceLastSuccessfulPoll;
  }

  // Cannot infer how long the condition has been true from the simulator
  // context — return 0 so hold-time is reported as not satisfied rather
  // than falsely satisfied.
  return 0;
}

function conditionMentionsField(
  condition: ShutdownPolicyRule['trigger'],
  field: string,
): boolean {
  if ('all' in condition) {
    return condition.all.some((child) => conditionMentionsField(child, field));
  }

  if ('any' in condition) {
    return condition.any.some((child) => conditionMentionsField(child, field));
  }

  if ('not' in condition) {
    return conditionMentionsField(condition.not, field);
  }

  return condition.field === field;
}

function conditionContains(
  condition: ShutdownPolicyRule['trigger'],
  field: string,
  value: boolean,
): boolean {
  if ('all' in condition) {
    return condition.all.some((child) => conditionContains(child, field, value));
  }

  if ('any' in condition) {
    return condition.any.some((child) => conditionContains(child, field, value));
  }

  if ('not' in condition) {
    return false;
  }

  return (
    condition.field === field &&
    condition.op === 'eq' &&
    condition.value === value
  );
}

function isShutdownAction(rule: ShutdownPolicyRule): boolean {
  return (
    rule.action.type === 'startShutdownCountdown' ||
    rule.action.type === 'shutdownNow'
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled policy action: ${JSON.stringify(value)}`);
}
