import {
  createSimpleShutdownPolicyConfig,
  type LegacyShutdownPolicyInput,
} from '../../shared/shutdownPolicy/defaultPolicies';
import type { ShutdownPolicyConfig } from '../../shared/shutdownPolicy/types';
import { shutdownPolicySchema } from './schema/shutdownPolicySchema';

export function migrateLegacyShutdownPolicyConfig(
  legacyConfig: LegacyShutdownPolicyInput,
  existingPolicy?: ShutdownPolicyConfig,
): ShutdownPolicyConfig {
  if (existingPolicy?.mode === 'advanced' && existingPolicy.rules.length > 0) {
    const parsed = shutdownPolicySchema.safeParse(existingPolicy);
    if (parsed.success) {
      return existingPolicy;
    }

    console.warn(
      '[ShutdownPolicyMigration] Existing advanced policy failed schema validation; falling back to migrated simple policy.',
      parsed.error.flatten(),
    );
  }

  return createSimpleShutdownPolicyConfig(
    {
      ...legacyConfig,
      mode: existingPolicy?.mode ?? 'simple',
    },
    existingPolicy,
  );
}
