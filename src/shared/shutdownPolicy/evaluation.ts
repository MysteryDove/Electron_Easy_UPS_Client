import type {
  ConditionEvaluationResult,
  PolicyCondition,
  PolicyField,
  PolicyOperator,
  ShutdownPolicyContext,
} from './types';

type PolicyConditionLeaf = Extract<
  PolicyCondition,
  { field: PolicyField; op: PolicyOperator }
>;

export function evaluatePolicyCondition(
  condition: PolicyCondition,
  context: ShutdownPolicyContext,
): ConditionEvaluationResult {
  if ('all' in condition) {
    const children = condition.all.map((child) =>
      evaluatePolicyCondition(child, context),
    );
    const matched = children.every((child) => child.matched);
    return {
      matched,
      reason: matched
        ? 'All conditions matched'
        : 'One or more conditions did not match',
      children,
    };
  }

  if ('any' in condition) {
    const children = condition.any.map((child) =>
      evaluatePolicyCondition(child, context),
    );
    const matched = children.some((child) => child.matched);
    return {
      matched,
      reason: matched
        ? 'At least one condition matched'
        : 'No conditions matched',
      children,
    };
  }

  if ('not' in condition) {
    const child = evaluatePolicyCondition(condition.not, context);
    return {
      matched: !child.matched,
      reason: child.matched
        ? 'Negated condition matched'
        : 'Negated condition did not match',
      children: [child],
    };
  }

  return evaluateLeafCondition(condition, context);
}

export function getPolicyFieldValue(
  context: ShutdownPolicyContext,
  field: PolicyField,
): unknown {
  const parts = field.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function evaluateLeafCondition(
  condition: PolicyConditionLeaf,
  context: ShutdownPolicyContext,
): ConditionEvaluationResult {
  const actualValue = getPolicyFieldValue(context, condition.field);
  const expectedValue = condition.value;

  switch (condition.op) {
    case 'eq':
      return makeLeafResult(
        condition,
        actualValue === expectedValue,
        actualValue,
        expectedValue,
      );
    case 'neq':
      return makeLeafResult(
        condition,
        actualValue !== expectedValue,
        actualValue,
        expectedValue,
      );
    case 'lt':
      return evaluateNumericCondition(condition, actualValue, expectedValue, (a, b) => a < b);
    case 'lte':
      return evaluateNumericCondition(condition, actualValue, expectedValue, (a, b) => a <= b);
    case 'gt':
      return evaluateNumericCondition(condition, actualValue, expectedValue, (a, b) => a > b);
    case 'gte':
      return evaluateNumericCondition(condition, actualValue, expectedValue, (a, b) => a >= b);
    case 'includes':
      return evaluateArrayCondition(condition, actualValue, expectedValue, true);
    case 'notIncludes':
      return evaluateArrayCondition(condition, actualValue, expectedValue, false);
    case 'exists':
      return makeLeafResult(condition, actualValue !== undefined, actualValue, undefined);
    case 'notExists':
      return makeLeafResult(condition, actualValue === undefined, actualValue, undefined);
    default:
      return {
        matched: false,
        reason: `Unsupported operator ${(condition as { op: string }).op}`,
        actualValue,
        expectedValue,
      };
  }
}

function evaluateNumericCondition(
  condition: PolicyConditionLeaf,
  actualValue: unknown,
  expectedValue: unknown,
  compare: (actual: number, expected: number) => boolean,
): ConditionEvaluationResult {
  if (typeof actualValue !== 'number' || typeof expectedValue !== 'number') {
    return {
      matched: false,
      reason: `${condition.field} requires numeric comparison values`,
      actualValue,
      expectedValue,
    };
  }

  return makeLeafResult(
    condition,
    compare(actualValue, expectedValue),
    actualValue,
    expectedValue,
  );
}

function evaluateArrayCondition(
  condition: PolicyConditionLeaf,
  actualValue: unknown,
  expectedValue: unknown,
  shouldInclude: boolean,
): ConditionEvaluationResult {
  if (!Array.isArray(actualValue)) {
    return {
      matched: false,
      reason: `${condition.field} is not an array`,
      actualValue,
      expectedValue,
    };
  }

  const includes = actualValue.includes(expectedValue);
  return makeLeafResult(
    condition,
    shouldInclude ? includes : !includes,
    actualValue,
    expectedValue,
  );
}

function makeLeafResult(
  condition: PolicyConditionLeaf,
  matched: boolean,
  actualValue: unknown,
  expectedValue: unknown,
): ConditionEvaluationResult {
  return {
    matched,
    reason: matched
      ? `${condition.field} ${condition.op} matched`
      : `${condition.field} ${condition.op} did not match`,
    actualValue,
    expectedValue,
  };
}
