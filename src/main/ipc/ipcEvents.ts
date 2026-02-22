import { IPC_EVENTS } from './ipcChannels';
import type { TelemetryValues } from '../db/telemetryRepository';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'initializing'
  | 'ready'
  | 'degraded'
  | 'reconnecting';

export type MainToRendererEventPayloads = {
  [IPC_EVENTS.connectionStateChanged]: {
    state: ConnectionState;
  };
  [IPC_EVENTS.upsStaticData]: {
    values: Record<string, string>;
    fields: {
      available: string[];
      static: string[];
      dynamic: string[];
    };
  };
  [IPC_EVENTS.upsTelemetryUpdated]: {
    ts: string;
    values: TelemetryValues;
  };
  [IPC_EVENTS.themeSystemChanged]: {
    shouldUseDarkColors: boolean;
  };
};
