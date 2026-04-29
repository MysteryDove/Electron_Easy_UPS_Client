import {
  createSimpleShutdownPolicyConfig,
  type LegacyShutdownPolicyInput,
} from '../../shared/shutdownPolicy/defaultPolicies';
import type { ShutdownPolicyConfig } from '../../shared/shutdownPolicy/types';

export function migrateLegacyShutdownPolicyConfig(
  legacyConfig: LegacyShutdownPolicyInput,
  existingPolicy?: ShutdownPolicyConfig,
): ShutdownPolicyConfig {
  if (existingPolicy?.mode === 'advanced' && existingPolicy.rules.length > 0) {
    return existingPolicy;
  }

  return createSimpleShutdownPolicyConfig(
    {
      ...legacyConfig,
      mode: existingPolicy?.mode ?? 'simple',
    },
    existingPolicy,
  );
}
