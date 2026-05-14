import type { ShutdownPolicyRule, ShutdownPolicySeverity } from './types';

export type ShutdownPolicyRankTarget = {
  priority: number;
  severity: ShutdownPolicySeverity;
  order: number;
};

export const SEVERITY_RANK: Record<ShutdownPolicySeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
  forced: 3,
};

export function compareShutdownPolicyRank(
  left: ShutdownPolicyRankTarget,
  right: ShutdownPolicyRankTarget,
): number {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }

  const leftSeverity = SEVERITY_RANK[left.severity];
  const rightSeverity = SEVERITY_RANK[right.severity];
  if (leftSeverity !== rightSeverity) {
    return leftSeverity - rightSeverity;
  }

  if (left.order !== right.order) {
    return right.order - left.order;
  }

  return 0;
}

export function compareShutdownPolicyRuleResults<
  T extends { rule: Pick<ShutdownPolicyRule, 'priority' | 'severity'>; order: number },
>(left: T, right: T): number {
  return compareShutdownPolicyRank(
    {
      priority: left.rule.priority,
      severity: left.rule.severity,
      order: left.order,
    },
    {
      priority: right.rule.priority,
      severity: right.rule.severity,
      order: right.order,
    },
  );
}