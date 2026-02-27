import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnection, useAppConfig } from '../app/providers';
import type { TelemetryDataPoint } from '../../main/db/telemetryRepository';
import { SparklineCard } from '../components/SparklineCard';
import { Battery, Zap, Activity, Plug, BatteryWarning, ChevronDown } from 'lucide-react';
import { Disclosure, Transition } from '@headlessui/react';

import type { TFunction } from 'i18next';

const HISTORY_LIMIT = 50;

type MetricKey = { key: string; title: string; unit: string; icon?: React.ReactNode; type?: 'voltage' | 'frequency' | 'current' | 'percent' | 'default'; nominalKey?: string; applyMovingAverage?: boolean };
type NutDetailsGroupKey = 'battery' | 'input' | 'output' | 'driver' | 'ups' | 'device' | 'ambient' | 'other';
type NutDetailsGroup = { key: NutDetailsGroupKey; label: string; entries: Array<[string, string]> };

const NUT_DETAILS_GROUP_ORDER: NutDetailsGroupKey[] = [
    'battery',
    'input',
    'output',
    'driver',
    'ups',
    'device',
    'ambient',
    'other',
];

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

    const groupedNutDetails = useMemo<NutDetailsGroup[]>(() => {
        if (!staticData || Object.keys(staticData).length === 0) {
            return [];
        }

        const buckets = new Map<NutDetailsGroupKey, Array<[string, string]>>();
        for (const groupKey of NUT_DETAILS_GROUP_ORDER) {
            buckets.set(groupKey, []);
        }

        const sortedEntries = Object.entries(staticData).sort(([left], [right]) =>
            left.localeCompare(right),
        );

        for (const [fieldName, value] of sortedEntries) {
            const groupKey = resolveNutDetailsGroupKey(fieldName);
            const entries = buckets.get(groupKey);
            if (entries) {
                entries.push([fieldName, value]);
            }
        }

        return NUT_DETAILS_GROUP_ORDER
            .map((groupKey) => ({
                key: groupKey,
                label: getNutDetailsGroupLabel(groupKey, t),
                entries: buckets.get(groupKey) ?? [],
            }))
            .filter((group) => group.entries.length > 0);
    }, [staticData, t]);

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

            {!lastTelemetry && (
                <div className="page-loading">
                    <span className="page-subtitle">{t('dashboard.waitingTelemetry')}</span>
                </div>
            )}

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

            {/* Detailed raw NUT info (includes all keys, even if duplicated in top cards). */}
            {groupedNutDetails.length > 0 && (
                <Disclosure>
                    {({ open }) => (
                        <section className="dashboard-static">
                            <Disclosure.Button className="dashboard-static-toggle" type="button">
                                <span className="dashboard-static-title">{t('dashboard.staticInfo')}</span>
                                <span className={`dashboard-static-chevron ${open ? 'dashboard-static-chevron--open' : ''}`}>
                                    <ChevronDown size={16} />
                                </span>
                            </Disclosure.Button>

                            <Transition
                                as={Fragment}
                                show={open}
                                enter="disclosure-motion"
                                enterFrom="disclosure-motion--closed"
                                enterTo="disclosure-motion--open"
                                leave="disclosure-motion"
                                leaveFrom="disclosure-motion--open"
                                leaveTo="disclosure-motion--closed"
                            >
                                <Disclosure.Panel className="disclosure-motion-panel static-groups">
                                    {groupedNutDetails.map((group) => (
                                        <Disclosure key={group.key}>
                                            {({ open: groupOpen }) => (
                                                <div className="static-group">
                                                    <Disclosure.Button className="static-group-toggle" type="button">
                                                        <span className="static-group-title-wrap">
                                                            <span className="static-group-title">{group.label}</span>
                                                            <span className="static-group-count">{group.entries.length}</span>
                                                        </span>
                                                        <span className={`static-group-chevron ${groupOpen ? 'static-group-chevron--open' : ''}`}>
                                                            <ChevronDown size={14} />
                                                        </span>
                                                    </Disclosure.Button>

                                                    <Transition
                                                        as={Fragment}
                                                        show={groupOpen}
                                                        enter="disclosure-motion disclosure-motion--nested"
                                                        enterFrom="disclosure-motion--closed"
                                                        enterTo="disclosure-motion--open"
                                                        leave="disclosure-motion disclosure-motion--nested"
                                                        leaveFrom="disclosure-motion--open"
                                                        leaveTo="disclosure-motion--closed"
                                                    >
                                                        <Disclosure.Panel className="disclosure-motion-panel disclosure-motion-panel--nested static-grid">
                                                            {group.entries.map(([fieldName, value]) => (
                                                                <div key={fieldName} className="static-item">
                                                                    <span className="static-item-label">{fieldName}</span>
                                                                    <span className="static-item-value">{value}</span>
                                                                </div>
                                                            ))}
                                                        </Disclosure.Panel>
                                                    </Transition>
                                                </div>
                                            )}
                                        </Disclosure>
                                    ))}
                                </Disclosure.Panel>
                            </Transition>
                        </section>
                    )}
                </Disclosure>
            )}
        </div>
    );
}

function resolveNutDetailsGroupKey(fieldName: string): NutDetailsGroupKey {
    const prefix = fieldName.split('.')[0]?.toLowerCase() ?? '';
    if (prefix === 'battery') return 'battery';
    if (prefix === 'input') return 'input';
    if (prefix === 'output') return 'output';
    if (prefix === 'driver') return 'driver';
    if (prefix === 'ups') return 'ups';
    if (prefix === 'device') return 'device';
    if (prefix === 'ambient') return 'ambient';
    return 'other';
}

function getNutDetailsGroupLabel(groupKey: NutDetailsGroupKey, t: TFunction): string {
    if (groupKey === 'battery') return t('dashboard.detailGroupBattery', 'Battery');
    if (groupKey === 'input') return t('dashboard.detailGroupInput', 'Input');
    if (groupKey === 'output') return t('dashboard.detailGroupOutput', 'Output');
    if (groupKey === 'driver') return t('dashboard.detailGroupDriver', 'Driver');
    if (groupKey === 'ups') return t('dashboard.detailGroupUps', 'UPS');
    if (groupKey === 'device') return t('dashboard.detailGroupDevice', 'Device');
    if (groupKey === 'ambient') return t('dashboard.detailGroupAmbient', 'Ambient');
    return t('dashboard.detailGroupOther', 'Other');
}
