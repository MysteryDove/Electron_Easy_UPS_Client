import { ipcMain, nativeTheme, BrowserWindow } from 'electron';
import type { ConfigStore } from '../config/configStore';
import type { RetentionService } from '../db/retentionService';
import type {
  QueryRangePayload,
  TelemetryRepository,
} from '../db/telemetryRepository';
import { NutClient } from '../nut/nutClient';
import type { NutPollingService } from '../nut/nutPollingService';
import {
  TELEMETRY_COLUMNS,
  type TelemetryColumn,
} from '../nut/nutValueMapper';
import type { BatterySafetyService } from '../system/batterySafetyService';
import type { CriticalAlertWindow } from '../system/criticalAlertWindow';
import type { LineAlertService } from '../system/lineAlertService';
import { i18nService } from '../system/i18nService';
import type { TrayService } from '../system/trayService';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type WizardTestConnectionPayload,
  type WizardTestConnectionResult,
  type WizardCompletePayload,
} from './ipcChannels';

let isRegistered = false;

export type IpcHandlerDependencies = {
  configStore: ConfigStore;
  telemetryRepository: TelemetryRepository;
  retentionService: RetentionService;
  nutPollingService: NutPollingService;
  trayService: TrayService;
  batterySafetyService: BatterySafetyService;
  criticalAlertWindow: CriticalAlertWindow;
  lineAlertService: LineAlertService;
};

export function registerIpcHandlers(dependencies: IpcHandlerDependencies): void {
  if (isRegistered) {
    return;
  }
  isRegistered = true;

  // Initialize nativeTheme from initial config
  const initialConfig = dependencies.configStore.get();
  nativeTheme.themeSource = initialConfig.theme?.mode ?? 'system';

  nativeTheme.on('updated', () => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_EVENTS.themeSystemChanged, {
        shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
      });
    });
  });

  ipcMain.handle(IPC_CHANNELS.settingsGet, async () =>
    dependencies.configStore.get(),
  );

  ipcMain.handle(
    IPC_CHANNELS.settingsUpdate,
    async (_event, payload: unknown) => {
      const previousConfig = dependencies.configStore.get();
      const updatedConfig = dependencies.configStore.update(payload);

      // Instantly apply theme to the Electron backend so it propagates to WebContents
      if (updatedConfig.theme?.mode) {
        nativeTheme.themeSource = updatedConfig.theme.mode;
      }

      await dependencies.nutPollingService.handleConfigUpdated(
        previousConfig,
        updatedConfig,
      );
      await dependencies.retentionService.runOnce();
      await i18nService.handleConfigUpdated(updatedConfig);
      dependencies.trayService.handleConfigUpdated(updatedConfig);
      dependencies.batterySafetyService.handleConfigUpdated(updatedConfig);
      dependencies.lineAlertService.handleConfigUpdated(updatedConfig);
      return updatedConfig;
    },
  );

  ipcMain.handle(IPC_CHANNELS.criticalAlertTest, async () => {
    dependencies.criticalAlertWindow.show({
      title: 'Test Alert',
      body: 'This is a test of the critical alert system. Click Dismiss to close.',
      batteryPct: 5,
      shutdownPct: 20,
      showShutdown: false,
    });
  });

  ipcMain.handle(IPC_CHANNELS.telemetryGetAvailableColumns, async () =>
    dependencies.telemetryRepository.getAvailableColumns(),
  );

  ipcMain.handle(
    IPC_CHANNELS.telemetryQueryRange,
    async (_event, payload: unknown) =>
      dependencies.telemetryRepository.queryRange(
        normalizeQueryRangePayload(payload),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.telemetryGetMinMaxForRange,
    async (_event, payload: { startIso: string; endIso: string }) =>
      dependencies.telemetryRepository.getMinMaxForRange(
        payload.startIso,
        payload.endIso,
      ),
  );

  ipcMain.handle(IPC_CHANNELS.nutGetState, async () => ({
    state: dependencies.nutPollingService.getState(),
    staticData: dependencies.nutPollingService.getStaticSnapshot(),
  }));

  ipcMain.handle(
    IPC_CHANNELS.wizardTestConnection,
    async (_event, payload: unknown) =>
      handleWizardTestConnection(normalizeWizardTestPayload(payload)),
  );

  ipcMain.handle(
    IPC_CHANNELS.wizardComplete,
    async (_event, payload: unknown) =>
      handleWizardComplete(
        normalizeWizardCompletePayload(payload),
        dependencies,
      ),
  );

  isRegistered = true;
}

// ---------------------------------------------------------------------------
// Wizard: test-connection
// ---------------------------------------------------------------------------

