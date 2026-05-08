import type { PolicyField, PolicyOperator } from './types';

export type PolicyFieldValueType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'stringArray';

export type PolicyFieldMetadata = {
  valueType: PolicyFieldValueType;
  label: string;
  supportedOperators: readonly PolicyOperator[];
};

const booleanOperators = [
  'eq',
  'neq',
  'exists',
  'notExists',
] as const satisfies readonly PolicyOperator[];

const numberOperators = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'exists',
  'notExists',
] as const satisfies readonly PolicyOperator[];

const stringOperators = [
  'eq',
  'neq',
  'exists',
  'notExists',
] as const satisfies readonly PolicyOperator[];

const arrayOperators = [
  'includes',
  'notIncludes',
  'exists',
  'notExists',
] as const satisfies readonly PolicyOperator[];

export const POLICY_FIELD_METADATA: Record<PolicyField, PolicyFieldMetadata> = {
  'ups.online': {
    valueType: 'boolean',
    label: 'UPS is online',
    supportedOperators: booleanOperators,
  },
  'ups.onBattery': {
    valueType: 'boolean',
    label: 'UPS is on battery',
    supportedOperators: booleanOperators,
  },
  'ups.lowBattery': {
    valueType: 'boolean',
    label: 'UPS reports low battery',
    supportedOperators: booleanOperators,
  },
  'ups.fsd': {
    valueType: 'boolean',
    label: 'UPS reports forced shutdown',
    supportedOperators: booleanOperators,
  },
  'ups.statusTokens': {
    valueType: 'stringArray',
    label: 'UPS status tokens',
    supportedOperators: arrayOperators,
  },
  'battery.chargePercent': {
    valueType: 'number',
    label: 'Battery charge percent',
    supportedOperators: numberOperators,
  },
  'battery.runtimeSeconds': {
    valueType: 'number',
    label: 'Battery runtime seconds',
    supportedOperators: numberOperators,
  },
  'connection.state': {
    valueType: 'string',
    label: 'Connection state',
    supportedOperators: stringOperators,
  },
  'connection.secondsSinceLastSuccessfulPoll': {
    valueType: 'number',
    label: 'Seconds since last successful poll',
    supportedOperators: numberOperators,
  },
  'state.secondsOnBattery': {
    valueType: 'number',
    label: 'Seconds on battery',
    supportedOperators: numberOperators,
  },
  'state.secondsOnline': {
    valueType: 'number',
    label: 'Seconds online',
    supportedOperators: numberOperators,
  },
  'state.secondsLowBattery': {
    valueType: 'number',
    label: 'Seconds low battery',
    supportedOperators: numberOperators,
  },
  'state.secondsInFsd': {
    valueType: 'number',
    label: 'Seconds in FSD',
    supportedOperators: numberOperators,
  },
  'state.activeCountdownRuleId': {
    valueType: 'string',
    label: 'Active countdown rule',
    supportedOperators: stringOperators,
  },
};
