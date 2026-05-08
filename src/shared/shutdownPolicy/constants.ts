import type {
  PolicyField,
  PolicyOperator,
  ShutdownPolicyAction,
  ShutdownPolicyConfig,
  ShutdownPolicyMode,
  ShutdownPolicyRuleCreator,
  ShutdownPolicySafety,
  ShutdownPolicySeverity,
  ShutdownPolicyVersion,
} from './types';

export const SHUTDOWN_POLICY_VERSION = 1 satisfies ShutdownPolicyVersion;

export const SHUTDOWN_POLICY_MODES = [
  'simple',
  'advanced',
] as const satisfies readonly ShutdownPolicyMode[];

export const SHUTDOWN_POLICY_SEVERITIES = [
  'info',
  'warning',
  'critical',
  'forced',
] as const satisfies readonly ShutdownPolicySeverity[];

export const SHUTDOWN_POLICY_CREATORS = [
  'system',
  'user',
  'migration',
] as const satisfies readonly ShutdownPolicyRuleCreator[];

export const SHUTDOWN_METHODS = [
  'shutdown',
  'sleep',
] as const satisfies readonly NonNullable<
  Extract<ShutdownPolicyAction, { method: string }>['method']
>[];

export const POLICY_OPERATORS = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'includes',
  'notIncludes',
  'exists',
  'notExists',
] as const satisfies readonly PolicyOperator[];

export const POLICY_FIELDS = [
  'ups.online',
  'ups.onBattery',
  'ups.lowBattery',
  'ups.fsd',
  'ups.statusTokens',
  'battery.chargePercent',
  'battery.runtimeSeconds',
  'connection.state',
  'connection.secondsSinceLastSuccessfulPoll',
  'state.secondsOnBattery',
  'state.secondsOnline',
  'state.secondsLowBattery',
  'state.secondsInFsd',
  'state.activeCountdownRuleId',
] as const satisfies readonly PolicyField[];

export const MAX_POLICY_CONDITION_DEPTH = 3;
export const MAX_POLICY_CONDITIONS_PER_GROUP = 10;
export const MAX_SHUTDOWN_POLICY_RULES = 25;
export const MIN_POLICY_COUNTDOWN_SECONDS = 1;
export const MAX_POLICY_COUNTDOWN_SECONDS = 300;
export const MIN_POLICY_HOLD_SECONDS = 0;
export const MAX_POLICY_HOLD_SECONDS = 3600;
export const MAX_POLICY_COOLDOWN_SECONDS = 86400;

export const DEFAULT_SHUTDOWN_POLICY_SAFETY: ShutdownPolicySafety = {
  requireHoldForShutdownSeconds: 5,
  maxCountdownSeconds: 300,
  allowImmediateShutdown: false,
  allowFsdAutoCancel: false,
};

export const DEFAULT_SHUTDOWN_POLICY_CONFIG: ShutdownPolicyConfig = {
  version: SHUTDOWN_POLICY_VERSION,
  mode: 'simple',
  rules: [],
  safety: DEFAULT_SHUTDOWN_POLICY_SAFETY,
};
