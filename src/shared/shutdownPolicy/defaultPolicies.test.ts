import { describe, expect, it } from 'vitest';
import { shutdownPolicySchema } from '../../main/shutdown/schema/shutdownPolicySchema';
import {
  createRuntimeRemainingPolicy,
  createSimpleShutdownPolicyConfig,
  DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
  DEFAULT_BATTERY_WARNING_RULE_ID,
  DEFAULT_COMMUNICATION_LOSS_RULE_ID,
  DEFAULT_FSD_SHUTDOWN_RULE_ID,
} from './defaultPolicies';

const legacyBattery = {
  warningPct: 40,
  shutdownPct: 20,
  warningToastEnabled: true,
  shutdownEnabled: true,
  criticalAlertEnabled: true,
  criticalShutdownAlertEnabled: true,
  shutdownCountdownSeconds: 60,
  shutdownMethod: 'shutdown' as const,
};

const legacyFsd = {
  shutdownEnabled: true,
  shutdownDelaySeconds: 30,
  shutdownMethod: 'shutdown' as const,
  overlayEnabled: true,
};

describe('default shutdown policies', () => {
  it('uses Phase 1 hold defaults for generated simple policies', () => {
    const config = createSimpleShutdownPolicyConfig({
      battery: legacyBattery,
      fsd: legacyFsd,
    });
    const holdByRuleId = Object.fromEntries(
      config.rules.map((rule) => [rule.id, rule.holdForSeconds]),
    );

    expect(config.safety.requireHoldForShutdownSeconds).toBe(5);
    expect(holdByRuleId[DEFAULT_BATTERY_WARNING_RULE_ID]).toBe(5);
    expect(holdByRuleId[DEFAULT_BATTERY_SHUTDOWN_RULE_ID]).toBe(10);
    expect(holdByRuleId[DEFAULT_FSD_SHUTDOWN_RULE_ID]).toBe(3);
    expect(holdByRuleId[DEFAULT_COMMUNICATION_LOSS_RULE_ID]).toBe(5);
    expect(shutdownPolicySchema.safeParse(config).success).toBe(true);
  });

  it('uses a 10-second hold for runtime remaining defaults', () => {
    expect(createRuntimeRemainingPolicy().holdForSeconds).toBe(10);
  });
});