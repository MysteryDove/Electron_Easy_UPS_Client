import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnection, useAppConfig } from '../app/providers';
import type { TelemetryDataPoint } from '../../main/db/telemetryRepository';
import { SparklineCard } from '../components/SparklineCard';
import { Battery, Zap, Activity, Plug, BatteryWarning } from 'lucide-react';

import type { TFunction } from 'i18next';

const HISTORY_LIMIT = 50;

type MetricKey = { key: string; title: string; unit: string; icon?: React.ReactNode; type?: 'voltage' | 'frequency' | 'current' | 'percent' | 'default'; nominalKey?: string; applyMovingAverage?: boolean };

function getStatusInfo(statusNum: number | null | undefined, t: TFunction): { label: string; className: string; icon: React.ReactNode } {
    if (statusNum === 1) return { label: t('dashboard.statusOnline'), className: 'ups-status-badge--online', icon: <Plug size={18} /> };
    if (statusNum === 0) return { label: t('dashboard.statusBattery'), className: 'ups-status-badge--battery', icon: <BatteryWarning size={18} /> };
    return { label: t('dashboard.statusUnknown'), className: 'ups-status-badge--unknown', icon: <Activity size={18} /> };
}

export function DashboardPage() {
    const { t } = useTranslation();
    const { staticData, lastTelemetry } = useConnection();
    const { config } = useAppConfig();
    const [history, setHistory] = useState<TelemetryDataPoint[]>([]);

    const BATTERY_KEYS: MetricKey[] = [
        { key: 'battery_charge_pct', title: t('metrics.batteryCharge'), unit: '%', icon: <Battery size={16} />, type: 'percent' },
        { key: 'battery_voltage', title: t('metrics.batteryVoltage'), unit: 'V', icon: <Zap size={16} />, type: 'voltage' },
        { key: 'battery_current', title: t('metrics.batteryCurrent'), unit: 'A', icon: <Activity size={16} />, type: 'current', applyMovingAverage: true },
    ];

    const INPUT_KEYS: MetricKey[] = [
        { key: 'input_voltage', title: t('metrics.inputVoltage'), unit: 'V', icon: <Zap size={16} />, type: 'voltage', nominalKey: 'input.voltage.nominal' },
        { key: 'input_frequency_hz', title: t('metrics.inputFrequency'), unit: 'Hz', icon: <Activity size={16} />, type: 'frequency' },
        { key: 'input_current', title: t('metrics.inputCurrent'), unit: 'A', icon: <Activity size={16} />, type: 'current', applyMovingAverage: true },
    ];

    const OUTPUT_KEYS: MetricKey[] = [
        { key: 'output_voltage', title: t('metrics.outputVoltage'), unit: 'V', icon: <Zap size={16} />, type: 'voltage', nominalKey: 'output.voltage.nominal' },
        { key: 'output_frequency_hz', title: t('metrics.outputFrequency'), unit: 'Hz', icon: <Activity size={16} />, type: 'frequency' },
        { key: 'ups_load_pct', title: t('metrics.upsLoad'), unit: '%', icon: <Zap size={16} />, type: 'percent', applyMovingAverage: true },
        { key: 'ups_realpower_watts', title: t('metrics.realPower'), unit: 'W', icon: <Zap size={16} />, type: 'default', applyMovingAverage: true },
        { key: 'ups_apparent_power_va', title: t('metrics.apparentPower'), unit: 'VA', icon: <Zap size={16} />, type: 'default', applyMovingAverage: true },
        { key: 'output_current', title: t('metrics.outputCurrent'), unit: 'A', icon: <Activity size={16} />, type: 'current', applyMovingAverage: true },
    ];

    useEffect(() => {
        let mounted = true;
        const fetchHistory = async () => {
            try {
                // Fetch last ~5 minutes assuming 6s poll
                const end = new Date();
                const start = new Date(end.getTime() - 5 * 60 * 1000);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data = await (window as any).electronApi.telemetry.queryRange({
                    startIso: start.toISOString(),
                    endIso: end.toISOString(),
                });
                if (mounted) {
                    setHistory(data.slice(-HISTORY_LIMIT));
                }
            } catch (err) {
                console.error('Failed to fetch telemetry history', err);
            }
        };
        void fetchHistory();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        if (!lastTelemetry) return;
        setHistory((prev) => {
            // Check if we already have this exact timestamp to avoid dupes
            if (prev.length > 0 && prev[prev.length - 1].ts === lastTelemetry.ts) {
                return prev;
            }
            // Push the exact TelemetryDataPoint shape into history
            const newPoint: TelemetryDataPoint = {
                ts: lastTelemetry.ts,
                values: lastTelemetry.values,
            };
            const updated = [...prev, newPoint];
            if (updated.length > HISTORY_LIMIT) {
                return updated.slice(updated.length - HISTORY_LIMIT);
            }
            return updated;
        });
    }, [lastTelemetry]);

    const renderGroup = (title: string, metrics: typeof BATTERY_KEYS) => {
        return (
            <div className="dashboard-group">
                <h2 className="dashboard-group-title">{title}</h2>
                <div className="metrics-grid">
                    {metrics.map((m) => {
                        const key = m.key as keyof typeof lastTelemetry.values;
                        const currentVal = lastTelemetry?.values[key] as number | undefined;
                        // Extract array of historical numbers for this key, defaulting to 0 for nulls to keep the array length consistent
                        const dataArray = history.map(row => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const val = row.values ? row.values[key] : (row as any)[key];
                            return typeof val === 'number' ? val : null;
                        }).filter(v => v !== null) as number[];

                        let nominalVal: number | undefined = undefined;
                        let tolPos: number | undefined = undefined;
                        let tolNeg: number | undefined = undefined;

                        // Apply config line nominal values only to line metrics (those with a nominalKey),
                        // not to battery voltage which has no nominalKey.
                        if (m.type === 'voltage' && m.nominalKey && config?.line?.nominalVoltage) {
                            nominalVal = config.line.nominalVoltage;
                            tolPos = config.line.voltageTolerancePosPct;
                            tolNeg = config.line.voltageToleranceNegPct;
                        } else if (m.type === 'frequency' && config?.line?.nominalFrequency) {
                            nominalVal = config.line.nominalFrequency;
                            tolPos = config.line.frequencyTolerancePosPct;
                            tolNeg = config.line.frequencyToleranceNegPct;
                        } else if (m.nominalKey && staticData && typeof staticData[m.nominalKey] !== 'undefined') {
                            const parsed = parseFloat(staticData[m.nominalKey]);
                            if (!isNaN(parsed)) nominalVal = parsed;
                        }

                        if (currentVal === undefined || currentVal === null) {
                            return null;
                        }

                        return (
                            <SparklineCard
                                key={m.key}
                                title={m.title}
                                currentValue={currentVal}
                                unit={m.unit}
                                icon={m.icon}
                                data={dataArray}
                                metricType={m.type}
                                nominalValue={nominalVal}
                                applyMovingAverage={m.applyMovingAverage}
                                tolerancePosPct={tolPos}
                                toleranceNegPct={tolNeg}
                            />
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="dashboard-page">
            <header className="page-header">
                <h1 className="page-title">{t('dashboard.title')}</h1>
                {lastTelemetry && (
                    <span className="page-subtitle">
                        {t('dashboard.lastUpdate', { time: new Date(lastTelemetry.ts).toLocaleTimeString() })}
                    </span>
                )}
            </header>

            {/* UPS Status Banner */}
            {lastTelemetry && (() => {
                const statusVal = lastTelemetry.values.ups_status_num as number | null | undefined;
                const info = getStatusInfo(statusVal, t);
                return (
                    <div className={`ups-status-badge ${info.className}`}>
                        <span className="ups-status-badge-icon">{info.icon}</span>
                        <span className="ups-status-badge-label">{info.label}</span>
                    </div>
                );
            })()}

            <section className="dashboard-metrics">
                {renderGroup(t('dashboard.groupBattery'), BATTERY_KEYS)}
                {renderGroup(t('dashboard.groupInput'), INPUT_KEYS)}
                {renderGroup(t('dashboard.groupOutput'), OUTPUT_KEYS)}
            </section>

            {/* Static info panel */}
            {staticData && Object.keys(staticData).length > 0 && (
                <details className="dashboard-static group mb-6">
                    <summary className="cursor-pointer select-none flex items-center justify-between list-none [&::-webkit-details-marker]:hidden">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{t('dashboard.staticInfo')}</span>
                        <span className="text-slate-400 transition-transform duration-200 group-open:rotate-180">
                            ▼
                        </span>
                    </summary>
                    <div className="static-grid border-t border-slate-200 dark:border-slate-700">
                        {Object.entries(staticData).map(([key, value]) => (
                            <div key={key} className="static-item">
                                <span className="static-item-label">{key}</span>
                                <span className="static-item-value">{value}</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}


