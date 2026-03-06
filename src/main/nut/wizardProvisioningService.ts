import type { ConfigStore } from '../config/configStore';
import type { TelemetryRepository } from '../db/telemetryRepository';
import { NutPollingService } from './nutPollingService';

export class WizardProvisioningService {
  private readonly configStore: ConfigStore;
  private readonly telemetryRepository: TelemetryRepository;
  private session: NutPollingService | null = null;

  public constructor(
    configStore: ConfigStore,
    telemetryRepository: TelemetryRepository,
  ) {
    this.configStore = configStore;
    this.telemetryRepository = telemetryRepository;
  }

  public async startLocalComponents(
    folderPath: string,
    upsName: string,
  ): Promise<void> {
    await this.stop();

    const session = new NutPollingService(
      this.configStore,
      this.telemetryRepository,
    );
    this.session = session;

    try {
      await session.startLocalComponentsForWizard(folderPath, upsName);
    } catch (error) {
      await session.stop().catch(() => {
        // Ignore cleanup failures after a provisioning error.
      });

      if (this.session === session) {
        this.session = null;
      }

      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.session) {
      return;
    }

    const activeSession = this.session;
    this.session = null;
    await activeSession.stop().catch(() => {
      // Ignore cleanup failures during best-effort provisioning teardown.
    });
  }
}
