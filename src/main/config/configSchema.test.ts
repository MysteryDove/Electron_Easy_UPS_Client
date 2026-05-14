import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  applyConfigPatch,
  defaultAppConfig,
  normalizeStoredConfig,
  parseConfigPatch,
} from './configSchema';
import {
  DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
  DEFAULT_FSD_SHUTDOWN_RULE_ID,
} from '../../shared/shutdownPolicy/defaultPolicies';

describe('FSD config schema', () => {
  it('defaults include fsd section with shutdownEnabled=false', () => {
    expect(defaultAppConfig.fsd).toEqual({
      shutdownEnabled: false,
      shutdownDelaySeconds: 45,
      shutdownMethod: 'sleep',
      overlayEnabled: true,
    });
  });

  it('validates a full fsd config', () => {
    const config = {
      ...defaultAppConfig,
      fsd: {
        shutdownEnabled: true,
        shutdownDelaySeconds: 60,
        shutdownMethod: 'shutdown' as const,
        overlayEnabled: false,
      },
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects shutdownDelaySeconds below 1', () => {
    const config = {
      ...defaultAppConfig,
      fsd: {
        ...defaultAppConfig.fsd,
        shutdownDelaySeconds: 0,
      },
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects shutdownDelaySeconds above 300', () => {
    const config = {
      ...defaultAppConfig,
      fsd: {
        ...defaultAppConfig.fsd,
        shutdownDelaySeconds: 301,
      },
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid shutdownMethod', () => {
    const config = {
      ...defaultAppConfig,
      fsd: {
        ...defaultAppConfig.fsd,
        shutdownMethod: 'reboot',
      },
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('applies a partial fsd patch', () => {
    const patch = parseConfigPatch({
      fsd: { shutdownEnabled: true },
    });
    const result = applyConfigPatch(defaultAppConfig, patch);
    expect(result.fsd.shutdownEnabled).toBe(true);
    expect(result.fsd.shutdownDelaySeconds).toBe(45);
    expect(result.fsd.shutdownMethod).toBe('sleep');
    expect(result.fsd.overlayEnabled).toBe(true);
  });
});

describe('shutdown policy config schema', () => {
  it('defaults include generated simple shutdown policy rules', () => {
    expect(defaultAppConfig.shutdownPolicy.version).toBe(1);
    expect(defaultAppConfig.shutdownPolicy.mode).toBe('simple');
    expect(defaultAppConfig.shutdownPolicy.safety).toEqual({
      requireHoldForShutdownSeconds: 5,
      maxCountdownSeconds: 300,
      allowImmediateShutdown: false,
      allowFsdAutoCancel: false,
    });
    expect(defaultAppConfig.shutdownPolicy.rules.map((rule) => rule.id)).toEqual([
      'default-battery-warning',
      'default-battery-shutdown',
      'default-fsd-shutdown',
      'default-comms-lost-on-battery',
    ]);
  });

  it('validates a full config with shutdownPolicy', () => {
    const result = appConfigSchema.safeParse(defaultAppConfig);
    expect(result.success).toBe(true);
  });

  it('normalizes stored legacy config without shutdownPolicy', () => {
    const legacyConfig: Record<string, unknown> = { ...defaultAppConfig };
    delete legacyConfig.shutdownPolicy;
    const result = normalizeStoredConfig(legacyConfig);
    expect(result.shutdownPolicy).toEqual(defaultAppConfig.shutdownPolicy);
  });

  it('applies a partial shutdown policy safety patch', () => {
    const patch = parseConfigPatch({
      shutdownPolicy: {
        safety: {
          maxCountdownSeconds: 120,
        },
      },
    });

    const result = applyConfigPatch(defaultAppConfig, patch);
    expect(result.shutdownPolicy.safety.maxCountdownSeconds).toBe(120);
    expect(result.shutdownPolicy.safety.requireHoldForShutdownSeconds).toBe(5);
  });

  it('rebuilds simple battery policy patches into valid engine-driven rules', () => {
    const patch = parseConfigPatch({
      battery: {
        shutdownEnabled: true,
        criticalShutdownAlertEnabled: false,
      },
    });

    const result = applyConfigPatch(defaultAppConfig, patch);
    const shutdownRule = result.shutdownPolicy.rules.find((rule) =>
      rule.id === DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
    );

    expect(result.shutdownPolicy.mode).toBe('simple');
    expect(result.shutdownPolicy.safety.allowImmediateShutdown).toBe(true);
    expect(shutdownRule?.action).toEqual({
      type: 'shutdownNow',
      method: 'sleep',
    });
  });

  it('rebuilds simple FSD overlay patches into valid engine-driven rules', () => {
    const patch = parseConfigPatch({
      fsd: {
        shutdownEnabled: true,
        overlayEnabled: false,
      },
    });

    const result = applyConfigPatch(defaultAppConfig, patch);
    const fsdRule = result.shutdownPolicy.rules.find((rule) =>
      rule.id === DEFAULT_FSD_SHUTDOWN_RULE_ID,
    );

    expect(result.shutdownPolicy.safety.allowImmediateShutdown).toBe(true);
    expect(fsdRule?.action).toEqual({
      type: 'shutdownNow',
      method: 'sleep',
    });
  });

  it('disabled FSD rule with overlay off does not set allowImmediateShutdown', () => {
    const patch = parseConfigPatch({
      fsd: {
        shutdownEnabled: false,
        overlayEnabled: false,
      },
    });

    const result = applyConfigPatch(defaultAppConfig, patch);
    const fsdRule = result.shutdownPolicy.rules.find((rule) =>
      rule.id === DEFAULT_FSD_SHUTDOWN_RULE_ID,
    );

    expect(result.shutdownPolicy.safety.allowImmediateShutdown).toBe(false);
    expect(fsdRule?.enabled).toBe(false);
    expect(fsdRule?.action).toEqual({ type: 'showCriticalAlert' });
  });
});
