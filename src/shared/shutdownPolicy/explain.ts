import type {
  ConditionEvaluationResult,
  ShutdownPolicyDecision,
  ShutdownPolicyRule,
} from './types';

export function explainDecision(
  decision: ShutdownPolicyDecision,
  rule?: ShutdownPolicyRule,
): string {
  if (decision.type === 'none') {
    return 'No shutdown policy rule produced an action.';
  }

  const ruleLabel = rule ? `${rule.name} (${rule.id})` : decision.ruleId;

  switch (decision.type) {
    case 'showWarning':
      return `Rule ${ruleLabel} matched and will show a warning.`;
    case 'showCriticalAlert':
      return `Rule ${ruleLabel} matched and will show a critical alert.`;
    case 'startShutdownCountdown':
      return `Rule ${ruleLabel} matched and will start a ${decision.countdownSeconds}s ${decision.method} countdown.`;
    case 'shutdownNow':
      return `Rule ${ruleLabel} matched and will run ${decision.method} immediately.`;
    case 'cancelShutdownCountdown':
      return `Rule ${ruleLabel} cancelled the active shutdown countdown: ${decision.reason}.`;
    default:
      return 'Unknown shutdown policy decision.';
  }
}

export function flattenConditionExplanation(
  result: ConditionEvaluationResult,
  depth = 0,
): string[] {
  const prefix = `${'  '.repeat(depth)}${result.matched ? 'PASS' : 'FAIL'} `;
  const detail = formatConditionDetail(result);
  const lines = [`${prefix}${detail}`];

  for (const child of result.children ?? []) {
    lines.push(...flattenConditionExplanation(child, depth + 1));
  }

  return lines;
}

function formatConditionDetail(result: ConditionEvaluationResult): string {
  const details: string[] = [result.reason];

  if (result.actualValue !== undefined) {
    details.push(`actual=${formatValue(result.actualValue)}`);
  }

  if (result.expectedValue !== undefined) {
    details.push(`expected=${formatValue(result.expectedValue)}`);
  }

  return details.join(' | ');
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.join(', ')}]`;
  }

  return String(value);
}
