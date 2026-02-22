import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppConfig, AppConfigPatch } from './main/config/configSchema';
import type {
  QueryRangePayload,
  TelemetryDataPoint,
} from './main/db/telemetryRepository';
import type { TelemetryColumn } from './main/nut/nutValueMapper';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type WizardTestConnectionPayload,
  type WizardTestConnectionResult,
  type WizardCompletePayload,
} from './main/ipc/ipcChannels';
import type { MainToRendererEventPayloads } from './main/ipc/ipcEvents';

const electronApi = {
  settings: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    update: (patch: AppConfigPatch): Promise<AppConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, patch),
  },
  telemetry: {
    getAvailableColumns: (): Promise<TelemetryColumn[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.telemetryGetAvailableColumns),
    getLatest: (): Promise<TelemetryDataPoint | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.telemetryGetLatest),
    queryRange: (payload: QueryRangePayload): Promise<TelemetryDataPoint[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.telemetryQueryRange, payload),
    getMinMaxForRange: (payload: { startIso: string; endIso: string }): Promise<Record<string, { min: number | null; max: number | null }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.telemetryGetMinMaxForRange, payload),
  },
  wizard: {
    testConnection: (
      payload: WizardTestConnectionPayload,
    ): Promise<WizardTestConnectionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.wizardTestConnection, payload),
    complete: (payload: WizardCompletePayload): Promise<AppConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.wizardComplete, payload),
  },
  nut: {
    getState: (): Promise<{ state: import('./main/ipc/ipcEvents').ConnectionState, staticData: Record<string, string> | null }> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutGetState),
  },
  criticalAlert: {
    test: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.criticalAlertTest),
  },
  events: {
    onConnectionStateChanged: (
      listener: (
        payload: MainToRendererEventPayloads[typeof IPC_EVENTS.connectionStateChanged],
      ) => void,
    ): (() => void) =>
      subscribeToMainEvent(IPC_EVENTS.connectionStateChanged, listener),
    onUpsStaticData: (
      listener: (
        payload: MainToRendererEventPayloads[typeof IPC_EVENTS.upsStaticData],
      ) => void,
    ): (() => void) => subscribeToMainEvent(IPC_EVENTS.upsStaticData, listener),
    onUpsTelemetryUpdated: (
      listener: (
        payload: MainToRendererEventPayloads[typeof IPC_EVENTS.upsTelemetryUpdated],
      ) => void,
    ): (() => void) =>
      subscribeToMainEvent(IPC_EVENTS.upsTelemetryUpdated, listener),
    onThemeSystemChanged: (
      listener: (
        payload: MainToRendererEventPayloads[typeof IPC_EVENTS.themeSystemChanged],
      ) => void,
    ): (() => void) =>
      subscribeToMainEvent(IPC_EVENTS.themeSystemChanged, listener),
  },
};

contextBridge.exposeInMainWorld('electronApi', electronApi);

export type ElectronApi = typeof electronApi;

function subscribeToMainEvent<EventName extends keyof MainToRendererEventPayloads>(
  eventName: EventName,
  listener: (payload: MainToRendererEventPayloads[EventName]) => void,
): () => void {
  const wrappedListener = (
    _event: IpcRendererEvent,
    payload: MainToRendererEventPayloads[EventName],
  ) => {
    listener(payload);
  };

  ipcRenderer.on(eventName, wrappedListener);
  return () => {
    ipcRenderer.removeListener(eventName, wrappedListener);
  };
}

