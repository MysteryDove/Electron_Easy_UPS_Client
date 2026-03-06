import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { electronApi } from '../app/electronApi';
import { useConnection } from '../app/providers';
import type {
  TelemetryColumn,
  TelemetryDataPoint,
  TelemetryRangeLimits,
} from '../../shared/ipc/contracts';
import { TelemetryRowCard } from '../components/TelemetryRowCard';
import { UiSelect } from '../components/ui';

type TimeScale =
  | '10 Minutes'
  | '30 Minutes'
  | '1 Hour'
  | '3 Hours'
  | '12 Hours'
  | '1 Day'
  | '3 Days';

const TIME_SCALE_MS: Record<TimeScale, number> = {
  '10 Minutes': 10 * 60 * 1000,
  '30 Minutes': 30 * 60 * 1000,
  '1 Hour': 60 * 60 * 1000,
  '3 Hours': 3 * 60 * 60 * 1000,
  '12 Hours': 12 * 60 * 60 * 1000,
  '1 Day': 24 * 60 * 60 * 1000,
  '3 Days': 72 * 60 * 60 * 1000,
};

type MetricMeta = {
  key: TelemetryColumn;
  title: string;
  unit: string;
  type?: 'voltage' | 'frequency' | 'current' | 'percent' | 'temperature';
  nominalKey?: string;
  applyMovingAverage?: boolean;
};

const MAX_CHART_POINTS = 300;
const LIVE_HISTORY_LIMIT = 350;

