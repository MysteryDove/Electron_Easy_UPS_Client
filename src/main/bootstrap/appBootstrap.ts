import { RuntimeConfigCoordinator } from './runtimeConfigCoordinator';
import { configStore } from '../config/configStore';
import { DuckDbClient } from '../db/duckdbClient';
import { RetentionService } from '../db/retentionService';
import { TelemetryRepository } from '../db/telemetryRepository';
import { registerIpcHandlers } from '../ipc/ipcHandlers';
import { NutPollingService } from '../nut/nutPollingService';
import { WizardProvisioningService } from '../nut/wizardProvisioningService';
import { BatterySafetyService } from '../system/batterySafetyService';
import { CriticalAlertWindow } from '../system/criticalAlertWindow';
import { LineAlertService } from '../system/lineAlertService';
import { applyStartWithWindowsSetting } from '../system/startupService';
import { TrayService } from '../system/trayService';
import { i18nService } from '../system/i18nService';

export type MainProcessRuntime = {
  duckDbClient: DuckDbClient;
  telemetryRepository: TelemetryRepository;
  retentionService: RetentionService;
  nutPollingService: NutPollingService;
  wizardProvisioningService: WizardProvisioningService;
  trayService: TrayService;
  batterySafetyService: BatterySafetyService;
  criticalAlertWindow: CriticalAlertWindow;
  lineAlertService: LineAlertService;
  runtimeConfigCoordinator: RuntimeConfigCoordinator;
};

type RuntimeCleanupState = {
  duckDbClient: DuckDbClient | null;
  retentionService: RetentionService | null;
  nutPollingService: NutPollingService | null;
  wizardProvisioningService: WizardProvisioningService | null;
  trayService: TrayService | null;
  unsubscribeTelemetryListener: (() => void) | null;
  unsubscribeConnectionListener: (() => void) | null;
};

let runtimePromise: Promise<MainProcessRuntime> | null = null;
let shutdownPromise: Promise<void> | null = null;
const cleanupState: RuntimeCleanupState = {
  duckDbClient: null,
  retentionService: null,
  nutPollingService: null,
  wizardProvisioningService: null,
  trayService: null,
  unsubscribeTelemetryListener: null,
  unsubscribeConnectionListener: null,
};

export function bootstrapMainProcess(): Promise<MainProcessRuntime> {
  if (runtimePromise) {
    return runtimePromise;
  }

  runtimePromise = initializeRuntime();
  return runtimePromise;
}

export async function shutdownMainProcess(): Promise<void> {
  if (runtimePromise) {
    try {
      await runtimePromise;
    } catch {
      // Best-effort shutdown still runs for any services that were initialized
      // before bootstrap failed.
    }
  }

  await performShutdown();
}

