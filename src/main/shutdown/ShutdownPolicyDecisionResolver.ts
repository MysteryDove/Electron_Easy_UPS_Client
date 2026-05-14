import type {
  ConditionEvaluationResult,
  ShutdownPolicyDecision,
  ShutdownPolicyRule,
} from '../../shared/shutdownPolicy/types';
import {
  compareShutdownPolicyRank,
  compareShutdownPolicyRuleResults,
} from '../../shared/shutdownPolicy/ordering';
import type { ActiveShutdownCountdown } from './ShutdownPolicyRuntimeState';

export type ShutdownPolicyDecisionCandidate = {
  rule: ShutdownPolicyRule;
  order: number;
  decision: ShutdownPolicyDecision;
  triggerResult: ConditionEvaluationResult;
};

export function resolveShutdownPolicyDecision(
  candidates: ShutdownPolicyDecisionCandidate[],
): ShutdownPolicyDecisionCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((best, candidate) =>
    compareShutdownPolicyDecisionRank(candidate, best) > 0
      ? candidate
      : best,
  );
}

export function compareShutdownPolicyDecisionRank(
  left: ShutdownPolicyDecisionCandidate,
  right: ShutdownPolicyDecisionCandidate,
): number {
  return compareShutdownPolicyRuleResults(left, right);
}

export function candidateOutranksActiveCountdown(
  candidate: ShutdownPolicyDecisionCandidate,
  activeCountdown: ActiveShutdownCountdown,
): boolean {
  return compareShutdownPolicyRank(
    {
      priority: candidate.rule.priority,
      severity: candidate.rule.severity,
      order: candidate.order,
    },
    {
      priority: activeCountdown.priority,
      severity: activeCountdown.severity,
      order: activeCountdown.order,
    },
  ) > 0;
}
