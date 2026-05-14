import type {
  ConditionEvaluationResult,
  PolicyCondition,
  ShutdownPolicyAction,
  ShutdownPolicyConfig,
  ShutdownPolicyContext,
  ShutdownPolicyDecision,
  ShutdownPolicyRule,
} from '../../shared/shutdownPolicy/types';
import {
  candidateOutranksActiveCountdown,
  resolveShutdownPolicyDecision,
  type ShutdownPolicyDecisionCandidate,
} from './ShutdownPolicyDecisionResolver';
import { ShutdownPolicyEvaluator } from './ShutdownPolicyEvaluator';
import {
  ShutdownPolicyRuntimeState,
  type ActiveShutdownCountdown,
} from './ShutdownPolicyRuntimeState';

export class ShutdownPolicyEngine {
  private readonly config: ShutdownPolicyConfig;
  private readonly evaluator: ShutdownPolicyEvaluator;
  private readonly runtimeState: ShutdownPolicyRuntimeState;

  public constructor(
    config: ShutdownPolicyConfig,
    runtimeState = new ShutdownPolicyRuntimeState(),
    evaluator = new ShutdownPolicyEvaluator(),
  ) {
    this.config = config;
    this.runtimeState = runtimeState;
    this.evaluator = evaluator;
  }

  public evaluate(context: ShutdownPolicyContext): ShutdownPolicyDecision {
    const candidates = this.evaluateRules(context);
    const selected = resolveShutdownPolicyDecision(candidates);
    const activeCountdown = this.runtimeState.getActiveCountdown();
    const cancellation = activeCountdown
      ? this.evaluateActiveCountdownCancellation(activeCountdown, context)
      : null;

    if (activeCountdown && cancellation) {
      const selectedCanOverride =
        selected !== null &&
        isShutdownDecision(selected.decision) &&
        candidateOutranksActiveCountdown(selected, activeCountdown);

      if (!selectedCanOverride) {
        // Apply cooldown bookkeeping for the rule whose countdown is being cancelled
        // BEFORE returning. Otherwise its lastDecisionAt/cooldownUntil are never set
        // and a still-matching trigger could immediately re-arm the countdown.
        this.markCancelledRuleDecision(activeCountdown.ruleId, context.now);
        this.runtimeState.clearActiveCountdown();
        return cancellation;
      }
    }

    if (!selected) {
      return { type: 'none' };
    }

    if (
      activeCountdown &&
      selected.decision.type === 'startShutdownCountdown'
    ) {
      if (
        selected.rule.id === activeCountdown.ruleId ||
        !candidateOutranksActiveCountdown(selected, activeCountdown)
      ) {
        return { type: 'none' };
      }
    }

    this.markSelectedDecision(selected, context.now);
    return selected.decision;
  }

  public reset(): void {
    this.runtimeState.reset();
  }

  public releaseFailedDecision(ruleId: string): void {
    this.runtimeState.clearRuleDecision(ruleId);
    this.runtimeState.clearActiveCountdown(ruleId);
  }

  private evaluateRules(
    context: ShutdownPolicyContext,
  ): ShutdownPolicyDecisionCandidate[] {
    const candidates: ShutdownPolicyDecisionCandidate[] = [];

    this.config.rules.forEach((rule, order) => {
      if (!rule.enabled) {
        this.runtimeState.markRuleUnmatched(rule.id);
        return;
      }

      const triggerResult = this.evaluator.evaluate(rule.trigger, context);
      if (!triggerResult.matched) {
        this.runtimeState.markRuleUnmatched(rule.id);
        return;
      }

      const matchedSeconds = this.runtimeState.markRuleMatched(rule.id, context.now);
      const requiredHoldSeconds = rule.holdForSeconds ?? 0;
      if (matchedSeconds < requiredHoldSeconds) {
        return;
      }

      if (this.runtimeState.isRuleCoolingDown(rule.id, context.now)) {
        return;
      }

      candidates.push({
        rule,
        order,
        decision: createDecision(rule),
        triggerResult,
      });
    });

    return candidates;
  }

  private evaluateActiveCountdownCancellation(
    activeCountdown: ActiveShutdownCountdown,
    context: ShutdownPolicyContext,
  ): ShutdownPolicyDecision | null {
    if (!activeCountdown.cancelWhen) {
      return null;
    }

    const result = this.evaluator.evaluate(activeCountdown.cancelWhen, context);
    if (!result.matched) {
      return null;
    }

    return {
      type: 'cancelShutdownCountdown',
      ruleId: activeCountdown.ruleId,
      reason: result.reason,
    };
  }

  private markCancelledRuleDecision(ruleId: string, now: number): void {
    // The rule whose countdown was just cancelled deserves the same cooldown treatment
    // as a rule whose decision was acted on: record lastDecisionAt and (if cooldownSeconds
    // is configured) arm the cooldown window so the same trigger does not immediately re-fire.
    const rule = this.config.rules.find((candidate) => candidate.id === ruleId);
    if (!rule) {
      return;
    }
    this.runtimeState.markRuleDecision(rule.id, now, rule.cooldownSeconds);
  }

  private markSelectedDecision(
    selected: ShutdownPolicyDecisionCandidate,
    now: number,
  ): void {
    this.runtimeState.markRuleDecision(
      selected.rule.id,
      now,
      selected.rule.cooldownSeconds,
    );

    if (selected.decision.type === 'startShutdownCountdown') {
      this.runtimeState.setActiveCountdown({
        ruleId: selected.rule.id,
        cancelWhen: selected.decision.cancelWhen,
        priority: selected.rule.priority,
        severity: selected.rule.severity,
        order: selected.order,
      });
      return;
    }

    if (
      selected.decision.type === 'shutdownNow' ||
      selected.decision.type === 'cancelShutdownCountdown'
    ) {
      this.runtimeState.clearActiveCountdown();
    }
  }
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

function isShutdownDecision(decision: ShutdownPolicyDecision): boolean {
  return decision.type === 'startShutdownCountdown' || decision.type === 'shutdownNow';
}

function assertNever(action: never): never {
  throw new Error(`Unhandled shutdown policy action: ${JSON.stringify(action)}`);
}

export type {
  ConditionEvaluationResult,
  PolicyCondition,
  ShutdownPolicyAction,
  ShutdownPolicyConfig,
  ShutdownPolicyContext,
  ShutdownPolicyDecision,
  ShutdownPolicyRule,
};
