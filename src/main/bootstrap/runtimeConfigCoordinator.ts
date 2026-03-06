import { nativeTheme } from 'electron';
import type { AppConfig } from '../config/configSchema';
import type { RetentionService } from '../db/retentionService';
import type { NutPollingService } from '../nut/nutPollingService';
import type { WizardProvisioningService } from '../nut/wizardProvisioningService';
import type { BatterySafetyService } from '../system/batterySafetyService';
import { i18nService } from '../system/i18nService';
import type { LineAlertService } from '../system/lineAlertService';
import { applyStartWithWindowsSetting } from '../system/startupService';
import type { TrayService } from '../system/trayService';

export type RuntimeConfigCoordinatorDependencies = {
  retentionService: RetentionService;
  nutPollingService: NutPollingService;
  wizardProvisioningService: WizardProvisioningService;
  trayService: TrayService;
  batterySafetyService: BatterySafetyService;
  lineAlertService: LineAlertService;
};

export class RuntimeConfigCoordinator {
  private readonly retentionService: RetentionService;
  private readonly nutPollingService: NutPollingService;
  private readonly wizardProvisioningService: WizardProvisioningService;
  private readonly trayService: TrayService;
  private readonly batterySafetyService: BatterySafetyService;
  private readonly lineAlertService: LineAlertService;

  public constructor(dependencies: RuntimeConfigCoordinatorDependencies) {
    this.retentionService = dependencies.retentionService;
    this.nutPollingService = dependencies.nutPollingService;
    this.wizardProvisioningService = dependencies.wizardProvisioningService;
    this.trayService = dependencies.trayService;
    this.batterySafetyService = dependencies.batterySafetyService;
    this.lineAlertService = dependencies.lineAlertService;
  }

  public initialize(config: AppConfig): void {
    nativeTheme.themeSource = config.theme?.mode ?? 'system';
    applyStartWithWindowsSetting(config.startup.startWithWindows);
    this.retentionService.handleConfigUpdated(config);
    this.trayService.handleConfigUpdated(config);
    this.batterySafetyService.handleConfigUpdated(config);
    this.lineAlertService.handleConfigUpdated(config);
  }

  public async applyUpdatedConfig(
    previousConfig: AppConfig,
    nextConfig: AppConfig,
    options?: {
      runRetention?: boolean;
      stopWizardProvisioning?: boolean;
    },
  ): Promise<void> {
    if (options?.stopWizardProvisioning !== false) {
      await this.wizardProvisioningService.stop();
    }

    nativeTheme.themeSource = nextConfig.theme?.mode ?? 'system';
    applyStartWithWindowsSetting(nextConfig.startup.startWithWindows);
    this.retentionService.handleConfigUpdated(nextConfig);
    await this.nutPollingService.handleConfigUpdated(previousConfig, nextConfig);

    if (options?.runRetention) {
      await this.retentionService.runOnce();
    }

    await i18nService.handleConfigUpdated(nextConfig);
    this.trayService.handleConfigUpdated(nextConfig);
    this.batterySafetyService.handleConfigUpdated(nextConfig);
    this.lineAlertService.handleConfigUpdated(nextConfig);
  }
}
