import type { AppConfig } from '../config/configSchema';
import type { TelemetryRepository } from './telemetryRepository';

const DAY_MS = 24 * 60 * 60 * 1000;

export class RetentionService {
  private readonly telemetryRepository: TelemetryRepository;
  private retentionDays: number;
  private timer: NodeJS.Timeout | null = null;

  public constructor(telemetryRepository: TelemetryRepository, retentionDays: number) {
    this.telemetryRepository = telemetryRepository;
    this.retentionDays = normalizeRetentionDays(retentionDays);
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, DAY_MS);
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  public async runOnce(): Promise<number> {
    const retentionDays = normalizeRetentionDays(this.retentionDays);
    const cutoffDate = new Date(Date.now() - retentionDays * DAY_MS);
    return this.telemetryRepository.deleteOlderThan(cutoffDate);
  }

  public handleConfigUpdated(config: AppConfig): void {
    this.retentionDays = normalizeRetentionDays(config.data.retentionDays);
  }
}

function normalizeRetentionDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 30;
  }

  const rounded = Math.floor(value);
  if (rounded < 1) {
    return 1;
  }

  if (rounded > 3650) {
    return 3650;
  }

  return rounded;
}
