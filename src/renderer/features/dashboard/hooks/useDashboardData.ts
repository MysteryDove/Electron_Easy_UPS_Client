import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { electronApi } from '../../../app/electronApi';
import { useAppConfig, useConnection } from '../../../app/providers';
import type {
  TelemetryColumn,
  TelemetryDataPoint,
} from '../../../../shared/ipc/contracts';
import type {
  DashboardData,
  DashboardTelemetryUpdateCallback,
} from '../types';

const HISTORY_LIMIT = 50;
const HISTORY_WINDOW_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 15 * 1000;

const HISTORY_COLUMNS: TelemetryColumn[] = [
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
];

export function useDashboardData(): DashboardData | null {
  const {
    state,
    staticData,
    dynamicData,
    lastTelemetry,
    localDriverLaunchIssue,
  } = useConnection();
  const { config } = useAppConfig();
  const [history, setHistory] = useState<TelemetryDataPoint[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const listenersRef = useRef<Set<DashboardTelemetryUpdateCallback>>(new Set());

  const onUpdate = useCallback((callback: DashboardTelemetryUpdateCallback) => {
    listenersRef.current.add(callback);

    return () => {
      listenersRef.current.delete(callback);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const fetchHistory = async () => {
      try {
        const end = new Date();
        const start = new Date(end.getTime() - HISTORY_WINDOW_MS);
        const data = await electronApi.telemetry.queryRange({
          startIso: start.toISOString(),
          endIso: end.toISOString(),
          columns: HISTORY_COLUMNS,
          maxPoints: HISTORY_LIMIT,
        });

        if (isActive) {
          setHistory(trimTelemetryHistory(data));
        }
      } catch (error) {
        console.error('Failed to fetch dashboard telemetry history', error);
      }
    };

    void fetchHistory();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!lastTelemetry) {
      return;
    }

    listenersRef.current.forEach((callback) => {
      callback(lastTelemetry.values);
    });

    setHistory((previousHistory) =>
      mergeTelemetryPoint(previousHistory, {
        ts: lastTelemetry.ts,
        values: lastTelemetry.values,
      }),
    );
  }, [lastTelemetry]);

  // Update staleness check based on configured polling interval
  // Dependency stabilized to avoid recreating interval on every telemetry update
  useEffect(() => {
    if (!lastTelemetry?.ts || !config) {
      setNowMs(Date.now());
      return undefined;
    }

    // Set immediately on telemetry change
    setNowMs(Date.now());

    // Then update at the same rate as telemetry polling
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, config.polling.intervalMs);

    return () => {
      clearInterval(interval);
    };
  }, [!!lastTelemetry?.ts, config?.polling.intervalMs]);

  const lastUpdateTime = useMemo(
    () => (lastTelemetry?.ts ? new Date(lastTelemetry.ts) : null),
    [lastTelemetry?.ts],
  );

  // Note: onUpdate omitted from deps - it's memoized with empty array and never changes
  return useMemo<DashboardData | null>(() => {
    if (!config) {
      return null;
    }

    return {
      connection: {
        state,
        lastUpdateTime,
        isStale: lastUpdateTime
          ? nowMs - lastUpdateTime.getTime() > STALE_THRESHOLD_MS
          : false,
        driverIssue: localDriverLaunchIssue,
      },
      ups: {
        static: staticData,
        dynamic: dynamicData,
      },
      telemetry: {
        latest: lastTelemetry,
        history,
        onUpdate,
      },
      config,
    };
  }, [
    config,
    dynamicData,
    history,
    lastTelemetry,
    lastUpdateTime,
    localDriverLaunchIssue,
    nowMs,
    state,
    staticData,
  ]);
}

function mergeTelemetryPoint(
  history: TelemetryDataPoint[],
  nextPoint: TelemetryDataPoint,
): TelemetryDataPoint[] {
  const dedupedHistory = history.filter((point) => point.ts !== nextPoint.ts);

  return trimTelemetryHistory([...dedupedHistory, nextPoint], nextPoint.ts);
}

function trimTelemetryHistory(
  history: TelemetryDataPoint[],
  referenceTs?: string,
): TelemetryDataPoint[] {
  const referenceMs = referenceTs ? Date.parse(referenceTs) : Date.now();
  const earliestAllowedMs = referenceMs - HISTORY_WINDOW_MS;

  return [...history]
    .filter((point) => {
      const pointMs = Date.parse(point.ts);
      return Number.isFinite(pointMs) && pointMs >= earliestAllowedMs;
    })
    .sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts))
    .slice(-HISTORY_LIMIT);
}
