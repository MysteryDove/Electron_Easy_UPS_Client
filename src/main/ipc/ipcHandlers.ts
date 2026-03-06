import { ipcMain, nativeTheme, BrowserWindow, dialog, shell } from 'electron';
import type { RuntimeConfigCoordinator } from '../bootstrap/runtimeConfigCoordinator';
import type { ConfigStore } from '../config/configStore';
import type {
  QueryRangePayload,
  TelemetryMinMaxRangePayload,
  TelemetryRepository,
} from '../db/telemetryRepository';
import { NutClient } from '../nut/nutClient';
import type { NutPollingService } from '../nut/nutPollingService';
import type { WizardProvisioningService } from '../nut/wizardProvisioningService';
import {
  TELEMETRY_COLUMNS,
  type TelemetryColumn,
} from '../nut/nutValueMapper';
import type { CriticalAlertWindow } from '../system/criticalAlertWindow';
import {
  listComPorts,
  listSerialDrivers,
  prepareLocalDriver,
  prepareLocalNut,
  prepareUsbHid,
  validateNutFolder,
  waitForSerialDriverReady,
} from '../nut/nutSetupService';
import {
  normalizeNutSetupListSerialDriversPayload,
  normalizeNutSetupPrepareDriverPayload,
  normalizeNutSetupPreparePayload,
  normalizeNutSetupPrepareUsbHidPayload,
  normalizeNutSetupValidatePayload,
  normalizeSystemOpenExternalPayload,
} from './normalizers/nutSetupNormalizers';
import {
  buildTechnicalDetails,
  classifySerialDriverFailure,
} from '../nut/serialFailureClassifier';
import {
  buildUsbHidTechnicalDetails,
  hasNoMatchingUsbHidUpsSignal,
} from '../../shared/wizard/usbHidErrors';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type NutSetupPrepareLocalDriverResult,
  type WizardTestConnectionPayload,
  type WizardTestConnectionResult,
  type WizardCompletePayload,
} from './ipcChannels';
import {
  queryRangePayloadSchema,
  telemetryMinMaxRangePayloadSchema,
  wizardCompletePayloadSchema,
  wizardTestConnectionPayloadSchema,
} from '../../shared/ipc/schemas';

let isRegistered = false;

export type IpcHandlerDependencies = {
  configStore: ConfigStore;
  telemetryRepository: TelemetryRepository;
  nutPollingService: NutPollingService;
  wizardProvisioningService: WizardProvisioningService;
  runtimeConfigCoordinator: RuntimeConfigCoordinator;
  criticalAlertWindow: CriticalAlertWindow;
};

