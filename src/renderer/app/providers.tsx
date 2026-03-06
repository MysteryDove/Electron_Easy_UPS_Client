import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { I18nextProvider } from 'react-i18next';
import { electronApi } from './electronApi';
import type { AppConfig } from '../../shared/config/types';
import type {
  ConnectionState,
  LocalDriverLaunchIssue,
  MainToRendererEventPayloads,
  TelemetryValues,
} from '../../shared/ipc/contracts';
import i18n, { fallbackSystem } from '../i18n';

type ConnectionContextValue = {
  state: ConnectionState;
  staticData: Record<string, string> | null;
  dynamicData: Record<string, string> | null;
  lastTelemetry: { ts: string; values: TelemetryValues } | null;
  localDriverLaunchIssue: LocalDriverLaunchIssue | null;
};

const ConnectionContext = createContext<ConnectionContextValue>({
  state: 'idle',
  staticData: null,
  dynamicData: null,
  lastTelemetry: null,
  localDriverLaunchIssue: null,
});

export function useConnection() {
  return useContext(ConnectionContext);
}

type ConfigContextValue = {
  config: AppConfig | null;
  refreshConfig: () => Promise<void>;
};

const ConfigContext = createContext<ConfigContextValue>({
  config: null,
  refreshConfig: async () => {
    // noop default
  },
});

export function useAppConfig() {
  return useContext(ConfigContext);
}

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  resolvedTheme: 'light' | 'dark';
  themeMode: ThemeMode;
};

const ThemeContext = createContext<ThemeContextValue>({
  resolvedTheme: 'dark',
  themeMode: 'system',
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [staticData, setStaticData] = useState<Record<string, string> | null>(null);
  const [dynamicData, setDynamicData] = useState<Record<string, string> | null>(null);
  const [lastTelemetry, setLastTelemetry] = useState<{
    ts: string;
    values: TelemetryValues;
  } | null>(null);
  const [localDriverLaunchIssue, setLocalDriverLaunchIssue] =
    useState<LocalDriverLaunchIssue | null>(null);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const bootstrapConnectionState = async () => {
      try {
        const [stateResult, latestTelemetryResult] = await Promise.all([
          electronApi.nut.getState(),
          electronApi.telemetry.getLatest(),
        ]);

        setConnectionState(stateResult.state);
        setStaticData(stateResult.staticData);
        setDynamicData(stateResult.dynamicData);
        setLocalDriverLaunchIssue(stateResult.localDriverLaunchIssue ?? null);

        if (latestTelemetryResult) {
          setLastTelemetry({
            ts: latestTelemetryResult.ts,
            values: latestTelemetryResult.values,
          });
        }
      } catch {
        // ignore bootstrap error
      }
    };

    void bootstrapConnectionState();

    unsubs.push(
      electronApi.events.onConnectionStateChanged(
        (
          payload: MainToRendererEventPayloads['connection:state-changed'],
        ) => {
          setConnectionState(payload.state);
        },
      ),
    );

    unsubs.push(
      electronApi.events.onUpsStaticData(
        (payload: MainToRendererEventPayloads['ups:static-data']) => {
          setStaticData(payload.values);
        },
      ),
    );

    unsubs.push(
      electronApi.events.onUpsDynamicData(
        (payload: MainToRendererEventPayloads['ups:dynamic-data']) => {
          setDynamicData(payload.values);
        },
      ),
    );

    unsubs.push(
      electronApi.events.onUpsTelemetryUpdated(
        (payload: MainToRendererEventPayloads['ups:telemetry-updated']) => {
          setLastTelemetry({ ts: payload.ts, values: payload.values });
        },
      ),
    );

    unsubs.push(
      electronApi.events.onLocalDriverLaunchIssueChanged(
        (
          payload: MainToRendererEventPayloads['local-driver-launch-issue:changed'],
        ) => {
          setLocalDriverLaunchIssue(payload.issue ?? null);
        },
      ),
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, []);

  const connectionValue = useMemo<ConnectionContextValue>(
    () => ({
      state: connectionState,
      staticData,
      dynamicData,
      lastTelemetry,
      localDriverLaunchIssue,
    }),
    [connectionState, staticData, dynamicData, lastTelemetry, localDriverLaunchIssue],
  );

  const [config, setConfig] = useState<AppConfig | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await electronApi.settings.get();
      setConfig(cfg);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const configValue = useMemo<ConfigContextValue>(
    () => ({ config, refreshConfig }),
    [config, refreshConfig],
  );

  useEffect(() => {
    if (!config?.i18n?.locale) {
      return;
    }

    const localeToUse =
      config.i18n.locale === 'system' ? fallbackSystem : config.i18n.locale;
    if (i18n.language !== localeToUse) {
      void i18n.changeLanguage(localeToUse);
    }
  }, [config?.i18n?.locale]);

  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const unsub = electronApi.events.onThemeSystemChanged(
      (payload: MainToRendererEventPayloads['theme:system-changed']) => {
        setSystemDark(payload.shouldUseDarkColors);
      },
    );
    return unsub;
  }, []);

  const themeMode: ThemeMode = config?.theme?.mode ?? 'system';
  const resolvedTheme: 'light' | 'dark' =
    themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const themeValue = useMemo<ThemeContextValue>(
    () => ({ resolvedTheme, themeMode }),
    [resolvedTheme, themeMode],
  );

  return (
    <ConnectionContext.Provider value={connectionValue}>
      <ConfigContext.Provider value={configValue}>
        <ThemeContext.Provider value={themeValue}>
          <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        </ThemeContext.Provider>
      </ConfigContext.Provider>
    </ConnectionContext.Provider>
  );
}
