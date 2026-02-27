import { ipcMain, nativeTheme, BrowserWindow, dialog } from 'electron';
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
import { applyStartWithWindowsSetting } from '../system/startupService';
import type { TrayService } from '../system/trayService';
import {
  listComPorts,
  listSerialDrivers,
  prepareLocalDriver,
  prepareLocalNut,
  validateNutFolder,
  waitForSerialDriverReady,
} from '../nut/nutSetupService';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type NutSetupListSerialDriversPayload,
  type NutSetupPrepareLocalDriverPayload,
  type NutSetupPrepareLocalDriverResult,
  type WizardTestConnectionPayload,
  type WizardTestConnectionResult,
  type WizardCompletePayload,
  type NutSetupValidateFolderPayload,
  type NutSetupPrepareLocalNutPayload,
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
  applyStartWithWindowsSetting(initialConfig.startup.startWithWindows);

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
      applyStartWithWindowsSetting(updatedConfig.startup.startWithWindows);

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

  ipcMain.handle(IPC_CHANNELS.telemetryGetLatest, async () =>
    dependencies.telemetryRepository.getLatestTelemetryPoint(),
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

  ipcMain.handle(IPC_CHANNELS.nutSetupChooseFolder, async () => {
    const activeWindow = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = await dialog.showOpenDialog(activeWindow, {
      title: 'Select extracted NUT folder',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true };
    }

    return {
      cancelled: false,
      folderPath: result.filePaths[0],
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.nutSetupValidateFolder,
    async (_event, payload: unknown) =>
      validateNutFolder(normalizeNutSetupValidatePayload(payload).folderPath),
  );

  ipcMain.handle(
    IPC_CHANNELS.nutSetupPrepareLocalNut,
    async (_event, payload: unknown) => {
      const normalizedPayload = normalizeNutSetupPreparePayload(payload);
      const prepareResult = await prepareLocalNut(normalizedPayload);
      if (!prepareResult.success) {
        return prepareResult;
      }

      try {
        await dependencies.nutPollingService.startLocalComponentsForWizard(
          normalizedPayload.folderPath,
          normalizedPayload.upsName,
        );
        return prepareResult;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.nutSetupListSerialDrivers,
    async (_event, payload: unknown) =>
      listSerialDrivers(
        normalizeNutSetupListSerialDriversPayload(payload).folderPath,
      ),
  );

  ipcMain.handle(IPC_CHANNELS.nutSetupListComPorts, async () =>
    listComPorts(),
  );

  ipcMain.handle(
    IPC_CHANNELS.nutSetupPrepareLocalDriver,
    async (_event, payload: unknown): Promise<NutSetupPrepareLocalDriverResult> => {
      const normalizedPayload = normalizeNutSetupPrepareDriverPayload(payload);
      const prepareResult = await prepareLocalDriver(normalizedPayload);
      if (!prepareResult.success) {
        return {
          ...prepareResult,
          errorCode: prepareResult.errorCode ?? 'SERIAL_DRIVER_STARTUP_FAILED',
          technicalDetails:
            prepareResult.technicalDetails ??
            buildTechnicalDetails(prepareResult.error ?? ''),
        };
      }

      try {
        await dependencies.nutPollingService.startLocalComponentsForWizard(
          normalizedPayload.folderPath,
          normalizedPayload.upsName,
        );
        await waitForSerialDriverReady({
          folderPath: normalizedPayload.folderPath,
          upsName: normalizedPayload.upsName,
        });
        return prepareResult;
      } catch (error) {
        return classifySerialDriverFailure(normalizedPayload, error);
      }
    },
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
      launchLocalComponents: payload.launchLocalComponents,
      localNutFolderPath: payload.localNutFolderPath,
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

  if (candidate.launchLocalComponents !== undefined) {
    if (typeof candidate.launchLocalComponents !== 'boolean') {
      throw new Error('launchLocalComponents must be a boolean');
    }
    result.launchLocalComponents = candidate.launchLocalComponents;
  }

  if (candidate.localNutFolderPath !== undefined) {
    if (
      typeof candidate.localNutFolderPath !== 'string' ||
      !candidate.localNutFolderPath.trim()
    ) {
      throw new Error('localNutFolderPath must be a non-empty string');
    }
    result.localNutFolderPath = candidate.localNutFolderPath;
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

function normalizeNutSetupValidatePayload(
  payload: unknown,
): NutSetupValidateFolderPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup validate payload must be an object');
  }

  const candidate = payload as { folderPath?: unknown };
  if (typeof candidate.folderPath !== 'string' || !candidate.folderPath.trim()) {
    throw new Error('folderPath is required');
  }

  return { folderPath: candidate.folderPath };
}

function normalizeNutSetupListSerialDriversPayload(
  payload: unknown,
): NutSetupListSerialDriversPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup list-serial-drivers payload must be an object');
  }

  const candidate = payload as { folderPath?: unknown };
  if (typeof candidate.folderPath !== 'string' || !candidate.folderPath.trim()) {
    throw new Error('folderPath is required');
  }

  return { folderPath: candidate.folderPath };
}

function normalizeNutSetupPreparePayload(
  payload: unknown,
): NutSetupPrepareLocalNutPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup prepare payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;
  const requiredStringFields: Array<keyof NutSetupPrepareLocalNutPayload> = [
    'folderPath',
    'upsName',
    'port',
    'mibs',
    'community',
  ];

  for (const field of requiredStringFields) {
    if (typeof candidate[field] !== 'string' || !(candidate[field] as string).trim()) {
      throw new Error(`${field} is required`);
    }
  }

  if (
    candidate.snmpVersion !== 'v1' &&
    candidate.snmpVersion !== 'v2c' &&
    candidate.snmpVersion !== 'v3'
  ) {
    throw new Error('snmpVersion must be v1, v2c, or v3');
  }

  if (typeof candidate.pollfreq !== 'number') {
    throw new Error('pollfreq is required');
  }

  const result: NutSetupPrepareLocalNutPayload = {
    folderPath: candidate.folderPath as string,
    upsName: candidate.upsName as string,
    port: candidate.port as string,
    snmpVersion: candidate.snmpVersion,
    mibs: candidate.mibs as string,
    community: candidate.community as string,
    pollfreq: candidate.pollfreq,
  };

  if (
    candidate.secLevel === 'noAuthNoPriv' ||
    candidate.secLevel === 'authNoPriv' ||
    candidate.secLevel === 'authPriv'
  ) {
    result.secLevel = candidate.secLevel;
  }

  if (typeof candidate.secName === 'string') {
    result.secName = candidate.secName;
  }

  if (candidate.authProtocol === 'MD5' || candidate.authProtocol === 'SHA') {
    result.authProtocol = candidate.authProtocol;
  }

  if (typeof candidate.authPassword === 'string') {
    result.authPassword = candidate.authPassword;
  }

  if (candidate.privProtocol === 'DES' || candidate.privProtocol === 'AES') {
    result.privProtocol = candidate.privProtocol;
  }

  if (typeof candidate.privPassword === 'string') {
    result.privPassword = candidate.privPassword;
  }

  return result;
}

function normalizeNutSetupPrepareDriverPayload(
  payload: unknown,
): NutSetupPrepareLocalDriverPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup prepare-driver payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;
  const requiredStringFields: Array<keyof NutSetupPrepareLocalDriverPayload> = [
    'folderPath',
    'upsName',
    'driver',
    'port',
  ];

  for (const field of requiredStringFields) {
    if (typeof candidate[field] !== 'string' || !(candidate[field] as string).trim()) {
      throw new Error(`${field} is required`);
    }
  }

  const result: NutSetupPrepareLocalDriverPayload = {
    folderPath: candidate.folderPath as string,
    upsName: candidate.upsName as string,
    driver: candidate.driver as string,
    port: candidate.port as string,
  };

  if (typeof candidate.ttymode === 'string' && candidate.ttymode.trim()) {
    result.ttymode = candidate.ttymode;
  }

  return result;
}

async function classifySerialDriverFailure(
  payload: NutSetupPrepareLocalDriverPayload,
  error: unknown,
): Promise<NutSetupPrepareLocalDriverResult> {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const technicalDetails = buildTechnicalDetails(rawMessage);
  const selectedPort = normalizeComPortToken(payload.port);
  const normalizedMessage = rawMessage.toLowerCase();
  const mentionsSelectedPort = selectedPort
    ? normalizedMessage.includes(selectedPort.toLowerCase())
    : false;
  const hasPortOpenFailure = /(?:unable|failed)\s+to\s+open\s+com\d+/iu.test(rawMessage) ||
    /cannot\s+open\s+com\d+/iu.test(rawMessage);
  const hasAccessDeniedHint = /operation not permitted|access is denied|permission denied|device or resource busy|resource busy|port is busy|in use/iu.test(rawMessage);

  if (
    (hasPortOpenFailure && hasAccessDeniedHint) ||
    (mentionsSelectedPort && hasAccessDeniedHint)
  ) {
    return {
      success: false,
      errorCode: 'SERIAL_COM_PORT_ACCESS',
      error: selectedPort
        ? `Unable to open ${selectedPort}. The port is in use or access is denied. Close other serial applications and try again.`
        : 'Unable to open the selected COM port. The port is in use or access is denied. Close other serial applications and try again.',
      technicalDetails,
    };
  }

  if (/timed out waiting for serial driver initialization/iu.test(rawMessage)) {
    const portExists = selectedPort
      ? await detectComPortPresence(selectedPort)
      : null;

    if (selectedPort && portExists === false) {
      return {
        success: false,
        errorCode: 'SERIAL_COM_PORT_MISSING',
        error: `${selectedPort} is no longer available. Reconnect the UPS serial cable, verify the COM port, and try again.`,
        technicalDetails,
      };
    }

    return {
      success: false,
      errorCode: 'SERIAL_DRIVER_INIT_TIMEOUT',
      error: 'The serial driver started, but UPS status did not become ready in time. Verify the COM port, cable, and driver compatibility.',
      technicalDetails,
    };
  }

  if (selectedPort) {
    const portExists = await detectComPortPresence(selectedPort);
    if (portExists === false) {
      return {
        success: false,
        errorCode: 'SERIAL_COM_PORT_MISSING',
        error: `${selectedPort} is not currently available. Reconnect the UPS serial cable, refresh COM ports, and try again.`,
        technicalDetails,
      };
    }
  }

  if (hasPortOpenFailure) {
    return {
      success: false,
      errorCode: 'SERIAL_COM_PORT_ACCESS',
      error: selectedPort
        ? `Unable to open ${selectedPort}. Check whether the port is in use or blocked by permissions.`
        : 'Unable to open the selected COM port. Check whether the port is in use or blocked by permissions.',
      technicalDetails,
    };
  }

  return {
    success: false,
    errorCode: 'SERIAL_DRIVER_STARTUP_FAILED',
    error: rawMessage || 'Failed to configure and start local NUT serial driver',
    technicalDetails,
  };
}

function normalizeComPortToken(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!/^COM\d+$/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

async function detectComPortPresence(port: string): Promise<boolean | null> {
  try {
    const ports = await listComPorts();
    return ports.ports.includes(port);
  } catch {
    return null;
  }
}

function buildTechnicalDetails(rawMessage: string): string | undefined {
  const message = rawMessage.trim();
  if (!message) {
    return undefined;
  }

  if (message.length <= 8000) {
    return message;
  }

  return `${message.slice(0, 8000)}\n...[truncated]`;
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