async function handleWizardTestConnection(
  payload: WizardTestConnectionPayload,
): Promise<WizardTestConnectionResult> {
  const testClient = new NutClient();

  try {
    await testClient.connect({
      host: payload.host,
      port: payload.port,
      username: payload.username,
      password: payload.password,
      upsName: payload.upsName,
      timeoutMs: 5000,
    });

    const variables = await testClient.listVariables(payload.upsName);
    const description =
      variables['ups.model'] ||
      variables['device.model'] ||
      variables['ups.mfr'] ||
      undefined;

    return { success: true, upsDescription: description, variables };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown connection error';
    return { success: false, error: message };
  } finally {
    await testClient.close().catch(() => {
      /* ignore close errors */
    });
  }
}

function normalizeWizardTestPayload(
  payload: unknown,
): WizardTestConnectionPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Wizard test-connection payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.host !== 'string' || !candidate.host) {
    throw new Error('host is required');
  }

  if (typeof candidate.port !== 'number') {
    throw new Error('port is required');
  }

  if (typeof candidate.upsName !== 'string' || !candidate.upsName) {
    throw new Error('upsName is required');
  }

  const result: WizardTestConnectionPayload = {
    host: candidate.host,
    port: candidate.port,
    upsName: candidate.upsName,
  };

  if (typeof candidate.username === 'string' && candidate.username) {
    result.username = candidate.username;
  }

  if (typeof candidate.password === 'string' && candidate.password) {
    result.password = candidate.password;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Wizard: complete
// ---------------------------------------------------------------------------

async function handleWizardComplete(
  payload: WizardCompletePayload,
  deps: IpcHandlerDependencies,
): Promise<ReturnType<ConfigStore['get']>> {
  const previousConfig = deps.configStore.get();

  const updatedConfig = deps.configStore.update({
    nut: {
      host: payload.host,
      port: payload.port,
      username: payload.username,
      password: payload.password,
      upsName: payload.upsName,
      mapping: payload.mapping,
    },
    wizard: { completed: true },
    line: payload.line,
  });

  await deps.nutPollingService.handleConfigUpdated(
    previousConfig,
    updatedConfig,
  );
  deps.trayService.handleConfigUpdated(updatedConfig);
  deps.batterySafetyService.handleConfigUpdated(updatedConfig);
  deps.lineAlertService.handleConfigUpdated(updatedConfig);

  return updatedConfig;
}

function normalizeWizardCompletePayload(
  payload: unknown,
): WizardCompletePayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Wizard complete payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.host !== 'string' || !candidate.host) {
    throw new Error('host is required');
  }

  if (typeof candidate.port !== 'number') {
    throw new Error('port is required');
  }

  if (typeof candidate.upsName !== 'string' || !candidate.upsName) {
    throw new Error('upsName is required');
  }

  const result: WizardCompletePayload = {
    host: candidate.host,
    port: candidate.port,
    upsName: candidate.upsName,
  };

  if (typeof candidate.username === 'string' && candidate.username) {
    result.username = candidate.username;
  }

  if (typeof candidate.password === 'string' && candidate.password) {
    result.password = candidate.password;
  }

  if (candidate.mapping !== undefined) {
    if (typeof candidate.mapping !== 'object' || candidate.mapping === null) {
      throw new Error('mapping must be an object');
    }
    result.mapping = candidate.mapping as Record<string, string>;
  }

  if (candidate.line !== undefined) {
    const lineObj = candidate.line as Record<string, unknown>;
    if (
      typeof lineObj === 'object' &&
      lineObj !== null &&
      typeof lineObj.nominalVoltage === 'number' &&
      typeof lineObj.nominalFrequency === 'number'
    ) {
      result.line = {
        nominalVoltage: lineObj.nominalVoltage,
        nominalFrequency: lineObj.nominalFrequency,
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Telemetry query helpers
// ---------------------------------------------------------------------------

function normalizeQueryRangePayload(payload: unknown): QueryRangePayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Telemetry query payload must be an object');
  }

  const candidate = payload as {
    startIso?: unknown;
    endIso?: unknown;
    columns?: unknown;
    maxPoints?: unknown;
  };

  if (typeof candidate.startIso !== 'string') {
    throw new Error('Telemetry query payload requires startIso');
  }

  if (typeof candidate.endIso !== 'string') {
    throw new Error('Telemetry query payload requires endIso');
  }

  const normalized: QueryRangePayload = {
    startIso: candidate.startIso,
    endIso: candidate.endIso,
  };

  if (typeof candidate.maxPoints === 'number') {
    normalized.maxPoints = candidate.maxPoints;
  }

  if (Array.isArray(candidate.columns)) {
    normalized.columns = candidate.columns.filter(isTelemetryColumn);
  }

  return normalized;
}

function isTelemetryColumn(value: unknown): value is TelemetryColumn {
  return (
    typeof value === 'string' &&
    TELEMETRY_COLUMNS.includes(value as TelemetryColumn)
  );
}
