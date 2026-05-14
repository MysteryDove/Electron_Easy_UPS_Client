import { z } from 'zod';
import {
  MAX_POLICY_CONDITION_DEPTH,
  MAX_POLICY_CONDITIONS_PER_GROUP,
  POLICY_FIELDS,
  POLICY_OPERATORS,
} from '../../../shared/shutdownPolicy/constants';
import { POLICY_FIELD_METADATA } from '../../../shared/shutdownPolicy/fieldMetadata';
import type {
  PolicyCondition,
  PolicyField,
  PolicyOperator,
} from '../../../shared/shutdownPolicy/types';

type IssuePath = Array<string | number>;

const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

const policyConditionLeafSchema = z
  .object({
    field: z.enum(POLICY_FIELDS),
    op: z.enum(POLICY_OPERATORS),
    value: conditionValueSchema.optional(),
  })
  .strict();

const policyConditionBaseSchema: z.ZodType<PolicyCondition> = z.lazy(() =>
  z.union([
    z
      .object({
        all: z
          .array(policyConditionBaseSchema)
          .min(1)
          .max(MAX_POLICY_CONDITIONS_PER_GROUP),
      })
      .strict(),
    z
      .object({
        any: z
          .array(policyConditionBaseSchema)
          .min(1)
          .max(MAX_POLICY_CONDITIONS_PER_GROUP),
      })
      .strict(),
    z
      .object({
        not: policyConditionBaseSchema,
      })
      .strict(),
    policyConditionLeafSchema,
  ]),
);

export const policyConditionSchema = policyConditionBaseSchema.superRefine(
  (condition, context) => {
    validateCondition(condition, (issuePath, message) => {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: issuePath,
        message,
      });
    });
  },
);

export function validatePolicyCondition(condition: PolicyCondition): void {
  const result = policyConditionSchema.safeParse(condition);
  if (!result.success) {
    throw new Error(`Invalid policy condition: ${result.error.message}`);
  }
}

function validateCondition(
  condition: PolicyCondition,
  addIssue: (issuePath: IssuePath, message: string) => void,
  path: IssuePath = [],
  depth = 1,
): void {
  if (depth > MAX_POLICY_CONDITION_DEPTH) {
    addIssue(
      path,
      `Policy condition nesting depth cannot exceed ${MAX_POLICY_CONDITION_DEPTH}`,
    );
    return;
  }

  if ('all' in condition) {
    validateConditionGroup(condition.all, addIssue, [...path, 'all'], depth);
    return;
  }

  if ('any' in condition) {
    validateConditionGroup(condition.any, addIssue, [...path, 'any'], depth);
    return;
  }

  if ('not' in condition) {
    validateCondition(condition.not, addIssue, [...path, 'not'], depth + 1);
    return;
  }

  validateConditionLeaf(condition.field, condition.op, condition.value, addIssue, path);
}

function validateConditionGroup(
  conditions: PolicyCondition[],
  addIssue: (issuePath: IssuePath, message: string) => void,
  path: IssuePath,
  depth: number,
): void {
  if (conditions.length > MAX_POLICY_CONDITIONS_PER_GROUP) {
    addIssue(
      path,
      `Policy condition groups cannot contain more than ${MAX_POLICY_CONDITIONS_PER_GROUP} conditions`,
    );
  }

  conditions.forEach((child, index) => {
    validateCondition(child, addIssue, [...path, index], depth + 1);
  });
}

function validateConditionLeaf(
  field: PolicyField,
  operator: PolicyOperator,
  value: string | number | boolean | undefined,
  addIssue: (issuePath: IssuePath, message: string) => void,
  path: IssuePath,
): void {
  const metadata = POLICY_FIELD_METADATA[field];

  if (!metadata.supportedOperators.includes(operator)) {
    addIssue(
      [...path, 'op'],
      `Operator ${operator} is not valid for field ${field}`,
    );
    return;
  }

  if (operator === 'exists' || operator === 'notExists') {
    if (value !== undefined) {
      addIssue(
        [...path, 'value'],
        `Operator ${operator} does not accept a value`,
      );
    }
    return;
  }

  if (value === undefined) {
    addIssue([...path, 'value'], `Operator ${operator} requires a value`);
    return;
  }

  if (metadata.valueType === 'number' && typeof value !== 'number') {
    addIssue([...path, 'value'], `Field ${field} requires a numeric value`);
    return;
  }

  if (metadata.valueType === 'boolean' && typeof value !== 'boolean') {
    addIssue([...path, 'value'], `Field ${field} requires a boolean value`);
    return;
  }

  if (metadata.valueType === 'string' && typeof value !== 'string') {
    addIssue([...path, 'value'], `Field ${field} requires a string value`);
    return;
  }

  if (metadata.valueType === 'stringArray' && typeof value !== 'string') {
    addIssue([...path, 'value'], `Field ${field} requires a string value`);
  }
}

export function conditionContainsFsdTrigger(condition: PolicyCondition): boolean {
  if ('all' in condition) {
    return condition.all.some((child) => conditionContainsFsdTrigger(child));
  }

  if ('any' in condition) {
    return condition.any.some((child) => conditionContainsFsdTrigger(child));
  }

  if ('not' in condition) {
    return conditionContainsFsdReference(condition.not);
  }

  return condition.field === 'ups.fsd' && condition.op === 'eq' && condition.value === true;
}

export function conditionContainsSafeShutdownTrigger(
  condition: PolicyCondition,
): boolean {
  return conditionHasPositiveLeaf(condition, (leaf) => {
    if (
      (leaf.field === 'ups.onBattery' ||
        leaf.field === 'ups.lowBattery' ||
        leaf.field === 'ups.fsd') &&
      leaf.op === 'eq' &&
      leaf.value === true
    ) {
      return true;
    }

    if (
      leaf.field === 'connection.secondsSinceLastSuccessfulPoll' &&
      (leaf.op === 'gte' || leaf.op === 'gt') &&
      typeof leaf.value === 'number' &&
      leaf.value > 0
    ) {
      return true;
    }

    if (
      leaf.field === 'connection.state' &&
      leaf.op === 'eq' &&
      leaf.value === 'disconnected'
    ) {
      return true;
    }

    return false;
  });
}

function conditionHasPositiveLeaf(
  condition: PolicyCondition,
  predicate: (
    leaf: Extract<PolicyCondition, { field: PolicyField; op: PolicyOperator }>,
  ) => boolean,
): boolean {
  if ('all' in condition) {
    return condition.all.some((child) =>
      conditionHasPositiveLeaf(child, predicate),
    );
  }

  if ('any' in condition) {
    return condition.any.some((child) =>
      conditionHasPositiveLeaf(child, predicate),
    );
  }

  if ('not' in condition) {
    return false;
  }

  return predicate(condition);
}

function conditionContainsFsdReference(condition: PolicyCondition): boolean {
  if ('all' in condition) {
    return condition.all.some((child) => conditionContainsFsdReference(child));
  }

  if ('any' in condition) {
    return condition.any.some((child) => conditionContainsFsdReference(child));
  }

  if ('not' in condition) {
    return conditionContainsFsdReference(condition.not);
  }

  return condition.field === 'ups.fsd';
}