export function TelemetryPage() {
  const { t } = useTranslation();
  const { lastTelemetry, staticData } = useConnection();
  const [timeScale, setTimeScale] = useState<TimeScale>('1 Hour');
  const [history, setHistory] = useState<TelemetryDataPoint[]>([]);
  const [minMax, setMinMax] = useState<TelemetryRangeLimits>({});
  const [isLoading, setIsLoading] = useState(true);

  const metricMeta: MetricMeta[] = [
    {
      key: 'battery_charge_pct',
      title: t('metrics.batteryCharge'),
      unit: '%',
      type: 'percent',
    },
    {
      key: 'battery_voltage',
      title: t('metrics.batteryVoltage'),
      unit: 'V',
      type: 'voltage',
      nominalKey: 'battery.voltage.nominal',
    },
    {
      key: 'battery_current',
      title: t('metrics.batteryCurrent'),
      unit: 'A',
      type: 'current',
    },
    {
      key: 'battery_temperature',
      title: t('metrics.batteryTemp'),
      unit: '°C',
      type: 'temperature',
      applyMovingAverage: true,
    },
    {
      key: 'battery_runtime_sec',
      title: t('metrics.batteryRuntime'),
      unit: 's',
      applyMovingAverage: true,
    },
    {
      key: 'input_voltage',
      title: t('metrics.inputVoltage'),
      unit: 'V',
      type: 'voltage',
      nominalKey: 'input.voltage.nominal',
    },
    {
      key: 'input_frequency_hz',
      title: t('metrics.inputFrequency'),
      unit: 'Hz',
      type: 'frequency',
      nominalKey: 'input.frequency.nominal',
    },
    {
      key: 'input_current',
      title: t('metrics.inputCurrent'),
      unit: 'A',
      type: 'current',
    },
    {
      key: 'output_voltage',
      title: t('metrics.outputVoltage'),
      unit: 'V',
      type: 'voltage',
      nominalKey: 'output.voltage.nominal',
    },
    {
      key: 'output_frequency_hz',
      title: t('metrics.outputFrequency'),
      unit: 'Hz',
      type: 'frequency',
      nominalKey: 'output.frequency.nominal',
    },
    {
      key: 'output_current',
      title: t('metrics.outputCurrent'),
      unit: 'A',
      type: 'current',
      applyMovingAverage: true,
    },
    {
      key: 'ups_load_pct',
      title: t('metrics.upsLoad'),
      unit: '%',
      type: 'percent',
    },
    {
      key: 'ups_realpower_watts',
      title: t('metrics.realPower'),
      unit: 'W',
    },
    {
      key: 'ups_temperature',
      title: t('metrics.upsTemp'),
      unit: '°C',
      type: 'temperature',
      applyMovingAverage: true,
    },
    {
      key: 'ups_status_num',
      title: t('metrics.upsStatus'),
      unit: '',
    },
  ];

  const selectedColumns = useMemo<TelemetryColumn[]>(
    () => [
      'battery_charge_pct',
      'battery_voltage',
      'battery_current',
      'battery_temperature',
      'battery_runtime_sec',
      'input_voltage',
      'input_frequency_hz',
      'input_current',
      'output_voltage',
      'output_frequency_hz',
      'output_current',
      'ups_load_pct',
      'ups_realpower_watts',
      'ups_temperature',
      'ups_status_num',
    ],
    [],
  );

  const telemetryWindow = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - TIME_SCALE_MS[timeScale]);
    return { start, end };
  }, [lastTelemetry?.ts, timeScale]);

  useEffect(() => {
    let mounted = true;

    const fetchHistory = async () => {
      setIsLoading(true);

      try {
        const now = new Date();
        const start = new Date(now.getTime() - TIME_SCALE_MS[timeScale]);
        const [data, limits] = await Promise.all([
          electronApi.telemetry.queryRange({
            startIso: start.toISOString(),
            endIso: now.toISOString(),
            columns: selectedColumns,
            maxPoints: MAX_CHART_POINTS,
          }),
          electronApi.telemetry.getMinMaxForRange({
            startIso: start.toISOString(),
            endIso: now.toISOString(),
            columns: selectedColumns,
          }),
        ]);

        if (mounted) {
          setHistory(data);
          setMinMax(limits);
        }
      } catch (error) {
        console.error(
          'Failed to fetch telemetry history for telemetry page:',
          error,
        );
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchHistory();
    return () => {
      mounted = false;
    };
  }, [selectedColumns, timeScale]);

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
      if (nextHistory.length > LIVE_HISTORY_LIMIT) {
        return nextHistory.slice(nextHistory.length - LIVE_HISTORY_LIMIT);
      }

      return nextHistory;
    });

    setMinMax((previousMinMax) => {
      const nextMinMax = { ...previousMinMax };

      for (const [key, value] of Object.entries(lastTelemetry.values)) {
        if (typeof value !== 'number') {
          continue;
        }

        const typedKey = key as TelemetryColumn;
        const currentBounds = nextMinMax[typedKey];
        if (!currentBounds) {
          nextMinMax[typedKey] = { min: value, max: value };
          continue;
        }

        nextMinMax[typedKey] = {
          min:
            currentBounds.min !== null
              ? Math.min(currentBounds.min, value)
              : value,
          max:
            currentBounds.max !== null
              ? Math.max(currentBounds.max, value)
              : value,
        };
      }

      return nextMinMax;
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
          <UiSelect
            value={timeScale}
            onChange={(event) => setTimeScale(event.target.value as TimeScale)}
            className="telemetry-select"
            disabled={isLoading}
          >
            {(Object.keys(TIME_SCALE_MS) as TimeScale[]).map((scale) => (
              <option key={scale} value={scale}>
                {t(`telemetry.timeScale.${scale.replace(' ', '')}`)}
              </option>
            ))}
          </UiSelect>
        </div>
      </header>

      <section className="telemetry-list">
        {isLoading && history.length === 0 ? (
          <div className="loading-state">{t('telemetry.loading')}</div>
        ) : (
          <div className="telemetry-grid">
            {metricMeta.map((meta) => {
              const currentVal = lastTelemetry?.values[meta.key] as
                | number
                | null
                | undefined;
              const rowData = history
                .map((point) => {
                  const value = point.values[meta.key];
                  return {
                    ts: new Date(point.ts),
                    value: typeof value === 'number' ? value : null,
                  };
                })
                .filter(
                  (
                    item,
                  ): item is {
                    ts: Date;
                    value: number;
                  } => item.value !== null,
                );

              if (
                (currentVal === undefined || currentVal === null) &&
                rowData.length === 0
              ) {
                return null;
              }

              let nominalVal: number | undefined;
              if (
                meta.nominalKey &&
                staticData &&
                typeof staticData[meta.nominalKey] !== 'undefined'
              ) {
                const parsedNominal = parseFloat(staticData[meta.nominalKey]);
                if (!Number.isNaN(parsedNominal)) {
                  nominalVal = parsedNominal;
                }
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
                  windowStart={telemetryWindow.start}
                  windowEnd={telemetryWindow.end}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
