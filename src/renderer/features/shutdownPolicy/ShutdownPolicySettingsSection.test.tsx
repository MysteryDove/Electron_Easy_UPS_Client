/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyConfigPatch,
  defaultAppConfig,
  type AppConfig,
} from '../../../main/config/configSchema';
import type { AppConfigPatch } from '../../../shared/config/types';
import {
  DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
  DEFAULT_BATTERY_WARNING_RULE_ID,
  DEFAULT_COMMUNICATION_LOSS_RULE_ID,
  getNumericConditionValue,
} from '../../../shared/shutdownPolicy/defaultPolicies';
import type { ShutdownPolicyDecisionLogEntry } from '../../../shared/shutdownPolicy/types';
import { SettingsPage } from '../../pages/SettingsPage';
import { ShutdownPolicySettingsSection } from './ShutdownPolicySettingsSection';

const hoisted = vi.hoisted(() => ({
  currentConfig: null as AppConfig | null,
  mockNavigate: vi.fn(),
  mockSettingsGet: vi.fn<() => Promise<AppConfig>>(),
  mockSettingsUpdate: vi.fn<(patch: AppConfigPatch) => Promise<AppConfig>>(),
  mockRefreshConfig: vi.fn<() => Promise<void>>(),
  mockGetDecisionLog: vi.fn<() => Promise<ShutdownPolicyDecisionLogEntry[]>>(),
}));

const {
  mockNavigate,
  mockSettingsGet,
  mockSettingsUpdate,
  mockRefreshConfig,
  mockGetDecisionLog,
} = hoisted;

let currentConfig: AppConfig;
let mockDecisionLog: ShutdownPolicyDecisionLogEntry[];
let confirmSpy: ReturnType<typeof vi.spyOn>;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultValueOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const defaultValue = typeof defaultValueOrOptions === 'string'
        ? defaultValueOrOptions
        : key;
      const values = typeof defaultValueOrOptions === 'string'
        ? maybeOptions
        : defaultValueOrOptions;

      if (!values) {
        return defaultValue;
      }

      return Object.entries(values).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        defaultValue,
      );
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => hoisted.mockNavigate,
  };
});

vi.mock('../../app/providers', () => ({
  useAppConfig: () => ({
    config: hoisted.currentConfig,
    refreshConfig: hoisted.mockRefreshConfig,
  }),
}));

vi.mock('../../app/electronApi', () => ({
  electronApi: {
    settings: {
      get: hoisted.mockSettingsGet,
      update: hoisted.mockSettingsUpdate,
    },
    shutdownPolicy: {
      getDecisionLog: hoisted.mockGetDecisionLog,
    },
    wizard: {
      enter: vi.fn(),
    },
  },
}));

