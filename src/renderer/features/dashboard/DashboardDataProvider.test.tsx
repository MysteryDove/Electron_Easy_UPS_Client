/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppConfig } from '../../../main/config/configSchema';
import type { DashboardData } from './types';
import {
  DashboardDataProvider,
  useDashboardDataContext,
} from './DashboardDataProvider';

let mockDashboardData: DashboardData | null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
}));

vi.mock('./hooks/useDashboardData', () => ({
  useDashboardData: () => mockDashboardData,
}));

function ContextProbe() {
  const data = useDashboardDataContext();

  return <div data-testid="connection-state">{data.connection.state}</div>;
}

describe('DashboardDataProvider', () => {
  beforeEach(() => {
    mockDashboardData = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a loading placeholder while dashboard data is unavailable', () => {
    render(
      <DashboardDataProvider>
        <div>dashboard content</div>
      </DashboardDataProvider>,
    );

    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument();
  });

  it('provides dashboard data to descendants once available', () => {
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
        latest: null,
        history: [],
        onUpdate: () => () => undefined,
      },
      config: structuredClone(defaultAppConfig),
    };

    render(
      <DashboardDataProvider>
        <ContextProbe />
      </DashboardDataProvider>,
    );

    expect(screen.getByTestId('connection-state')).toHaveTextContent('ready');
  });
});