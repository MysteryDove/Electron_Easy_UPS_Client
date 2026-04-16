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
  /** Once true, the FSD shutdown countdown is irrevocable — it cannot be
   *  cancelled by subsequent telemetry or connection-loss events. */
  private fsdShutdownCommitted = false;
  private shutdownScheduled = false;
  private activeShutdownMethod: 'sleep' | 'shutdown' | null = null;
  private lastBatteryPercent: number | null = null;
  private lastOnBattery = false;

  public constructor(config: AppConfig, criticalAlert: CriticalAlertWindow) {
    this.batteryConfig = config.battery;
    this.fsdConfig = config.fsd;
    this.criticalAlert = criticalAlert;
  }

  public handleTelemetry(values: TelemetryValues, rawUpsStatus?: string): void {
    const rawBatteryPercent = normalizeBatteryPercent(values.battery_charge_pct);

    // Track OB/OL state regardless of battery percent availability so that
    // transitions (e.g. OB→OL) are detected even when battery.charge is missing.
    if (rawUpsStatus) {
      const isOnBattery = containsObToken(rawUpsStatus);

      // When UPS transitions from on-battery to online, cancel any active
      // battery-based warning/shutdown — the system is safe on mains power.
      if (this.lastOnBattery && !isOnBattery) {
        this.resetBatteryAlertState();
      }

      // When UPS transitions from online to on-battery, reset the battery
      // baseline so threshold crossing checks treat this as a fresh power-loss
      // event and re-trigger warnings even if the percent hasn't changed.
      if (!this.lastOnBattery && isOnBattery) {
        this.lastBatteryPercent = null;
      }

      this.lastOnBattery = isOnBattery;
    }

    // When battery.charge is unavailable but the UPS reports LB (Low Battery)
    // while on battery, synthesize a value at shutdownPct so the existing
    // threshold-crossing logic triggers warnings and shutdown.
    const batteryPercent = rawBatteryPercent
      ?? (this.lastOnBattery && containsLbToken(rawUpsStatus)
        ? this.batteryConfig.shutdownPct
        : null);

    if (batteryPercent === null) {
      this.handleFsdStatus(
        rawUpsStatus,
        this.lastBatteryPercent ?? this.batteryConfig.shutdownPct,
      );
      return;
    }

    const battery = this.batteryConfig;

    this.resetNotificationStateIfRecovered(batteryPercent, battery.warningPct);

    // Only trigger battery-based warnings/shutdown when on battery (OB).
    // When the UPS is online (OL) the system runs on mains power and low
    // battery percent simply means the battery is charging — not a danger.
    if (this.lastOnBattery) {
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
      this.resetBatteryAlertState();
    }
  }

  /** Reset battery-based warning/shutdown state and dismiss active overlays.
   *  Does NOT affect FSD state — FSD shutdown is governed separately. */
  private resetBatteryAlertState(): void {
    this.warned = false;
    this.shutdownWarned = false;
    if (!this.fsdShutdownCommitted) {
      this.cancelPendingWindowsShutdown();
      this.criticalAlert.dismiss();
    }
  }

  private handleFsdStatus(rawUpsStatus: string | undefined, batteryPercent: number): void {
    const fsd = this.fsdConfig;
    if (!fsd.shutdownEnabled) {
      if (this.fsdActive && !this.fsdShutdownCommitted) {
        this.fsdActive = false;
        this.criticalAlert.dismiss();
      }
      return;
    }

    const isFsd = containsFsdToken(rawUpsStatus);

    if (isFsd && !this.fsdActive) {
      this.fsdActive = true;
      this.fsdShutdownCommitted = true;

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
          () => this.handleFsdUserDismissed(),
        );
      } else {
        this.initiateWindowsShutdown(fsd.shutdownMethod);
      }
    }
    // Once FSD shutdown is committed, do NOT cancel it — the NUT master
    // itself is shutting down which means subsequent telemetry may arrive
    // without the FSD token (stale/partial reads from a dying daemon).
    // The countdown must run to completion regardless.
    // The user CAN still cancel via the overlay's Dismiss/Ignore button.
  }

  /** Called when the user manually dismisses the FSD overlay (false positive). */
  private handleFsdUserDismissed(): void {
    this.fsdActive = false;
    this.fsdShutdownCommitted = false;
    this.cancelPendingWindowsShutdown();
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

export function containsObToken(rawUpsStatus: string | undefined | null): boolean {
  if (!rawUpsStatus) {
    return false;
  }

  return rawUpsStatus
    .split(/\s+/u)
    .some((token) => token.toUpperCase() === 'OB');
}

export function containsLbToken(rawUpsStatus: string | undefined | null): boolean {
  if (!rawUpsStatus) {
    return false;
  }

  return rawUpsStatus
    .split(/\s+/u)
    .some((token) => token.toUpperCase() === 'LB');
}
