import Store from 'electron-store';
import {
  applyConfigPatch,
  appConfigSchema,
  defaultAppConfig,
  type DebugLogLevel,
  normalizeStoredConfig,
  parseConfigPatch,
  type AppConfig,
} from './configSchema';

const RESET_SETTINGS_ON_START_ENV = 'ELECTRON_UPS_RESET_SETTINGS_ON_START';
const DEBUG_LEVEL_ON_START_ENV = 'ELECTRON_UPS_DEBUG_LEVEL_ON_START';

type ConfigStoreData = {
  settings: AppConfig;
};

export class ConfigStore {
  private readonly store: Store<ConfigStoreData>;
  private cachedSettings: AppConfig;

  public constructor() {
    this.store = new Store<ConfigStoreData>({
      name: 'app-settings',
      defaults: {
        settings: defaultAppConfig,
      },
    });

    if (shouldResetSettingsOnStart()) {
      this.cachedSettings = applyStartupOverrides(defaultAppConfig);
      this.store.set('settings', this.cachedSettings);
      return;
    }

    this.cachedSettings = applyStartupOverrides(
      normalizeStoredConfig(this.store.get('settings')),
    );
    this.store.set('settings', this.cachedSettings);
  }

  public get(): AppConfig {
    return this.cachedSettings;
  }

  public set(payload: unknown): AppConfig {
    const parsed = normalizeStoredConfig(appConfigSchema.parse(payload));
    this.cachedSettings = parsed;
    this.store.set('settings', parsed);
    return parsed;
  }

  public update(patchPayload: unknown): AppConfig {
    const patch = parseConfigPatch(patchPayload);
    const next = normalizeStoredConfig(applyConfigPatch(this.cachedSettings, patch));
    this.cachedSettings = next;
    this.store.set('settings', next);
    return next;
  }
}

export const configStore = new ConfigStore();

function shouldResetSettingsOnStart(): boolean {
  const rawValue = process.env[RESET_SETTINGS_ON_START_ENV];
  if (!rawValue) {
    return false;
  }

  const normalized = rawValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function applyStartupOverrides(baseConfig: AppConfig): AppConfig {
  const debugLevel = parseDebugLevelOnStart();
  if (!debugLevel) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    debug: {
      ...baseConfig.debug,
      level: debugLevel,
    },
  };
}

function parseDebugLevelOnStart(): DebugLogLevel | null {
  const rawValue = process.env[DEBUG_LEVEL_ON_START_ENV];
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (
    normalized === 'off' ||
    normalized === 'error' ||
    normalized === 'warn' ||
    normalized === 'info' ||
    normalized === 'debug' ||
    normalized === 'trace'
  ) {
    return normalized;
  }

  console.warn(
    `[ConfigStore] Ignoring invalid ${DEBUG_LEVEL_ON_START_ENV} value: ${rawValue}`,
  );
  return null;
}
