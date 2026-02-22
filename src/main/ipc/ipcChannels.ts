import type { AppConfig, AppConfigPatch } from '../config/configSchema';
import type { QueryRangePayload, TelemetryDataPoint } from '../db/telemetryRepository';
import type { TelemetryColumn } from '../nut/nutValueMapper';

export const IPC_CHANNELS = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  telemetryGetAvailableColumns: 'telemetry:get-available-columns',
  telemetryQueryRange: 'telemetry:query-range',
  telemetryGetMinMaxForRange: 'telemetry:get-minmax-for-range',
  wizardTestConnection: 'wizard:test-connection',
  wizardComplete: 'wizard:complete',
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
  [IPC_CHANNELS.telemetryQueryRange]: {
    request: QueryRangePayload;
    response: TelemetryDataPoint[];
  };
  [IPC_CHANNELS.wizardTestConnection]: {
    request: WizardTestConnectionPayload;
    response: WizardTestConnectionResult;
  };
  [IPC_CHANNELS.wizardComplete]: {
    request: WizardCompletePayload;
    response: AppConfig;
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
