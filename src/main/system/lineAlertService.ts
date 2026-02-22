import { Notification } from 'electron';
import type { AppConfig } from '../config/configSchema';
import type { ConfigStore } from '../config/configStore';
import type { TelemetryValues } from '../db/telemetryRepository';
import { t } from './i18nService';

/**
 * Monitors input/output voltage and frequency telemetry values and fires
 * Windows toast notifications when any value exceeds the configured
 * tolerance range around the nominal value.
 *
 * Features a per-metric cooldown timer to avoid notification spam.
 */
export class LineAlertService {
    private readonly configStore: ConfigStore;

    /** Maps a metric label to the Unix-ms timestamp of the last toast sent for it. */
    private readonly lastAlertTimestamp = new Map<string, number>();

    public constructor(configStore: ConfigStore) {
        this.configStore = configStore;
    }

    /**
     * Called on every telemetry tick. Checks input and output voltages and
     * frequencies against their configured tolerance ranges.
     */
    public handleTelemetry(values: TelemetryValues): void {
        const { line } = this.configStore.get();

        if (!line.alertEnabled) {
            return;
        }

        const cooldownMs = line.alertCooldownMinutes * 60 * 1000;
        const now = Date.now();

        // --- Voltage checks ---
        const voltHigh = line.nominalVoltage * (1 + line.voltageTolerancePosPct / 100);
        const voltLow = line.nominalVoltage * (1 - line.voltageToleranceNegPct / 100);

        this.checkMetric(t('metrics.inputVoltage'), values.input_voltage, voltLow, voltHigh, 'V', now, cooldownMs);
        this.checkMetric(t('metrics.outputVoltage'), values.output_voltage, voltLow, voltHigh, 'V', now, cooldownMs);

        // --- Frequency checks ---
        const freqHigh = line.nominalFrequency * (1 + line.frequencyTolerancePosPct / 100);
        const freqLow = line.nominalFrequency * (1 - line.frequencyToleranceNegPct / 100);

        this.checkMetric(t('metrics.inputFrequency'), values.input_frequency_hz, freqLow, freqHigh, 'Hz', now, cooldownMs);
        this.checkMetric(t('metrics.outputFrequency'), values.output_frequency_hz, freqLow, freqHigh, 'Hz', now, cooldownMs);
    }

    public handleConfigUpdated(_config: AppConfig): void {
        // If alerts were disabled, clear the cooldown map so the first violation
        // after re-enabling fires immediately.
        if (!_config.line.alertEnabled) {
            this.lastAlertTimestamp.clear();
        }
    }

    // ---------- private helpers ----------

    private checkMetric(
        label: string,
        value: number | null | undefined,
        low: number,
        high: number,
        unit: string,
        now: number,
        cooldownMs: number,
    ): void {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return;
        }

        let direction: 'over' | 'under' | null = null;
        let limit = 0;

        if (value > high) {
            direction = 'over';
            limit = high;
        } else if (value < low) {
            direction = 'under';
            limit = low;
        }

        if (!direction) {
            return;
        }

        // Cooldown guard
        const lastSent = this.lastAlertTimestamp.get(label) ?? 0;
        if (now - lastSent < cooldownMs) {
            return;
        }

        this.lastAlertTimestamp.set(label, now);

        const title = direction === 'over' ? t('lineAlert.titleOver', { label }) : t('lineAlert.titleUnder', { label });
        const body = direction === 'over'
            ? t('lineAlert.bodyOver', { label, value: value.toFixed(1), limit: limit.toFixed(1), unit })
            : t('lineAlert.bodyUnder', { label, value: value.toFixed(1), limit: limit.toFixed(1), unit });

        this.showNotification(title, body);
    }

    private showNotification(title: string, body: string): void {
        if (!Notification.isSupported()) {
            console.warn('[LineAlertService] Notification API is not supported on this platform.');
            return;
        }

        const notification = new Notification({ title, body });
        notification.show();
    }
}
