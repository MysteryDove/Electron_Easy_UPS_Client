import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppConfig, AppConfigPatch } from './shared/config/types';
import type { TelemetryColumn } from './shared/telemetry/types';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type MainToRendererEventPayloads,
  type NutRetryLocalDriverLaunchResult,
  type NutSetupChooseFolderResult,
  type NutSetupListComPortsResult,
  type NutSetupListSerialDriversPayload,
  type NutSetupListSerialDriversResult,
  type NutSetupPrepareLocalDriverPayload,
  type NutSetupPrepareLocalDriverResult,
  type NutSetupPrepareLocalNutPayload,
  type NutSetupPrepareLocalNutResult,
  type NutSetupPrepareUsbHidPayload,
  type NutSetupPrepareUsbHidResult,
  type NutSetupValidateFolderPayload,
  type NutSetupValidateFolderResult,
  type NutStateSnapshot,
  type QueryRangePayload,
  type SystemOpenExternalPayload,
  type TelemetryDataPoint,
  type TelemetryMinMaxRangePayload,
  type TelemetryRangeLimits,
  type WizardTestConnectionPayload,
  type WizardTestConnectionResult,
  type WizardCompletePayload,
} from './shared/ipc/contracts';

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
    getMinMaxForRange: (payload: TelemetryMinMaxRangePayload): Promise<TelemetryRangeLimits> =>
      ipcRenderer.invoke(IPC_CHANNELS.telemetryGetMinMaxForRange, payload),
  },
  wizard: {
    enter: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.wizardEnter),
    testConnection: (
      payload: WizardTestConnectionPayload,
    ): Promise<WizardTestConnectionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.wizardTestConnection, payload),
    complete: (payload: WizardCompletePayload): Promise<AppConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.wizardComplete, payload),
  },
  nutSetup: {
    chooseFolder: (): Promise<NutSetupChooseFolderResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutSetupChooseFolder),
    validateFolder: (
      payload: NutSetupValidateFolderPayload,
    ): Promise<NutSetupValidateFolderResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutSetupValidateFolder, payload),
    prepareLocalNut: (
      payload: NutSetupPrepareLocalNutPayload,
    ): Promise<NutSetupPrepareLocalNutResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutSetupPrepareLocalNut, payload),
    listSerialDrivers: (
      payload: NutSetupListSerialDriversPayload,
    ): Promise<NutSetupListSerialDriversResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutSetupListSerialDrivers, payload),
    listComPorts: (): Promise<NutSetupListComPortsResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutSetupListComPorts),
    prepareLocalDriver: (
      payload: NutSetupPrepareLocalDriverPayload,
    ): Promise<NutSetupPrepareLocalDriverResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutSetupPrepareLocalDriver, payload),
    prepareUsbHid: (
      payload: NutSetupPrepareUsbHidPayload,
    ): Promise<NutSetupPrepareUsbHidResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutSetupPrepareUsbHid, payload),
  },
  nut: {
    getState: (): Promise<NutStateSnapshot> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutGetState),
    retryLocalDriverLaunch: (): Promise<NutRetryLocalDriverLaunchResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.nutRetryLocalDriverLaunch),
  },
  criticalAlert: {
    test: (): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.criticalAlertTest),
  },
  system: {
    openExternal: (payload: SystemOpenExternalPayload): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.systemOpenExternal, payload),
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
    onUpsDynamicData: (
      listener: (
        payload: MainToRendererEventPayloads[typeof IPC_EVENTS.upsDynamicData],
      ) => void,
    ): (() => void) => subscribeToMainEvent(IPC_EVENTS.upsDynamicData, listener),
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
    onLocalDriverLaunchIssueChanged: (
      listener: (
        payload: MainToRendererEventPayloads[typeof IPC_EVENTS.localDriverLaunchIssueChanged],
      ) => void,
    ): (() => void) =>
      subscribeToMainEvent(IPC_EVENTS.localDriverLaunchIssueChanged, listener),
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
