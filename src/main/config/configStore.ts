import Store from 'electron-store';
import {
  applyConfigPatch,
  appConfigSchema,
  defaultAppConfig,
  normalizeStoredConfig,
  parseConfigPatch,
  type AppConfig,
} from './configSchema';

const RESET_SETTINGS_ON_START_ENV = 'ELECTRON_UPS_RESET_SETTINGS_ON_START';

type ConfigStoreData = {
  settings: AppConfig;
};

export class ConfigStore {
  private readonly store: Store<ConfigStoreData>;

  public constructor() {
    this.store = new Store<ConfigStoreData>({
      name: 'app-settings',
      defaults: {
        settings: defaultAppConfig,
      },
    });

    if (shouldResetSettingsOnStart()) {
      this.store.set('settings', defaultAppConfig);
      return;
    }

    this.store.set('settings', normalizeStoredConfig(this.store.get('settings')));
  }

  public get(): AppConfig {
    const normalized = normalizeStoredConfig(this.store.get('settings'));
    this.store.set('settings', normalized);
    return normalized;
  }

  public set(payload: unknown): AppConfig {
    const parsed = appConfigSchema.parse(payload);
    this.store.set('settings', parsed);
    return parsed;
  }

  public update(patchPayload: unknown): AppConfig {
    const patch = parseConfigPatch(patchPayload);
    const next = applyConfigPatch(this.get(), patch);
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
