import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  applyConfigPatch,
  defaultAppConfig,
  parseConfigPatch,
} from './configSchema';

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