describe('ShutdownPolicySettingsSection renderer flows', () => {
  beforeEach(() => {
    currentConfig = structuredClone(defaultAppConfig);
    hoisted.currentConfig = currentConfig;
    mockDecisionLog = [];

    mockNavigate.mockReset();
    mockSettingsGet.mockReset().mockImplementation(async () => currentConfig);
    mockSettingsUpdate.mockReset().mockImplementation(async (patch) => {
      currentConfig = applyConfigPatch(currentConfig, patch);
      hoisted.currentConfig = currentConfig;
      return currentConfig;
    });
    mockRefreshConfig.mockReset().mockResolvedValue(undefined);
    mockGetDecisionLog.mockReset().mockImplementation(async () => mockDecisionLog);

    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    cleanup();
  });

  it('updates the generated simple policy when the warning threshold changes', async () => {
    render(<SettingsPage />);

    const warningInput = screen.getByLabelText('settings.warningPct');
    fireEvent.change(warningInput, { target: { value: '45' } });
    fireEvent.blur(warningInput);

    await waitFor(() => {
      expect(mockSettingsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          battery: expect.objectContaining({ warningPct: 45 }),
        }),
      );
    });

    const warningRule = currentConfig.shutdownPolicy.rules.find(
      (rule) => rule.id === DEFAULT_BATTERY_WARNING_RULE_ID,
    );

    expect(warningRule).toBeDefined();
    expect(getNumericConditionValue(warningRule!.trigger, 'battery.chargePercent')).toBe(45);
  });

  it('disables the generated battery shutdown rule when battery shutdown is toggled off', async () => {
    currentConfig = applyConfigPatch(currentConfig, {
      battery: {
        shutdownEnabled: true,
        criticalShutdownAlertEnabled: false,
      },
    });
    hoisted.currentConfig = currentConfig;

    render(<SettingsPage />);

    const shutdownToggle = screen.getByLabelText('settings.enableAutoShutdown');
    expect(shutdownToggle).toBeChecked();

    fireEvent.click(shutdownToggle);

    await waitFor(() => {
      expect(mockSettingsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          battery: expect.objectContaining({ shutdownEnabled: false }),
        }),
      );
    });

    const shutdownRule = currentConfig.shutdownPolicy.rules.find(
      (rule) => rule.id === DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
    );

    expect(shutdownRule).toBeDefined();
    expect(shutdownRule!.enabled).toBe(false);
  });

  it('warns before switching to advanced mode and preserves the generated simple rules', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    renderPolicySection(onSave);

    fireEvent.change(screen.getByLabelText('settings.shutdownPolicyMode'), {
      target: { value: 'advanced' },
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      'Switching to advanced mode keeps the generated simple rules and lets you edit them directly.',
    );

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'advanced',
          rules: expect.any(Array),
        }),
      );
    });

    const savedPolicy = onSave.mock.calls[0][0] as AppConfig['shutdownPolicy'];
    expect(savedPolicy.rules.map((rule) => rule.id)).toEqual(
      currentConfig.shutdownPolicy.rules.map((rule) => rule.id),
    );
  });

  it('shows matched and unmatched simulator results with explanations for synthetic input', async () => {
    renderPolicySection();

    fireEvent.change(screen.getByLabelText('settings.policySimulatorCharge'), {
      target: { value: '15' },
    });

    expect(
      await screen.findByText(
        'Rule Shutdown when battery is critically low while on battery (default-battery-shutdown) matched and will show a critical alert.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('settings.policySimulatorMatched').length).toBeGreaterThan(0);
    expect(screen.getAllByText('settings.policySimulatorNotMatched').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^PASS /).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^FAIL /).length).toBeGreaterThan(0);
  });

  it('preserves all trigger leaves when editing the default communication-loss rule', async () => {
    currentConfig = {
      ...currentConfig,
      shutdownPolicy: {
        ...currentConfig.shutdownPolicy,
        mode: 'advanced',
      },
    };

    const onSave = vi.fn().mockResolvedValue(undefined);
    renderPolicySection(onSave);

    fireEvent.click(screen.getByRole('button', {
      name: /Shutdown if communication is lost while previously on battery/i,
    }));
    fireEvent.change(await screen.findByLabelText('settings.policyValue'), {
      target: { value: '65' },
    });

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });

    const savedPolicy = onSave.mock.calls.at(-1)?.[0] as AppConfig['shutdownPolicy'];
    const communicationRule = savedPolicy.rules.find(
      (rule) => rule.id === DEFAULT_COMMUNICATION_LOSS_RULE_ID,
    );

    expect(communicationRule?.trigger).toEqual({
      all: [
        {
          field: 'state.secondsOnBattery',
          op: 'gte',
          value: 65,
        },
        {
          field: 'connection.secondsSinceLastSuccessfulPoll',
          op: 'gte',
          value: 300,
        },
      ],
    });
  });

  it('renders decision history entries returned from the mocked IPC bridge', async () => {
    mockDecisionLog = [
      {
        id: 'decision-1',
        timestampIso: '2026-05-14T12:00:00.000Z',
        event: 'decision',
        decision: {
          type: 'startShutdownCountdown',
          ruleId: 'default-battery-shutdown',
          countdownSeconds: 45,
          method: 'sleep',
          cancelWhen: null,
        },
        ruleId: 'default-battery-shutdown',
        summary: 'Battery countdown started',
        conditionExplanation: ['PASS Battery rule matched'],
        context: {
          statusTokens: ['OB', 'LB'],
          batteryChargePercent: 19,
          runtimeSeconds: 180,
          connectionState: 'connected',
          secondsSinceLastSuccessfulPoll: 0,
          secondsOnBattery: 120,
        },
      },
    ];

    renderPolicySection();

    expect(await screen.findByText('Battery countdown started')).toBeInTheDocument();
    expect(screen.getByText('decision')).toBeInTheDocument();
    expect(screen.getAllByText(/default-battery-shutdown/).length).toBeGreaterThan(0);
  });

  it('blocks invalid threshold saves at the UI layer with a visible error', async () => {
    render(<SettingsPage />);

    const warningInput = screen.getByLabelText('settings.warningPct');
    fireEvent.change(warningInput, { target: { value: '10' } });
    fireEvent.blur(warningInput);

    expect(mockSettingsUpdate).not.toHaveBeenCalled();
    expect(
      await screen.findByText('Shutdown % must be lower than Warning %.'),
    ).toBeInTheDocument();
  });
});

function renderPolicySection(onSave = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <ShutdownPolicySettingsSection
      config={currentConfig}
      batterySettings={currentConfig.battery}
      fsdSettings={currentConfig.fsd}
      onSave={onSave}
    />,
  );
}