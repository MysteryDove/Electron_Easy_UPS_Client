import type {
  ConditionEvaluationResult,
  PolicyCondition,
  PolicyField,
  ShutdownPolicyContext,
} from '../../shared/shutdownPolicy/types';
import {
  evaluatePolicyCondition,
  getPolicyFieldValue as getSharedPolicyFieldValue,
} from '../../shared/shutdownPolicy/evaluation';

export class ShutdownPolicyEvaluator {
  public evaluate(
    condition: PolicyCondition,
    context: ShutdownPolicyContext,
  ): ConditionEvaluationResult {
    return evaluatePolicyCondition(condition, context);
  }
}

export function evaluateCondition(
  condition: PolicyCondition,
  context: ShutdownPolicyContext,
): ConditionEvaluationResult {
  return evaluatePolicyCondition(condition, context);
}

export function getPolicyFieldValue(
  context: ShutdownPolicyContext,
  field: PolicyField,
): unknown {
  return getSharedPolicyFieldValue(context, field);
}
