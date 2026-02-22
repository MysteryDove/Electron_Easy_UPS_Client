import { app } from 'electron';
import { configStore } from '../config/configStore';
import { DuckDbClient } from '../db/duckdbClient';
import { RetentionService } from '../db/retentionService';
import { TelemetryRepository } from '../db/telemetryRepository';
import { registerIpcHandlers } from '../ipc/ipcHandlers';
import { NutPollingService } from '../nut/nutPollingService';
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
  trayService: TrayService;
  batterySafetyService: BatterySafetyService;
  criticalAlertWindow: CriticalAlertWindow;
  lineAlertService: LineAlertService;
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
  const retentionService = new RetentionService(telemetryRepository, () =>
    configStore.get().data.retentionDays,
  );
  const trayService = new TrayService();
  const criticalAlertWindow = new CriticalAlertWindow();
  const batterySafetyService = new BatterySafetyService(configStore, criticalAlertWindow);
  const lineAlertService = new LineAlertService(configStore);
  const latestTelemetryPoint = await telemetryRepository.getLatestTelemetryPoint();
  if (latestTelemetryPoint) {
    trayService.handleTelemetry(latestTelemetryPoint.values);
  }
  const nutPollingService = new NutPollingService(configStore, telemetryRepository);
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

  registerIpcHandlers({
    configStore,
    telemetryRepository,
    retentionService,
    nutPollingService,
    trayService,
    batterySafetyService,
    criticalAlertWindow,
    lineAlertService,
  });

  retentionService.start();

  if (initialConfig.wizard.completed) {
    nutPollingService.start();
  }

  app.once('before-quit', () => {
    unsubscribeTelemetryListener();
    unsubscribeConnectionListener();
    trayService.stop();
    retentionService.stop();
    void nutPollingService.stop();
    void duckDbClient.close();
  });

  return {
    duckDbClient,
    telemetryRepository,
    retentionService,
    nutPollingService,
    trayService,
    batterySafetyService,
    criticalAlertWindow,
    lineAlertService,
  };
}
