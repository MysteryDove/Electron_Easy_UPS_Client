/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppConfig } from '../../../../main/config/configSchema';
import type { DashboardData } from '../types';
import { PowerQualityTemplate } from './PowerQualityTemplate';

let mockDashboardData: DashboardData;
let capturedQualityCards: Array<{
  label: string;
  nominalValue: number;
  tolerancePosPct: number;
  toleranceNegPct: number;
}>;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../DashboardDataProvider', () => ({
  useDashboardDataContext: () => mockDashboardData,
}));

vi.mock('../../../../shared/upsStatus/statusModel', () => ({
  parseUpsStatusTokens: (): string[] => [],
  deriveUpsBannerState: () => ({
    primary: 'online',
    modifiers: [] as string[],
    severity: 'ok',
  }),
}));

vi.mock('../components', () => ({
  QualityBandCard: (props: {
    label: string;
    nominalValue: number;
    tolerancePosPct: number;
    toleranceNegPct: number;
  }) => {
    capturedQualityCards.push(props);
    return <div data-testid="quality-band-card">{props.label}</div>;
  },
}));

vi.mock('../../../components/SparklineCard', () => ({
  SparklineCard: () => <div data-testid="sparkline-card" />,
}));

vi.mock('../../../components/UpsStatusBanner', () => ({
  UpsStatusBanner: () => <div data-testid="ups-status-banner" />,
}));

describe('PowerQualityTemplate', () => {
  beforeEach(() => {
    capturedQualityCards = [];
    mockDashboardData = {
      connection: {
        state: 'ready',
        lastUpdateTime: null,
        isStale: false,
        driverIssue: null,
      },
      ups: {
        static: null,
        dynamic: null,
      },
      telemetry: {
        latest: {
          ts: '2026-06-13T20:00:00.000Z',
          values: {
            input_voltage: 121,
            output_voltage: 119,
            input_frequency_hz: 59.8,
            output_frequency_hz: 60.2,
            input_current: 3.1,
            output_current: 2.7,
            ups_apparent_power_va: 480,
            ups_realpower_watts: 420,
            ups_status_num: 1,
          },
        },
        history: [],
        onUpdate: () => () => undefined,
      },
      config: {
        ...structuredClone(defaultAppConfig),
        line: {
          nominalVoltage: 120,
          nominalFrequency: 60,
          voltageTolerancePosPct: 5,
          voltageToleranceNegPct: 12,
          frequencyTolerancePosPct: 1.5,
          frequencyToleranceNegPct: 3.5,
          alertEnabled: true,
          alertCooldownMinutes: 30,
        },
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('passes configured nominal values and asymmetric tolerances to quality cards', () => {
    render(<PowerQualityTemplate />);

    expect(capturedQualityCards).toHaveLength(4);
    expect(capturedQualityCards[0]).toMatchObject({
      label: 'metrics.inputVoltage',
      nominalValue: 120,
      tolerancePosPct: 5,
      toleranceNegPct: 12,
    });
    expect(capturedQualityCards[1]).toMatchObject({
      label: 'metrics.outputVoltage',
      nominalValue: 120,
      tolerancePosPct: 5,
      toleranceNegPct: 12,
    });
    expect(capturedQualityCards[2]).toMatchObject({
      label: 'metrics.inputFrequency',
      nominalValue: 60,
      tolerancePosPct: 1.5,
      toleranceNegPct: 3.5,
    });
    expect(capturedQualityCards[3]).toMatchObject({
      label: 'metrics.outputFrequency',
      nominalValue: 60,
      tolerancePosPct: 1.5,
      toleranceNegPct: 3.5,
    });
  });
});