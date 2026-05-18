import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { Disclosure, Transition } from '@headlessui/react';
import {
  Activity,
  Battery,
  ChevronDown,
  Zap,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { electronApi } from '../app/electronApi';
import { useAppConfig, useConnection } from '../app/providers';
import type {
  TelemetryColumn,
  TelemetryDataPoint,
} from '../../shared/ipc/contracts';
import { SparklineCard } from '../components/SparklineCard';
import { UpsStatusBanner } from '../components/UpsStatusBanner';
import {
  deriveUpsBannerState,
  parseUpsStatusTokens,
} from '../../shared/upsStatus/statusModel';

const HISTORY_LIMIT = 50;

type MetricKey = {
  key: TelemetryColumn;
  title: string;
  unit: string;
  icon?: React.ReactNode;
  type?: 'voltage' | 'frequency' | 'current' | 'percent' | 'default';
  nominalKey?: string;
  applyMovingAverage?: boolean;
};

type NutDetailsGroupKey =
  | 'battery'
  | 'input'
  | 'output'
  | 'driver'
  | 'ups'
  | 'device'
  | 'ambient'
  | 'other';

type NutDetailsGroup = {
  key: NutDetailsGroupKey;
  label: string;
  entries: Array<[string, string]>;
};

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

function useElapsedSince(timestamp: string | undefined | null): number {
  const [elapsed, setElapsed] = useState<number>(() =>
    timestamp ? Math.max(0, (Date.now() - Date.parse(timestamp)) / 1000) : 0,
  );

  useEffect(() => {
    if (!timestamp) {
      setElapsed(0);
      return undefined;
    }
    const startMs = Date.parse(timestamp);
    setElapsed(Math.max(0, (Date.now() - startMs) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.max(0, (Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return elapsed;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const {
    state: connectionState,
    staticData,
    dynamicData,
    lastTelemetry,
    localDriverLaunchIssue,
  } = useConnection();
  const { config } = useAppConfig();
  const [history, setHistory] = useState<TelemetryDataPoint[]>([]);

  const bannerTokens = useMemo(
    () => parseUpsStatusTokens(dynamicData?.['ups.status']),
    [dynamicData],
  );
  const bannerAlarmText = dynamicData?.['ups.alarm'];
  const legacyStatusNumValue = lastTelemetry?.values.ups_status_num;
  const bannerStaleSeconds = useElapsedSince(lastTelemetry?.ts);
  const bannerState = deriveUpsBannerState({
    tokens: bannerTokens,
    legacyStatusNum:
      typeof legacyStatusNumValue === 'number' ? legacyStatusNumValue : null,
    connection: connectionState,
    staleSeconds: bannerStaleSeconds,
    driverIssue: localDriverLaunchIssue,
  });

  const batteryMetrics: MetricKey[] = [
    {
      key: 'battery_charge_pct',
      title: t('metrics.batteryCharge'),
      unit: '%',
      icon: <Battery size={16} />,
      type: 'percent',
    },
    {
      key: 'battery_voltage',
      title: t('metrics.batteryVoltage'),
      unit: 'V',
      icon: <Zap size={16} />,
      type: 'voltage',
    },
    {
      key: 'battery_current',
      title: t('metrics.batteryCurrent'),
      unit: 'A',
      icon: <Activity size={16} />,
      type: 'current',
      applyMovingAverage: true,
    },
  ];

  const inputMetrics: MetricKey[] = [
    {
      key: 'input_voltage',
      title: t('metrics.inputVoltage'),
      unit: 'V',
      icon: <Zap size={16} />,
      type: 'voltage',
      nominalKey: 'input.voltage.nominal',
    },
    {
      key: 'input_frequency_hz',
      title: t('metrics.inputFrequency'),
      unit: 'Hz',
      icon: <Activity size={16} />,
      type: 'frequency',
    },
    {
      key: 'input_current',
      title: t('metrics.inputCurrent'),
      unit: 'A',
      icon: <Activity size={16} />,
      type: 'current',
      applyMovingAverage: true,
    },
  ];

  const outputMetrics: MetricKey[] = [
    {
      key: 'output_voltage',
      title: t('metrics.outputVoltage'),
      unit: 'V',
      icon: <Zap size={16} />,
      type: 'voltage',
      nominalKey: 'output.voltage.nominal',
    },
    {
      key: 'output_frequency_hz',
      title: t('metrics.outputFrequency'),
      unit: 'Hz',
      icon: <Activity size={16} />,
      type: 'frequency',
    },
    {
      key: 'ups_load_pct',
      title: t('metrics.upsLoad'),
      unit: '%',
      icon: <Zap size={16} />,
      type: 'percent',
      applyMovingAverage: true,
    },
    {
      key: 'ups_realpower_watts',
      title: t('metrics.realPower'),
      unit: 'W',
      icon: <Zap size={16} />,
      type: 'default',
      applyMovingAverage: true,
    },
    {
      key: 'ups_apparent_power_va',
      title: t('metrics.apparentPower'),
      unit: 'VA',
      icon: <Zap size={16} />,
      type: 'default',
      applyMovingAverage: true,
    },
    {
      key: 'output_current',
      title: t('metrics.outputCurrent'),
      unit: 'A',
      icon: <Activity size={16} />,
      type: 'current',
      applyMovingAverage: true,
    },
  ];

  const historyColumns = useMemo<TelemetryColumn[]>(
    () => [
      'battery_charge_pct',
      'battery_voltage',
      'battery_current',
      'input_voltage',
      'input_frequency_hz',
      'input_current',
      'output_voltage',
      'output_frequency_hz',
      'ups_load_pct',
      'ups_realpower_watts',
      'ups_apparent_power_va',
      'output_current',
    ],
    [],
  );

  const rawNutDetails = useMemo<Record<string, string> | null>(() => {
    const merged = {
      ...(staticData ?? {}),
      ...(dynamicData ?? {}),
    };

    return Object.keys(merged).length > 0 ? merged : null;
  }, [dynamicData, staticData]);

  const groupedNutDetails = useMemo<NutDetailsGroup[]>(() => {
    if (!rawNutDetails) {
      return [];
    }

    const buckets = new Map<NutDetailsGroupKey, Array<[string, string]>>();
    for (const groupKey of NUT_DETAILS_GROUP_ORDER) {
      buckets.set(groupKey, []);
    }

    const sortedEntries = Object.entries(rawNutDetails).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    for (const [fieldName, value] of sortedEntries) {
      const groupKey = resolveNutDetailsGroupKey(fieldName);
      const entries = buckets.get(groupKey);
      if (entries) {
        entries.push([fieldName, value]);
      }
    }

    return NUT_DETAILS_GROUP_ORDER.map((groupKey) => ({
      key: groupKey,
      label: getNutDetailsGroupLabel(groupKey, t),
      entries: buckets.get(groupKey) ?? [],
    })).filter((group) => group.entries.length > 0);
  }, [rawNutDetails, t]);

  useEffect(() => {
    let mounted = true;

    const fetchHistory = async () => {
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 5 * 60 * 1000);
        const data = await electronApi.telemetry.queryRange({
          startIso: start.toISOString(),
          endIso: end.toISOString(),
          columns: historyColumns,
          maxPoints: HISTORY_LIMIT,
        });

        if (mounted) {
          setHistory(data);
        }
      } catch (error) {
        console.error('Failed to fetch telemetry history', error);
      }
    };

    void fetchHistory();
    return () => {
      mounted = false;
    };
  }, [historyColumns]);

  useEffect(() => {
    if (!lastTelemetry) {
      return;
    }

    setHistory((previousHistory) => {
      if (
        previousHistory.length > 0 &&
        previousHistory[previousHistory.length - 1].ts === lastTelemetry.ts
      ) {
        return previousHistory;
      }

      const nextHistory = [
        ...previousHistory,
        { ts: lastTelemetry.ts, values: lastTelemetry.values },
      ];

      if (nextHistory.length > HISTORY_LIMIT) {
        return nextHistory.slice(nextHistory.length - HISTORY_LIMIT);
      }

      return nextHistory;
    });
  }, [lastTelemetry]);

  const renderGroup = (title: string, metrics: MetricKey[]) => (
    <div className="dashboard-group">
      <h2 className="dashboard-group-title">{title}</h2>
      <div className="metrics-grid">
        {metrics.map((metric) => {
          const currentVal = lastTelemetry?.values[metric.key] as
            | number
            | null
            | undefined;
          const dataArray = history
            .map((row) => row.values[metric.key])
            .filter((value): value is number => typeof value === 'number');

          let nominalVal: number | undefined;
          let tolPos: number | undefined;
          let tolNeg: number | undefined;

          if (
            metric.type === 'voltage' &&
            metric.nominalKey &&
            config?.line?.nominalVoltage
          ) {
            nominalVal = config.line.nominalVoltage;
            tolPos = config.line.voltageTolerancePosPct;
            tolNeg = config.line.voltageToleranceNegPct;
          } else if (metric.type === 'frequency' && config?.line?.nominalFrequency) {
            nominalVal = config.line.nominalFrequency;
            tolPos = config.line.frequencyTolerancePosPct;
            tolNeg = config.line.frequencyToleranceNegPct;
          } else if (
            metric.nominalKey &&
            staticData &&
            typeof staticData[metric.nominalKey] !== 'undefined'
          ) {
            const parsedNominal = parseFloat(staticData[metric.nominalKey]);
            if (!Number.isNaN(parsedNominal)) {
              nominalVal = parsedNominal;
            }
          }

          if (currentVal === undefined || currentVal === null) {
            return null;
          }

          return (
            <SparklineCard
              key={metric.key}
              title={metric.title}
              currentValue={currentVal}
              unit={metric.unit}
              icon={metric.icon}
              data={dataArray}
              metricType={metric.type}
              nominalValue={nominalVal}
              applyMovingAverage={metric.applyMovingAverage}
              tolerancePosPct={tolPos}
              toleranceNegPct={tolNeg}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1 className="page-title">{t('dashboard.title')}</h1>
        {lastTelemetry && (
          <span className="page-subtitle">
            {t('dashboard.lastUpdate', {
              time: new Date(lastTelemetry.ts).toLocaleTimeString(),
            })}
          </span>
        )}
      </header>

      <UpsStatusBanner
        primary={bannerState.primary}
        modifiers={bannerState.modifiers}
        severity={bannerState.severity}
        rawTokens={bannerTokens}
        alarmText={bannerAlarmText}
      />

      {!lastTelemetry && (
        <div className="page-loading">
          <span className="page-subtitle">{t('dashboard.waitingTelemetry')}</span>
        </div>
      )}

      <section className="dashboard-metrics">
        {renderGroup(t('dashboard.groupBattery'), batteryMetrics)}
        {renderGroup(t('dashboard.groupInput'), inputMetrics)}
        {renderGroup(t('dashboard.groupOutput'), outputMetrics)}
      </section>

      {groupedNutDetails.length > 0 && (
        <Disclosure>
          {({ open }) => (
            <section className="dashboard-static">
              <Disclosure.Button className="dashboard-static-toggle" type="button">
                <span className="dashboard-static-title">
                  {t('dashboard.staticInfo')}
                </span>
                <span
                  className={`dashboard-static-chevron ${
                    open ? 'dashboard-static-chevron--open' : ''
                  }`}
                >
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
                            <span
                              className={`static-group-chevron ${
                                groupOpen ? 'static-group-chevron--open' : ''
                              }`}
                            >
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
