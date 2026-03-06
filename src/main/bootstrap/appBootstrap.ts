import { app } from 'electron';
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

let runtimePromise: Promise<MainProcessRuntime> | null = null;

export function bootstrapMainProcess(): Promise<MainProcessRuntime> {
  if (runtimePromise) {
    return runtimePromise;
  }

  runtimePromise = initializeRuntime();
  return runtimePromise;
}

async function initializeRuntime(): Promise<MainProcessRuntime> {
  // Ensure stored config is normalized before dependent services start.
  const initialConfig = configStore.get();
  await i18nService.start(initialConfig);

  const duckDbClient = new DuckDbClient();
  await duckDbClient.initialize();

  const telemetryRepository = new TelemetryRepository(duckDbClient);
  const retentionService = new RetentionService(
    telemetryRepository,
    initialConfig.data.retentionDays,
  );
  const trayService = new TrayService();
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
  const wizardProvisioningService = new WizardProvisioningService(
    configStore,
    telemetryRepository,
  );
  const runtimeConfigCoordinator = new RuntimeConfigCoordinator({
    retentionService,
    nutPollingService,
    wizardProvisioningService,
    trayService,
    batterySafetyService,
    lineAlertService,
  });
  const unsubscribeTelemetryListener = nutPollingService.onTelemetryUpdated(
    ({ values }) => {
      trayService.handleTelemetry(values);
      batterySafetyService.handleTelemetry(values);
      lineAlertService.handleTelemetry(values);
    },
  );
  const unsubscribeConnectionListener = nutPollingService.onConnectionStateChanged(
    (state) => {
      trayService.handleConnectionState(state);
    },
  );

  trayService.start(initialConfig);
  trayService.handleConnectionState(nutPollingService.getState());
  runtimeConfigCoordinator.initialize(initialConfig);

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

  let shutdownInProgress = false;
  let shutdownCompleted = false;

  app.on('before-quit', (event) => {
    if (shutdownCompleted) {
      return;
    }

    event.preventDefault();

    if (shutdownInProgress) {
      return;
    }

    shutdownInProgress = true;
    unsubscribeTelemetryListener();
    unsubscribeConnectionListener();
    trayService.stop();
    retentionService.stop();

    void (async () => {
      const [nutStopResult, wizardStopResult, duckDbCloseResult] = await Promise.allSettled([
        nutPollingService.stop(),
        wizardProvisioningService.stop(),
        duckDbClient.close(),
      ]);

      if (nutStopResult.status === 'rejected') {
        console.error(
          '[MainProcessBootstrap] Failed to stop NutPollingService during shutdown',
          nutStopResult.reason,
        );
      }

      if (duckDbCloseResult.status === 'rejected') {
        console.error(
          '[MainProcessBootstrap] Failed to close DuckDB during shutdown',
          duckDbCloseResult.reason,
        );
      }

      if (wizardStopResult.status === 'rejected') {
        console.error(
          '[MainProcessBootstrap] Failed to stop WizardProvisioningService during shutdown',
          wizardStopResult.reason,
        );
      }

      shutdownCompleted = true;
      app.quit();
    })();
  });

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
}
