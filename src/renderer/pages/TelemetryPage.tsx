import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnection } from '../app/providers';
import type { TelemetryDataPoint } from '../../main/db/telemetryRepository';
import { TelemetryRowCard } from '../components/TelemetryRowCard';
import type { TelemetryColumn } from '../../main/nut/nutValueMapper';

// Define the timeline options
type TimeScale = '10 Minutes' | '30 Minutes' | '1 Hour' | '3 Hours' | '12 Hours' | '1 Day' | '3 Days';

const TIME_SCALE_MS: Record<TimeScale, number> = {
    '10 Minutes': 10 * 60 * 1000,
    '30 Minutes': 30 * 60 * 1000,
    '1 Hour': 1 * 60 * 60 * 1000,
    '3 Hours': 3 * 60 * 60 * 1000,
    '12 Hours': 12 * 60 * 60 * 1000,
    '1 Day': 24 * 60 * 60 * 1000,
    '3 Days': 72 * 60 * 60 * 1000,
};

// UI formatting metadata for rendering columns gracefully
type MetricMeta = { key: TelemetryColumn; title: string; unit: string; type?: 'voltage' | 'frequency' | 'current' | 'percent'; nominalKey?: string; applyMovingAverage?: boolean };
export function TelemetryPage() {
    const { t } = useTranslation();
    const { lastTelemetry, staticData } = useConnection();
    const [timeScale, setTimeScale] = useState<TimeScale>('1 Hour');

    const METRIC_META: MetricMeta[] = [
        { key: 'battery_charge_pct', title: t('metrics.batteryCharge'), unit: '%', type: 'percent' },
        { key: 'battery_voltage', title: t('metrics.batteryVoltage'), unit: 'V', type: 'voltage', nominalKey: 'battery.voltage.nominal' },
        { key: 'battery_current', title: t('metrics.batteryCurrent'), unit: 'A', type: 'current' },
        { key: 'battery_temperature', title: t('metrics.batteryTemp'), unit: '°C' },
        { key: 'battery_runtime_sec', title: t('metrics.batteryRuntime'), unit: 's', applyMovingAverage: true },
        { key: 'input_voltage', title: t('metrics.inputVoltage'), unit: 'V', type: 'voltage', nominalKey: 'input.voltage.nominal' },
        { key: 'input_frequency_hz', title: t('metrics.inputFrequency'), unit: 'Hz', type: 'frequency', nominalKey: 'input.frequency.nominal' },
        { key: 'input_current', title: t('metrics.inputCurrent'), unit: 'A', type: 'current' },
        { key: 'output_voltage', title: t('metrics.outputVoltage'), unit: 'V', type: 'voltage', nominalKey: 'output.voltage.nominal' },
        { key: 'output_frequency_hz', title: t('metrics.outputFrequency'), unit: 'Hz', type: 'frequency', nominalKey: 'output.frequency.nominal' },
        { key: 'output_current', title: t('metrics.outputCurrent'), unit: 'A', type: 'current', applyMovingAverage: true },
        { key: 'ups_load_pct', title: t('metrics.upsLoad'), unit: '%', type: 'percent' },
        { key: 'ups_realpower_watts', title: t('metrics.realPower'), unit: 'W' },
        { key: 'ups_temperature', title: t('metrics.upsTemp'), unit: '°C' },
        { key: 'ups_status_num', title: t('metrics.upsStatus'), unit: '' },
    ];

    const [history, setHistory] = useState<TelemetryDataPoint[]>([]);
    const [minMax, setMinMax] = useState<Record<string, { min: number | null; max: number | null }>>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        const fetchHistory = async () => {
            setIsLoading(true);
            try {
                const now = new Date();
                const start = new Date(now.getTime() - TIME_SCALE_MS[timeScale]);

                // Query DB max 300 points so ECharts doesn't lag on huge timespans
                const [data, limits] = await Promise.all([
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).electronApi.telemetry.queryRange({
                        startIso: start.toISOString(),
                        endIso: now.toISOString(),
                        maxPoints: 300
                    }),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (window as any).electronApi.telemetry.getMinMaxForRange({
                        startIso: start.toISOString(),
                        endIso: now.toISOString()
                    })
                ]);

                if (mounted) {
                    setHistory(data);
                    setMinMax(limits);
                }
            } catch (err) {
                console.error('Failed to fetch telemetry history for telemetry page:', err);
            } finally {
                if (mounted) setIsLoading(false);
            }
        };

        void fetchHistory();

        return () => { mounted = false; };
        // We only fetch on mount OR when timeScale changes.
        // For a full telemetry page over hours/days, real-time push isn't strictly necessary, 
        // but we can append real time ticks below if we want.
    }, [timeScale]);

    // Optional: Synchronize real-time ticks into the history array if viewing "1 Hour"
    useEffect(() => {
        if (!lastTelemetry) return;
        setHistory((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].ts === lastTelemetry.ts) {
                return prev;
            }
            const newPoint: TelemetryDataPoint = { ts: lastTelemetry.ts, values: lastTelemetry.values };
            // Append and optionally cull to keep memory stable relative to maxPoints
            const updated = [...prev, newPoint];
            if (updated.length > 350) return updated.slice(updated.length - 350);
            return updated;
        });

        // Expand min/max bounds seamlessly if the new live metric beats historical min/max
        setMinMax(prev => {
            const next = { ...prev };
            for (const [key, val] of Object.entries(lastTelemetry.values)) {
                if (typeof val !== 'number') continue;
                if (!next[key]) next[key] = { min: val, max: val };
                else {
                    next[key] = {
                        min: next[key].min !== null ? Math.min(next[key].min as number, val) : val,
                        max: next[key].max !== null ? Math.max(next[key].max as number, val) : val
                    };
                }
            }
            return next;
        });
    }, [lastTelemetry]);

    return (
        <div className="telemetry-page">
            <header className="page-header">
                <div>
                    <h1 className="page-title">{t('telemetry.title')}</h1>
                    <span className="page-subtitle">{t('telemetry.subtitle')}</span>
                </div>

                <div className="telemetry-controls">
                    <select
                        value={timeScale}
                        onChange={(e) => setTimeScale(e.target.value as TimeScale)}
                        className="telemetry-select"
                        disabled={isLoading}
                    >
                        {(Object.keys(TIME_SCALE_MS) as TimeScale[]).map(scale => (
                            <option key={scale} value={scale}>{t(`telemetry.timeScale.${scale.replace(' ', '')}`)}</option>
                        ))}
                    </select>
                </div>
            </header>

            <section className="telemetry-list">
                {isLoading && history.length === 0 ? (
                    <div className="loading-state">{t('telemetry.loading')}</div>
                ) : (
                    <div className="telemetry-grid">
                        {METRIC_META.map(meta => {
                            const currentVal = lastTelemetry?.values[meta.key] as number | undefined;

                            // Map all historical {ts, values} points into [ts, value] arrays for the row
                            const rowData = history.map(h => {
                                const val = h.values ? h.values[meta.key] : null;
                                return { ts: new Date(h.ts), value: typeof val === 'number' ? val : null };
                            }).filter(x => x.value !== null) as { ts: Date, value: number }[];

                            // Hide rows with no data
                            if ((currentVal === undefined || currentVal === null) && rowData.length === 0) {
                                return null;
                            }

                            let nominalVal: number | undefined = undefined;
                            if (meta.nominalKey && staticData && typeof staticData[meta.nominalKey] !== 'undefined') {
                                const parsed = parseFloat(staticData[meta.nominalKey]);
                                if (!isNaN(parsed)) nominalVal = parsed;
                            }

                            const stats = minMax[meta.key];

                            return (
                                <TelemetryRowCard
                                    key={meta.key}
                                    title={meta.title}
                                    unit={meta.unit}
                                    currentValue={currentVal}
                                    metricType={meta.type}
                                    data={rowData}
                                    nominalValue={nominalVal}
                                    applyMovingAverage={meta.applyMovingAverage}
                                    minAggregate={stats?.min ?? undefined}
                                    maxAggregate={stats?.max ?? undefined}
                                />
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}
