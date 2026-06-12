/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultAppConfig,
  type AppConfig,
} from '../../../../main/config/configSchema';
import type {
  ConnectionState,
  LocalDriverLaunchIssue,
  TelemetryDataPoint,
  TelemetryValues,
} from '../../../../shared/ipc/contracts';
import type { DashboardTelemetryUpdateCallback } from '../types';
import { useDashboardData } from './useDashboardData';

const mockQueryRange = vi.fn<(request: unknown) => Promise<TelemetryDataPoint[]>>();

let mockConnectionState: {
  state: ConnectionState;
  staticData: Record<string, string> | null;
  dynamicData: Record<string, string> | null;
  lastTelemetry: { ts: string; values: TelemetryValues } | null;
  localDriverLaunchIssue: LocalDriverLaunchIssue | null;
};

let mockAppConfig: {
  config: AppConfig | null;
  refreshConfig: () => Promise<void>;
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

vi.mock('../../../app/providers', () => ({
  useConnection: () => mockConnectionState,
  useAppConfig: () => mockAppConfig,
}));

vi.mock('../../../app/electronApi', () => ({
  electronApi: {
    telemetry: {
      queryRange: (request: unknown) => mockQueryRange(request),
    },
  },
}));

function DashboardDataHarness({
  listeners,
}: {
  listeners: DashboardTelemetryUpdateCallback[];
}) {
  const data = useDashboardData();
  const onUpdate = data?.telemetry.onUpdate;

  useEffect(() => {
    if (!onUpdate) {
      return undefined;
    }

    const unsubscribers = listeners.map((listener) => onUpdate(listener));

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [listeners, onUpdate]);

  return (
    <>
      <div data-testid="history-count">
        {String(data?.telemetry.history.length ?? -1)}
      </div>
      <div data-testid="latest-history-ts">
        {data?.telemetry.history.at(-1)?.ts ?? 'none'}
      </div>
    </>
  );
}

describe('useDashboardData', () => {
  beforeEach(() => {
    mockConnectionState = {
      state: 'ready',
      staticData: null,
      dynamicData: null,
      lastTelemetry: null,
      localDriverLaunchIssue: null,
    };
    mockAppConfig = {
      config: structuredClone(defaultAppConfig),
      refreshConfig: async () => undefined,
    };
    mockQueryRange.mockReset().mockResolvedValue([]);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it('continues notifying later listeners and merges history when one listener throws', async () => {
    const baseMs = Date.now();
    const initialHistoryPoint: TelemetryDataPoint = {
      ts: new Date(baseMs - 1_000).toISOString(),
      values: { battery_charge_pct: 98 },
    };
    const nextValues: TelemetryValues = {
      battery_charge_pct: 95,
      input_voltage: 230,
    };
    const nextTelemetry = {
      ts: new Date(baseMs).toISOString(),
      values: nextValues,
    };
    const listenerError = new Error('listener failed');
    const firstListener = vi.fn<DashboardTelemetryUpdateCallback>();
    const failingListener = vi.fn<DashboardTelemetryUpdateCallback>(() => {
      throw listenerError;
    });
    const thirdListener = vi.fn<DashboardTelemetryUpdateCallback>();
    const listeners = [firstListener, failingListener, thirdListener];

    mockQueryRange.mockResolvedValue([initialHistoryPoint]);

    const { rerender } = render(
      <DashboardDataHarness listeners={listeners} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('history-count')).toHaveTextContent('1');
      expect(screen.getByTestId('latest-history-ts')).toHaveTextContent(
        initialHistoryPoint.ts,
      );
    });

    mockConnectionState = {
      ...mockConnectionState,
      lastTelemetry: nextTelemetry,
    };

    rerender(<DashboardDataHarness listeners={listeners} />);

    await waitFor(() => {
      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(firstListener).toHaveBeenCalledWith(nextValues);
      expect(failingListener).toHaveBeenCalledTimes(1);
      expect(failingListener).toHaveBeenCalledWith(nextValues);
      expect(thirdListener).toHaveBeenCalledTimes(1);
      expect(thirdListener).toHaveBeenCalledWith(nextValues);
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[useDashboardData] telemetry update listener failed',
      listenerError,
    );

    await waitFor(() => {
      expect(screen.getByTestId('history-count')).toHaveTextContent('2');
      expect(screen.getByTestId('latest-history-ts')).toHaveTextContent(
        nextTelemetry.ts,
      );
    });
  });
});