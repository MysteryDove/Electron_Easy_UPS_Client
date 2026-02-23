import type { AppConfig, AppConfigPatch } from '../config/configSchema';
import type { QueryRangePayload, TelemetryDataPoint } from '../db/telemetryRepository';
import type { TelemetryColumn } from '../nut/nutValueMapper';

export const IPC_CHANNELS = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  telemetryGetAvailableColumns: 'telemetry:get-available-columns',
  telemetryGetLatest: 'telemetry:get-latest',
  telemetryQueryRange: 'telemetry:query-range',
  telemetryGetMinMaxForRange: 'telemetry:get-minmax-for-range',
  wizardTestConnection: 'wizard:test-connection',
  wizardComplete: 'wizard:complete',
  nutSetupChooseFolder: 'nut-setup:choose-folder',
  nutSetupValidateFolder: 'nut-setup:validate-folder',
  nutSetupPrepareLocalNut: 'nut-setup:prepare-local-nut',
  nutGetState: 'nut:get-state',
  criticalAlertTest: 'critical-alert:test',
} as const;

export const IPC_EVENTS = {
  connectionStateChanged: 'connection:state-changed',
  upsStaticData: 'ups:static-data',
  upsTelemetryUpdated: 'ups:telemetry-updated',
  themeSystemChanged: 'theme:system-changed',
} as const;

export type WizardTestConnectionPayload = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  upsName: string;
};

export type WizardTestConnectionResult = {
  success: boolean;
  error?: string;
  upsDescription?: string;
  variables?: Record<string, string>;
};

export type WizardCompletePayload = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  upsName: string;
  mapping?: Record<string, string>;
  line?: { nominalVoltage: number; nominalFrequency: number };
  launchLocalComponents?: boolean;
  localNutFolderPath?: string;
};

export type NutSetupChooseFolderResult = {
  cancelled: boolean;
  folderPath?: string;
};

export type NutSetupValidateFolderPayload = {
  folderPath: string;
};

export type NutSetupValidateFolderResult = {
  valid: boolean;
  missing: string[];
  writable: boolean;
};

export type NutSetupPrepareLocalNutPayload = {
  folderPath: string;
  upsName: string;
  port: string;
  snmpVersion: 'v1' | 'v2c' | 'v3';
  mibs: string;
  community: string;
  pollfreq: number;
  secLevel?: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  secName?: string;
  authProtocol?: 'MD5' | 'SHA';
  authPassword?: string;
  privProtocol?: 'DES' | 'AES';
  privPassword?: string;
};

export type NutSetupPrepareLocalNutResult = {
  success: boolean;
  error?: string;
};

export type RendererInvokeMap = {
  [IPC_CHANNELS.settingsGet]: {
    request: void;
    response: AppConfig;
  };
  [IPC_CHANNELS.settingsUpdate]: {
    request: AppConfigPatch;
    response: AppConfig;
  };
  [IPC_CHANNELS.telemetryGetAvailableColumns]: {
    request: void;
    response: TelemetryColumn[];
  };
  [IPC_CHANNELS.telemetryGetLatest]: {
    request: void;
    response: TelemetryDataPoint | null;
  };
  [IPC_CHANNELS.telemetryQueryRange]: {
    request: QueryRangePayload;
    response: TelemetryDataPoint[];
  };
  [IPC_CHANNELS.telemetryGetMinMaxForRange]: {
    request: { startIso: string; endIso: string };
    response: Record<string, { min: number | null; max: number | null }>;
  };
  [IPC_CHANNELS.wizardTestConnection]: {
    request: WizardTestConnectionPayload;
    response: WizardTestConnectionResult;
  };
  [IPC_CHANNELS.wizardComplete]: {
    request: WizardCompletePayload;
    response: AppConfig;
  };
  [IPC_CHANNELS.nutSetupChooseFolder]: {
    request: void;
    response: NutSetupChooseFolderResult;
  };
  [IPC_CHANNELS.nutSetupValidateFolder]: {
    request: NutSetupValidateFolderPayload;
    response: NutSetupValidateFolderResult;
  };
  [IPC_CHANNELS.nutSetupPrepareLocalNut]: {
    request: NutSetupPrepareLocalNutPayload;
    response: NutSetupPrepareLocalNutResult;
  };
  [IPC_CHANNELS.nutGetState]: {
    request: void;
    response: {
      state: import('./ipcEvents').ConnectionState;
      staticData: Record<string, string> | null;
    };
  };
};

export type RendererInvokeChannel = keyof RendererInvokeMap;