export function registerIpcHandlers(dependencies: IpcHandlerDependencies): void {
  if (isRegistered) {
    return;
  }
  isRegistered = true;

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

      await dependencies.runtimeConfigCoordinator.applyUpdatedConfig(
        previousConfig,
        updatedConfig,
        { runRetention: true },
      );
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
    async (_event, payload: unknown) =>
      dependencies.telemetryRepository.getMinMaxForRange(
        normalizeTelemetryMinMaxRangePayload(payload),
      ),
  );

  ipcMain.handle(IPC_CHANNELS.nutGetState, async () => ({
    state: dependencies.nutPollingService.getState(),
    staticData: dependencies.nutPollingService.getStaticSnapshot(),
    dynamicData: dependencies.nutPollingService.getDynamicSnapshot(),
    localDriverLaunchIssue:
      dependencies.nutPollingService.getLocalDriverLaunchIssue(),
  }));

  ipcMain.handle(IPC_CHANNELS.nutRetryLocalDriverLaunch, async () =>
    dependencies.nutPollingService.retryLocalDriverLaunchAfterIssue(),
  );

  ipcMain.handle(
    IPC_CHANNELS.wizardTestConnection,
    async (_event, payload: unknown) =>
      handleWizardTestConnection(normalizeWizardTestPayload(payload)),
  );

  ipcMain.handle(IPC_CHANNELS.wizardEnter, async () => {
    await handleWizardEnter(dependencies);
  });

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
    IPC_CHANNELS.systemOpenExternal,
    async (_event, payload: unknown) => {
      const normalizedPayload = normalizeSystemOpenExternalPayload(payload);
      await shell.openExternal(normalizedPayload.url);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.nutSetupValidateFolder,
    async (_event, payload: unknown) => {
      const normalizedPayload = normalizeNutSetupValidatePayload(payload);
      return validateNutFolder(normalizedPayload.folderPath, {
        requireUsbHidExperimentalSupport:
          normalizedPayload.requireUsbHidExperimentalSupport,
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.nutSetupPrepareLocalNut,
    async (_event, payload: unknown) => {
      const normalizedPayload = normalizeNutSetupPreparePayload(payload);
      const prepareResult = await prepareLocalNut(normalizedPayload);
      if (!prepareResult.success) {
        return {
          ...prepareResult,
          technicalDetails:
            prepareResult.technicalDetails ??
            buildTechnicalDetails(prepareResult.error ?? ''),
        };
      }

      try {
        await dependencies.wizardProvisioningService.startLocalComponents(
          normalizedPayload.folderPath,
          normalizedPayload.upsName,
        );
        return prepareResult;
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const firstLine = rawMessage
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        return {
          success: false,
          error: firstLine ?? 'Failed to configure and start local NUT',
          technicalDetails: buildTechnicalDetails(rawMessage),
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
        await dependencies.wizardProvisioningService.startLocalComponents(
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

  ipcMain.handle(
    IPC_CHANNELS.nutSetupPrepareUsbHid,
    async (_event, payload: unknown) => {
      const normalizedPayload = normalizeNutSetupPrepareUsbHidPayload(payload);
      const prepareResult = await prepareUsbHid(normalizedPayload);
      if (!prepareResult.success) {
        return prepareResult;
      }

      try {
        await dependencies.wizardProvisioningService.startLocalComponents(
          normalizedPayload.folderPath,
          normalizedPayload.upsName,
        );
        return prepareResult;
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        if (hasNoMatchingUsbHidUpsSignal(rawMessage)) {
          return {
            success: false,
            error:
              'No matching HID UPS found. Check USB connection and optional VID/PID settings, then retry.',
            technicalDetails: buildUsbHidTechnicalDetails(rawMessage),
          };
        }

        const firstLine = rawMessage
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        return {
          success: false,
          error:
            firstLine ??
            'Failed to configure and start local NUT USB HID driver',
          technicalDetails: buildUsbHidTechnicalDetails(rawMessage),
        };
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

async function handleWizardEnter(deps: IpcHandlerDependencies): Promise<void> {
  const [wizardStopResult, pollingStopResult] = await Promise.allSettled([
    deps.wizardProvisioningService.stop(),
    deps.nutPollingService.stop(),
  ]);

  if (wizardStopResult.status === 'rejected') {
    throw wizardStopResult.reason;
  }

  if (pollingStopResult.status === 'rejected') {
    throw pollingStopResult.reason;
  }
}

function normalizeWizardTestPayload(
  payload: unknown,
): WizardTestConnectionPayload {
  return wizardTestConnectionPayloadSchema.parse(payload);
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

  await deps.runtimeConfigCoordinator.applyUpdatedConfig(
    previousConfig,
    updatedConfig,
    { stopWizardProvisioning: true },
  );

  deps.nutPollingService.start();

  return updatedConfig;
}

function normalizeWizardCompletePayload(
  payload: unknown,
): WizardCompletePayload {
  return wizardCompletePayloadSchema.parse(payload);
}

// ---------------------------------------------------------------------------
// Telemetry query helpers
// ---------------------------------------------------------------------------

function normalizeQueryRangePayload(payload: unknown): QueryRangePayload {
  const candidate = queryRangePayloadSchema.parse(payload);
  return {
    startIso: candidate.startIso,
    endIso: candidate.endIso,
    maxPoints: candidate.maxPoints,
    columns: candidate.columns?.filter(isTelemetryColumn),
  };
}

function normalizeTelemetryMinMaxRangePayload(
  payload: unknown,
): TelemetryMinMaxRangePayload {
  const candidate = telemetryMinMaxRangePayloadSchema.parse(payload);
  return {
    startIso: candidate.startIso,
    endIso: candidate.endIso,
    columns: candidate.columns?.filter(isTelemetryColumn),
  };
}

function isTelemetryColumn(value: unknown): value is TelemetryColumn {
  return (
    typeof value === 'string' &&
    TELEMETRY_COLUMNS.includes(value as TelemetryColumn)
  );
}
