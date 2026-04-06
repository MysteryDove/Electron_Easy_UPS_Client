import { Notification } from 'electron';
import { exec } from 'node:child_process';
import type { AppConfig } from '../config/configSchema';
import type { TelemetryValues } from '../db/telemetryRepository';
import type { CriticalAlertWindow } from './criticalAlertWindow';
import { t } from './i18nService';

const BATTERY_RECOVERY_HYSTERESIS_PCT = 5;

export class BatterySafetyService {
  private readonly criticalAlert: CriticalAlertWindow;
  private batteryConfig: AppConfig['battery'];
  private fsdConfig: AppConfig['fsd'];
  private warned = false;
  private shutdownWarned = false;
  private fsdActive = false;
  private shutdownScheduled = false;
  private activeShutdownMethod: 'sleep' | 'shutdown' | null = null;
  private lastBatteryPercent: number | null = null;

  public constructor(config: AppConfig, criticalAlert: CriticalAlertWindow) {
    this.batteryConfig = config.battery;
    this.fsdConfig = config.fsd;
    this.criticalAlert = criticalAlert;
  }

  public handleTelemetry(values: TelemetryValues, rawUpsStatus?: string): void {
    const batteryPercent = normalizeBatteryPercent(values.battery_charge_pct);
    if (batteryPercent === null) {
      return;
    }

    const battery = this.batteryConfig;
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

    // FSD detection: check ups.status tokens for FSD flag
    this.handleFsdStatus(rawUpsStatus, batteryPercent);
  }

  public handleConfigUpdated(config: AppConfig): void {
    this.batteryConfig = config.battery;
    this.fsdConfig = config.fsd;

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

  private handleFsdStatus(rawUpsStatus: string | undefined, batteryPercent: number): void {
    const fsd = this.fsdConfig;
    if (!fsd.shutdownEnabled) {
      if (this.fsdActive) {
        this.fsdActive = false;
        this.criticalAlert.dismiss();
      }
      return;
    }

    const isFsd = containsFsdToken(rawUpsStatus);

    if (isFsd && !this.fsdActive) {
      this.fsdActive = true;

      // Dismiss any existing battery alert so FSD takes priority
      this.criticalAlert.dismiss();

      if (fsd.overlayEnabled) {
        this.criticalAlert.show(
          {
            type: 'critical',
            title: t('batterySafety.fsdAlertTitle'),
            body: t('batterySafety.fsdAlertBody'),
            batteryPct: batteryPercent,
            shutdownPct: this.batteryConfig.shutdownPct,
            showShutdown: true,
            shutdownCountdownSeconds: fsd.shutdownDelaySeconds,
          },
          () => this.initiateWindowsShutdown(fsd.shutdownMethod),
        );
      } else {
        this.initiateWindowsShutdown(fsd.shutdownMethod);
      }
    } else if (!isFsd && this.fsdActive) {
      // FSD condition cleared
      this.fsdActive = false;
      this.criticalAlert.dismiss();
      this.cancelPendingWindowsShutdown();
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

export function containsFsdToken(rawUpsStatus: string | undefined | null): boolean {
  if (!rawUpsStatus) {
    return false;
  }

  return rawUpsStatus
    .split(/\s+/u)
    .some((token) => token.toUpperCase() === 'FSD');
}
