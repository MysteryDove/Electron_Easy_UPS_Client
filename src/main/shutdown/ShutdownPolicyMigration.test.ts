import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
  DEFAULT_FSD_SHUTDOWN_RULE_ID,
} from '../../shared/shutdownPolicy/defaultPolicies';
import type { ShutdownPolicyConfig } from '../../shared/shutdownPolicy/types';
import { migrateLegacyShutdownPolicyConfig } from './ShutdownPolicyMigration';

describe('migrateLegacyShutdownPolicyConfig', () => {
  it('generates equivalent simple policy rules from legacy settings', () => {
    const policy = migrateLegacyShutdownPolicyConfig({
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: true,
        shutdownEnabled: true,
        criticalAlertEnabled: true,
        criticalShutdownAlertEnabled: true,
        shutdownCountdownSeconds: 60,
        shutdownMethod: 'shutdown',
      },
      fsd: {
        shutdownEnabled: true,
        shutdownDelaySeconds: 30,
        shutdownMethod: 'shutdown',
        overlayEnabled: true,
      },
    });

    const batteryRule = policy.rules.find((rule) =>
      rule.id === DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
    );
    const fsdRule = policy.rules.find((rule) =>
      rule.id === DEFAULT_FSD_SHUTDOWN_RULE_ID,
    );

    expect(policy.mode).toBe('simple');
    expect(policy.safety.requireHoldForShutdownSeconds).toBe(0);
    expect(batteryRule?.enabled).toBe(true);
    expect(batteryRule?.action).toEqual({
      type: 'startShutdownCountdown',
      countdownSeconds: 60,
      method: 'shutdown',
    });
    expect(fsdRule?.enabled).toBe(true);
    expect(fsdRule?.action).toEqual({
      type: 'startShutdownCountdown',
      countdownSeconds: 30,
      method: 'shutdown',
    });
  });

  it('preserves disabled legacy battery and FSD shutdown settings', () => {
    const policy = migrateLegacyShutdownPolicyConfig({
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: true,
        shutdownEnabled: false,
        criticalAlertEnabled: true,
        criticalShutdownAlertEnabled: false,
        shutdownCountdownSeconds: 60,
        shutdownMethod: 'shutdown',
      },
      fsd: {
        shutdownEnabled: false,
        shutdownDelaySeconds: 30,
        shutdownMethod: 'shutdown',
        overlayEnabled: true,
      },
    });

    expect(policy.rules.find((rule) =>
      rule.id === DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
    )?.enabled).toBe(false);
    expect(policy.rules.find((rule) =>
      rule.id === DEFAULT_FSD_SHUTDOWN_RULE_ID,
    )?.enabled).toBe(false);
  });

  it('migrates legacy critical overlay without auto-shutdown to alert-only policy action', () => {
    const policy = migrateLegacyShutdownPolicyConfig({
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: true,
        shutdownEnabled: false,
        criticalAlertEnabled: true,
        criticalShutdownAlertEnabled: true,
        shutdownCountdownSeconds: 60,
        shutdownMethod: 'shutdown',
      },
      fsd: {
        shutdownEnabled: false,
        shutdownDelaySeconds: 30,
        shutdownMethod: 'shutdown',
        overlayEnabled: true,
      },
    });

    expect(policy.rules.find((rule) =>
      rule.id === DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
    )?.action).toEqual({ type: 'showCriticalAlert' });
  });

  it('migrates legacy shutdown without overlay to immediate policy action', () => {
    const policy = migrateLegacyShutdownPolicyConfig({
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: true,
        shutdownEnabled: true,
        criticalAlertEnabled: true,
        criticalShutdownAlertEnabled: false,
        shutdownCountdownSeconds: 60,
        shutdownMethod: 'shutdown',
      },
      fsd: {
        shutdownEnabled: true,
        shutdownDelaySeconds: 30,
        shutdownMethod: 'sleep',
        overlayEnabled: false,
      },
    });

    expect(policy.safety.allowImmediateShutdown).toBe(true);
    expect(policy.rules.find((rule) =>
      rule.id === DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
    )?.action).toEqual({
      type: 'shutdownNow',
      method: 'shutdown',
    });
    expect(policy.rules.find((rule) =>
      rule.id === DEFAULT_FSD_SHUTDOWN_RULE_ID,
    )?.action).toEqual({
      type: 'shutdownNow',
      method: 'sleep',
    });
  });

  it('does not overwrite existing advanced policies', () => {
    const advancedPolicy: ShutdownPolicyConfig = {
      version: 1,
      mode: 'advanced',
      safety: {
        requireHoldForShutdownSeconds: 0,
        maxCountdownSeconds: 300,
        allowImmediateShutdown: false,
        allowFsdAutoCancel: false,
      },
      rules: [
        {
          id: 'custom-rule',
          name: 'Custom rule',
          enabled: true,
          priority: 10,
          severity: 'warning',
          trigger: { field: 'ups.online', op: 'eq', value: true },
          action: { type: 'showWarning' },
          createdBy: 'user',
        },
      ],
    };

    const migrated = migrateLegacyShutdownPolicyConfig(
      {
        battery: {
          warningPct: 40,
          shutdownPct: 20,
          warningToastEnabled: true,
          shutdownEnabled: true,
          criticalAlertEnabled: true,
          criticalShutdownAlertEnabled: true,
          shutdownCountdownSeconds: 60,
          shutdownMethod: 'shutdown',
        },
        fsd: {
          shutdownEnabled: true,
          shutdownDelaySeconds: 30,
          shutdownMethod: 'shutdown',
          overlayEnabled: true,
        },
      },
      advancedPolicy,
    );

    expect(migrated).toBe(advancedPolicy);
  });
});