async function initializeRuntime(): Promise<MainProcessRuntime> {
  try {
    // Ensure stored config is normalized before dependent services start.
    const initialConfig = configStore.get();
    await i18nService.start(initialConfig);

    const duckDbClient = new DuckDbClient();
    cleanupState.duckDbClient = duckDbClient;
    await duckDbClient.initialize();

    const telemetryRepository = new TelemetryRepository(duckDbClient);
    const retentionService = new RetentionService(
      telemetryRepository,
      initialConfig.data.retentionDays,
    );
    cleanupState.retentionService = retentionService;

    const trayService = new TrayService();
    cleanupState.trayService = trayService;

    const criticalAlertWindow = new CriticalAlertWindow();
    const batterySafetyService = new BatterySafetyService(
      initialConfig,
      criticalAlertWindow,
    );
    const lineAlertService = new LineAlertService(initialConfig);
    const latestTelemetryPoint = await telemetryRepository.getLatestTelemetryPoint();
    if (latestTelemetryPoint) {
      trayService.handleTelemetry(latestTelemetryPoint.values);
    }

    const nutPollingService = new NutPollingService(configStore, telemetryRepository);
    cleanupState.nutPollingService = nutPollingService;

    const wizardProvisioningService = new WizardProvisioningService(
      configStore,
      telemetryRepository,
    );
    cleanupState.wizardProvisioningService = wizardProvisioningService;

    const runtimeConfigCoordinator = new RuntimeConfigCoordinator({
      retentionService,
      nutPollingService,
      wizardProvisioningService,
      trayService,
      batterySafetyService,
      lineAlertService,
    });
    const unsubscribeTelemetryListener = nutPollingService.onTelemetryUpdated(
      ({ values, rawUpsStatus }) => {
        trayService.handleTelemetry(values);
        batterySafetyService.handleTelemetry(values, rawUpsStatus);
        lineAlertService.handleTelemetry(values);
      },
    );
    cleanupState.unsubscribeTelemetryListener = unsubscribeTelemetryListener;

    const unsubscribeConnectionListener = nutPollingService.onConnectionStateChanged(
      (state) => {
        trayService.handleConnectionState(state);
      },
    );
    cleanupState.unsubscribeConnectionListener = unsubscribeConnectionListener;

    trayService.start(initialConfig);
    trayService.handleConnectionState(nutPollingService.getState());
    runtimeConfigCoordinator.initialize(initialConfig);

    // Re-apply startup registration so the --autostart flag is present in the
    // registry entry.  This is a no-op when the setting is already correct and
    // ensures existing installs pick up the fix without user intervention.
    if (initialConfig.startup.startWithWindows) {
      applyStartWithWindowsSetting(true);
    }

    registerIpcHandlers({
      configStore,
      telemetryRepository,
      nutPollingService,
      wizardProvisioningService,
      runtimeConfigCoordinator,
      criticalAlertWindow,
    });

    retentionService.start();

    if (initialConfig.wizard.completed) {
      nutPollingService.start();
    }

    return {
      duckDbClient,
      telemetryRepository,
      retentionService,
      nutPollingService,
      wizardProvisioningService,
      trayService,
      batterySafetyService,
      criticalAlertWindow,
      lineAlertService,
      runtimeConfigCoordinator,
    };
  } catch (error) {
    await performShutdown();
    throw error;
  }
}

function performShutdown(): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    cleanupState.unsubscribeTelemetryListener?.();
    cleanupState.unsubscribeTelemetryListener = null;

    cleanupState.unsubscribeConnectionListener?.();
    cleanupState.unsubscribeConnectionListener = null;

    cleanupState.trayService?.stop();
    cleanupState.trayService = null;

    cleanupState.retentionService?.stop();
    cleanupState.retentionService = null;

    const nutPollingService = cleanupState.nutPollingService;
    const wizardProvisioningService = cleanupState.wizardProvisioningService;
    const duckDbClient = cleanupState.duckDbClient;

    cleanupState.nutPollingService = null;
    cleanupState.wizardProvisioningService = null;
    cleanupState.duckDbClient = null;

    const [nutStopResult, wizardStopResult, duckDbCloseResult] = await Promise.allSettled([
      nutPollingService?.stop() ?? Promise.resolve(),
      wizardProvisioningService?.stop() ?? Promise.resolve(),
      duckDbClient?.close() ?? Promise.resolve(),
    ]);

    if (nutStopResult.status === 'rejected') {
      console.error(
        '[MainProcessBootstrap] Failed to stop NutPollingService during shutdown',
        nutStopResult.reason,
      );
    }

    if (wizardStopResult.status === 'rejected') {
      console.error(
        '[MainProcessBootstrap] Failed to stop WizardProvisioningService during shutdown',
        wizardStopResult.reason,
      );
    }

    if (duckDbCloseResult.status === 'rejected') {
      console.error(
        '[MainProcessBootstrap] Failed to close DuckDB during shutdown',
        duckDbCloseResult.reason,
      );
    }
  })();

  return shutdownPromise;
}
