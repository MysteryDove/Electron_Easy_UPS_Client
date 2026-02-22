import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import type { AppConfig } from '../../main/config/configSchema';
import type { ConnectionState } from '../../main/ipc/ipcEvents';
import type { TelemetryValues } from '../../main/db/telemetryRepository';
import i18n, { fallbackSystem } from '../i18n';
import { I18nextProvider } from 'react-i18next';

declare global {
    interface Window {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        electronApi: any;
    }
}

// ---------------------------------------------------------------------------
// Connection context
// ---------------------------------------------------------------------------

type ConnectionContextValue = {
    state: ConnectionState;
    staticData: Record<string, string> | null;
    lastTelemetry: { ts: string; values: TelemetryValues } | null;
};

const ConnectionContext = createContext<ConnectionContextValue>({
    state: 'idle',
    staticData: null,
    lastTelemetry: null,
});

export function useConnection() {
    return useContext(ConnectionContext);
}

// ---------------------------------------------------------------------------
// Config context
// ---------------------------------------------------------------------------

type ConfigContextValue = {
    config: AppConfig | null;
    refreshConfig: () => Promise<void>;
};

const ConfigContext = createContext<ConfigContextValue>({
    config: null,
    refreshConfig: async () => { /* noop default */ },
});

export function useAppConfig() {
    return useContext(ConfigContext);
}

// ---------------------------------------------------------------------------
// Theme context
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Combined provider
// ---------------------------------------------------------------------------

export function AppProviders({ children }: { children: ReactNode }) {
    // -- Connection state --
    const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
    const [staticData, setStaticData] = useState<Record<string, string> | null>(null);
    const [lastTelemetry, setLastTelemetry] = useState<{
        ts: string;
        values: TelemetryValues;
    } | null>(null);

    useEffect(() => {
        const unsubs: Array<() => void> = [];

        // Fetch initial state first
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        window.electronApi?.nut?.getState().then((res: any) => {
            setConnectionState(res.state);
            setStaticData(res.staticData);
        }).catch(() => {
            // ignore error
        });

        if (window.electronApi?.events?.onConnectionStateChanged) {
            unsubs.push(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                window.electronApi.events.onConnectionStateChanged((payload: any) => {
                    setConnectionState(payload.state);
                }),
            );
        }

        if (window.electronApi?.events?.onUpsStaticData) {
            unsubs.push(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                window.electronApi.events.onUpsStaticData((payload: any) => {
                    setStaticData(payload.values);
                }),
            );
        }

        if (window.electronApi?.events?.onUpsTelemetryUpdated) {
            unsubs.push(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                window.electronApi.events.onUpsTelemetryUpdated((payload: any) => {
                    setLastTelemetry({ ts: payload.ts, values: payload.values });
                }),
            );
        }

        return () => unsubs.forEach((fn) => fn());
    }, []);

    const connectionValue = useMemo<ConnectionContextValue>(
        () => ({ state: connectionState, staticData, lastTelemetry }),
        [connectionState, staticData, lastTelemetry],
    );

    // -- Config --
    const [config, setConfig] = useState<AppConfig | null>(null);

    const refreshConfig = async () => {
        try {
            const cfg = await window.electronApi.settings.get();
            setConfig(cfg);
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        void refreshConfig();
    }, []);

    const configValue = useMemo<ConfigContextValue>(
        () => ({ config, refreshConfig }),
        [config, refreshConfig],
    );

    // -- i18n Sync --
    useEffect(() => {
        if (!config?.i18n?.locale) return;
        const localeToUse = config.i18n.locale === 'system' ? fallbackSystem : config.i18n.locale;
        if (i18n.language !== localeToUse) {
            void i18n.changeLanguage(localeToUse);
        }
    }, [config?.i18n?.locale]);

    // -- Theme --
    const [systemDark, setSystemDark] = useState<boolean>(() => {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return false;
    });

    useEffect(() => {
        if (window.electronApi?.events?.onThemeSystemChanged) {
            const unsub = window.electronApi.events.onThemeSystemChanged(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (payload: any) => {
                    setSystemDark(payload.shouldUseDarkColors);
                },
            );
            return unsub;
        }
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
                    <I18nextProvider i18n={i18n}>
                        {children}
                    </I18nextProvider>
                </ThemeContext.Provider>
            </ConfigContext.Provider>
        </ConnectionContext.Provider>
    );
}
