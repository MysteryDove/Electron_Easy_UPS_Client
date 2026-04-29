import type {
  ConditionEvaluationResult,
  ShutdownPolicyDecision,
  ShutdownPolicyRule,
  ShutdownPolicySeverity,
} from '../../shared/shutdownPolicy/types';
import type { ActiveShutdownCountdown } from './ShutdownPolicyRuntimeState';

export type ShutdownPolicyDecisionCandidate = {
  rule: ShutdownPolicyRule;
  order: number;
  decision: ShutdownPolicyDecision;
  triggerResult: ConditionEvaluationResult;
};

const severityRank: Record<ShutdownPolicySeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
  forced: 3,
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
  if (left.rule.priority !== right.rule.priority) {
    return left.rule.priority - right.rule.priority;
  }

  const leftSeverity = severityRank[left.rule.severity];
  const rightSeverity = severityRank[right.rule.severity];
  if (leftSeverity !== rightSeverity) {
    return leftSeverity - rightSeverity;
  }

  if (left.order !== right.order) {
    return right.order - left.order;
  }

  return 0;
}

export function candidateOutranksActiveCountdown(
  candidate: ShutdownPolicyDecisionCandidate,
  activeCountdown: ActiveShutdownCountdown,
): boolean {
  if (candidate.rule.priority !== activeCountdown.priority) {
    return candidate.rule.priority > activeCountdown.priority;
  }

  const candidateSeverity = severityRank[candidate.rule.severity];
  const activeSeverity = severityRank[activeCountdown.severity];
  if (candidateSeverity !== activeSeverity) {
    return candidateSeverity > activeSeverity;
  }

  return candidate.order < activeCountdown.order;
}
