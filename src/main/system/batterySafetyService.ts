import { Notification } from 'electron';
import { exec } from 'node:child_process';
import type { AppConfig } from '../config/configSchema';
import type { ConfigStore } from '../config/configStore';
import type { TelemetryValues } from '../db/telemetryRepository';
import type { CriticalAlertWindow } from './criticalAlertWindow';
import { t } from './i18nService';

const BATTERY_RECOVERY_HYSTERESIS_PCT = 5;

export class BatterySafetyService {
  private readonly configStore: ConfigStore;
  private readonly criticalAlert: CriticalAlertWindow;
  private warned = false;
  private shutdownWarned = false;
  private shutdownScheduled = false;
  private activeShutdownMethod: 'sleep' | 'shutdown' | null = null;
  private lastBatteryPercent: number | null = null;

  public constructor(configStore: ConfigStore, criticalAlert: CriticalAlertWindow) {
    this.configStore = configStore;
    this.criticalAlert = criticalAlert;
  }

  public handleTelemetry(values: TelemetryValues): void {
    const batteryPercent = normalizeBatteryPercent(values.battery_charge_pct);
    if (batteryPercent === null) {
      return;
    }

    const { battery } = this.configStore.get();
    this.resetNotificationStateIfRecovered(batteryPercent, battery.warningPct);

    if (
      !this.warned &&
      isCrossingBelowThreshold(
        this.lastBatteryPercent,
        batteryPercent,
        battery.warningPct,
      )
    ) {
      this.warned = true;

      if (battery.warningToastEnabled) {
        this.showNotification(
          t('batterySafety.warningToastTitle'),
          t('batterySafety.warningToastBody', { percent: batteryPercent, threshold: battery.warningPct }),
        );
      }

      if (battery.criticalAlertEnabled) {
        this.criticalAlert.show(
          {
            type: 'warning',
            title: t('batterySafety.warningAlertTitle'),
            body: t('batterySafety.warningAlertBody', { percent: batteryPercent, threshold: battery.warningPct }),
            batteryPct: batteryPercent,
            shutdownPct: battery.shutdownPct,
            showShutdown: battery.shutdownEnabled,
          },
          battery.shutdownEnabled
            ? () => this.initiateWindowsShutdown(battery.shutdownMethod)
            : undefined,
        );
      }
    }

    if (
      !this.shutdownWarned &&
      isCrossingBelowThreshold(
        this.lastBatteryPercent,
        batteryPercent,
        battery.shutdownPct,
      )
    ) {
      this.shutdownWarned = true;

      // Dismiss the warning-level alert if still showing
      this.criticalAlert.dismiss();

      this.showNotification(
        t('batterySafety.shutdownToastTitle'),
        t('batterySafety.shutdownToastBody', { percent: batteryPercent, threshold: battery.shutdownPct }),
      );

      // Show critical alert with countdown — the countdown-expired or
      // "Shut Down Now" button in the dialog triggers the shutdown callback.
      if (battery.criticalShutdownAlertEnabled) {
        this.criticalAlert.show(
          {
            type: 'critical',
            title: t('batterySafety.criticalAlertTitle'),
            body: t('batterySafety.criticalAlertBody', { percent: batteryPercent, threshold: battery.shutdownPct }),
            batteryPct: batteryPercent,
            shutdownPct: battery.shutdownPct,
            showShutdown: true,
            shutdownCountdownSeconds: battery.shutdownEnabled ? battery.shutdownCountdownSeconds : undefined,
          },
          () => this.initiateWindowsShutdown(battery.shutdownMethod),
        );
      } else if (battery.shutdownEnabled) {
        this.initiateWindowsShutdown(battery.shutdownMethod);
      }
    }

    this.lastBatteryPercent = batteryPercent;
  }

  public handleConfigUpdated(config: AppConfig): void {
    if (!config.battery.shutdownEnabled) {
      this.cancelPendingWindowsShutdown();
    }

    if (this.lastBatteryPercent === null) {
      return;
    }

    this.resetNotificationStateIfRecovered(
      this.lastBatteryPercent,
      config.battery.warningPct,
    );
  }

  private resetNotificationStateIfRecovered(
    batteryPercent: number,
    warningPct: number,
  ): void {
    if (batteryPercent > warningPct + BATTERY_RECOVERY_HYSTERESIS_PCT) {
      this.warned = false;
      this.shutdownWarned = false;
      this.cancelPendingWindowsShutdown();
      this.criticalAlert.dismiss();
    }
  }

  private showNotification(title: string, body: string): void {
    if (!Notification.isSupported()) {
      console.warn(
        '[BatterySafetyService] Notification API is not supported on this platform.',
      );
      return;
    }

    const notification = new Notification({
      title,
      body,
    });
    notification.show();
  }

  private initiateWindowsShutdown(method: 'sleep' | 'shutdown'): void {
    if (process.platform !== 'win32') {
      console.warn(
        '[BatterySafetyService] Auto-shutdown requested on non-Windows platform.',
      );
      return;
    }

    if (this.shutdownScheduled) {
      return;
    }

    this.shutdownScheduled = true;
    this.activeShutdownMethod = method;

    if (method === 'sleep') {
      exec(
        'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
        (error) => {
          if (error) {
            this.shutdownScheduled = false;
            console.error(
              '[BatterySafetyService] Failed to initiate Windows sleep/hibernate.',
              error,
            );
          }
        },
      );
    } else {
      exec(
        'shutdown.exe /s /f /t 0',
        (error) => {
          if (error) {
            this.shutdownScheduled = false;
            console.error(
              '[BatterySafetyService] Failed to initiate Windows shutdown.',
              error,
            );
          }
        },
      );
    }
  }

  private cancelPendingWindowsShutdown(): void {
    if (!this.shutdownScheduled || process.platform !== 'win32') {
      return;
    }

    if (this.activeShutdownMethod === 'shutdown') {
      exec('shutdown.exe /a', (error) => {
        if (error) {
          console.warn(
            '[BatterySafetyService] Failed to cancel pending Windows shutdown.',
            error,
          );
        }
      });
    }

    this.shutdownScheduled = false;
    this.activeShutdownMethod = null;
  }
}

function normalizeBatteryPercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 100) {
    return 100;
  }

  return Math.round(value);
}

function isCrossingBelowThreshold(
  previousValue: number | null,
  currentValue: number,
  threshold: number,
): boolean {
  if (previousValue === null) {
    return currentValue <= threshold;
  }

  return previousValue > threshold && currentValue <= threshold;
}
