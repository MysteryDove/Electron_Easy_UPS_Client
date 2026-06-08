import type { ComponentType, ReactNode } from 'react';
import type { AppConfig } from '../../../shared/config/types';
import type {
  ConnectionState,
  LocalDriverLaunchIssue,
  TelemetryDataPoint,
  TelemetryValues,
} from '../../../shared/ipc/contracts';

export type DashboardTelemetryUpdateCallback = (
  values: TelemetryValues,
) => void;

export interface DashboardData {
  connection: {
    state: ConnectionState;
    lastUpdateTime: Date | null;
    isStale: boolean;
    driverIssue: LocalDriverLaunchIssue | null;
  };
  ups: {
    static: Record<string, string> | null;
    dynamic: Record<string, string> | null;
  };
  telemetry: {
    latest: TelemetryDataPoint | null;
    history: TelemetryDataPoint[];
    onUpdate: (
      callback: DashboardTelemetryUpdateCallback,
    ) => () => void;
  };
  config: AppConfig;
}

export interface DashboardDataProviderProps {
  children: ReactNode;
}

export interface DashboardTemplateMetadata {
  id: string;
  name: string;
  description: string;
  previewImage?: string;
}

export type DashboardTemplateComponent = ComponentType;

export interface DashboardTemplate {
  metadata: DashboardTemplateMetadata;
  Component: DashboardTemplateComponent;
}