import { describe, expect, it, vi, beforeEach } from 'vitest';
import { containsFsdToken, containsLbToken, containsObToken } from './batterySafetyService';
import type { ShutdownPolicyConfig } from '../../shared/shutdownPolicy/types';

// Mock Electron's Notification (imported by batterySafetyService)
vi.mock('electron', () => ({
  Notification: class {
    static isSupported() { return false; }
    show() { /* noop */ }
  },
}));

// Mock child_process to prevent real shutdown/sleep commands
vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd: string, cb?: (err: Error | null) => void) => {
    cb?.(null);
  }),
}));

// Mock i18nService
vi.mock('./i18nService', () => ({
  t: (key: string) => key,
}));

describe('containsFsdToken', () => {
  it('returns true for bare FSD token (uppercase)', () => {
    expect(containsFsdToken('FSD')).toBe(true);
  });

  it('returns true for lowercase fsd', () => {
    expect(containsFsdToken('fsd')).toBe(true);
  });

  it('returns true for mixed-case Fsd', () => {
    expect(containsFsdToken('Fsd')).toBe(true);
  });

  it('returns true when FSD is one of several tokens', () => {
    expect(containsFsdToken('OB FSD LB')).toBe(true);
  });

  it('returns true for FSD with extra whitespace', () => {
    expect(containsFsdToken('  OB   FSD  ')).toBe(true);
  });

  it('returns false for online status without FSD', () => {
    expect(containsFsdToken('OL')).toBe(false);
  });

  it('returns false for on-battery status without FSD', () => {
    expect(containsFsdToken('OB LB DISCHRG')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsFsdToken('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(containsFsdToken(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(containsFsdToken(null)).toBe(false);
  });

  it('does not match FSD as substring of another token', () => {
    expect(containsFsdToken('NOFSD')).toBe(false);
  });
});

describe('containsObToken', () => {
  it('returns true for bare OB token', () => {
    expect(containsObToken('OB')).toBe(true);
  });

  it('returns true when OB is one of several tokens', () => {
    expect(containsObToken('OB DISCHRG LB')).toBe(true);
  });

  it('returns true for lowercase ob', () => {
    expect(containsObToken('ob dischrg')).toBe(true);
  });

  it('returns false for OL status', () => {
    expect(containsObToken('OL')).toBe(false);
  });

  it('returns false for OL CHRG', () => {
    expect(containsObToken('OL CHRG')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsObToken('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(containsObToken(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(containsObToken(null)).toBe(false);
  });

  it('does not match OB as substring of another token', () => {
    expect(containsObToken('KNOB')).toBe(false);
  });
});

describe('containsLbToken', () => {
  it('returns true for bare LB token', () => {
    expect(containsLbToken('LB')).toBe(true);
  });

  it('returns true when LB is one of several tokens', () => {
    expect(containsLbToken('OB DISCHRG LB')).toBe(true);
  });

  it('returns true for lowercase lb', () => {
    expect(containsLbToken('ob lb dischrg')).toBe(true);
  });

  it('returns false for OL status', () => {
    expect(containsLbToken('OL')).toBe(false);
  });

  it('returns false for OB without LB', () => {
    expect(containsLbToken('OB DISCHRG')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsLbToken('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(containsLbToken(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(containsLbToken(null)).toBe(false);
  });

  it('does not match LB as substring of another token', () => {
    expect(containsLbToken('BULB')).toBe(false);
  });
});

// ── FSD irrevocable shutdown integration tests ─────────────────────

describe('BatterySafetyService — FSD shutdown is irrevocable', () => {
  // Minimal AppConfig subset sufficient for the tests
  function makeConfig(fsdOverrides: Record<string, unknown> = {}) {
    return {
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: false,
        shutdownEnabled: false,
        criticalAlertEnabled: false,
        criticalShutdownAlertEnabled: false,
        shutdownCountdownSeconds: 45,
        shutdownMethod: 'sleep' as const,
      },
      fsd: {
        shutdownEnabled: true,
        shutdownDelaySeconds: 10,
        shutdownMethod: 'shutdown' as const,
        overlayEnabled: true,
        ...fsdOverrides,
      },
      // Stubs for fields the constructor doesn't inspect
      nut: {} as never,
      polling: {} as never,
      data: {} as never,
      debug: { level: 'off' } as never,
      startup: {} as never,
      theme: {} as never,
      i18n: {} as never,
      dashboard: {} as never,
      wizard: {} as never,
      line: {} as never,
    };
  }

  function makeFsdCountdownPolicy(): ShutdownPolicyConfig {
    return {
      version: 1,
      mode: 'advanced',
      safety: {
        requireHoldForShutdownSeconds: 0,
        maxCountdownSeconds: 300,
        allowImmediateShutdown: false,
        allowFsdAutoCancel: false,
      },
      rules: [
        {
          id: 'default-fsd-shutdown',
          name: 'FSD policy countdown',
          enabled: true,
          priority: 1000,
          severity: 'forced',
          trigger: { field: 'ups.fsd', op: 'eq', value: true },
          action: {
            type: 'startShutdownCountdown',
            countdownSeconds: 12,
            method: 'shutdown',
          },
          cancelWhen: null,
          createdBy: 'user',
        },
      ],
    };
  }

  function makeMockCriticalAlert() {
    return {
      show: vi.fn(),
      dismiss: vi.fn(),
      isShowing: false,
    };
  }

  let service: InstanceType<typeof import('./batterySafetyService').BatterySafetyService>;
  let mockAlert: ReturnType<typeof makeMockCriticalAlert>;

  beforeEach(async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    mockAlert = makeMockCriticalAlert();
    service = new BatterySafetyService(makeConfig() as never, mockAlert as never);
  });

  it('shows FSD overlay on first FSD detection', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL FSD');

    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('critical');
  });

  it('shows FSD overlay even when battery percent is missing', () => {
    service.handleTelemetry({} as never, 'OL FSD');

    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('critical');
    expect(mockAlert.show.mock.calls[0][0].batteryPct).toBe(20);
  });

  it('does NOT dismiss the FSD overlay when subsequent telemetry lacks FSD', () => {
    // FSD detected
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL FSD');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Next poll returns non-FSD status (NUT master shutting down)
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    expect(mockAlert.dismiss).not.toHaveBeenCalled();
  });

  it('does NOT dismiss FSD overlay when battery recovers above warning threshold', () => {
    // FSD detected at 30%
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OB FSD LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Battery "recovers" to 80% (e.g. stale reading) — must not dismiss FSD
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    expect(mockAlert.dismiss).not.toHaveBeenCalled();
  });

  it('does NOT show FSD overlay twice for repeated FSD telemetry', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL FSD');
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB FSD LB');
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'FSD');

    // Only the first FSD detection triggers the overlay
    expect(mockAlert.show).toHaveBeenCalledTimes(1);
  });

  it('executes generated FSD shutdownNow without showing an overlay', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig({ overlayEnabled: false }) as never,
      alert as never,
    );

    // The migrated policy uses shutdownNow for this legacy setting.
    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'FSD');
    expect(alert.show).not.toHaveBeenCalled();
  });

  it('honors a policy FSD countdown even when the legacy overlay flag is disabled', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      {
        ...makeConfig({ overlayEnabled: false }),
        shutdownPolicy: makeFsdCountdownPolicy(),
      } as never,
      alert as never,
    );

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'FSD');

    expect(alert.show).toHaveBeenCalledTimes(1);
    expect(alert.show.mock.calls[0][0].showShutdown).toBe(true);
    expect(alert.show.mock.calls[0][0].shutdownCountdownSeconds).toBe(12);
  });

  it('user dismiss resets FSD state, allowing re-trigger on next FSD', () => {
    // FSD detected — overlay shown
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL FSD');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    // Capture the onDismissed callback (3rd argument to show())
    const onDismissed = mockAlert.show.mock.calls[0][2] as () => void;
    expect(onDismissed).toBeTypeOf('function');

    // User clicks Dismiss/Ignore — simulate the callback
    onDismissed();

    // FSD state should be fully reset
    const internals = service as unknown as {
      fsdActive: boolean;
      fsdShutdownCommitted: boolean;
    };
    expect(internals.fsdActive).toBe(false);
    expect(internals.fsdShutdownCommitted).toBe(false);

    // A subsequent FSD signal should trigger a new overlay
    mockAlert.show.mockClear();
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB FSD');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);
  });
});

// ── OB/OL gating tests ────────────────────────────────────────────

describe('BatterySafetyService — OB/OL gating', () => {
  function makeConfig(batteryOverrides: Record<string, unknown> = {}) {
    return {
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: true,
        shutdownEnabled: true,
        criticalAlertEnabled: true,
        criticalShutdownAlertEnabled: true,
        shutdownCountdownSeconds: 45,
        shutdownMethod: 'sleep' as const,
        ...batteryOverrides,
      },
      fsd: {
        shutdownEnabled: false,
        shutdownDelaySeconds: 10,
        shutdownMethod: 'shutdown' as const,
        overlayEnabled: true,
      },
      nut: {} as never,
      polling: {} as never,
      data: {} as never,
      debug: { level: 'off' } as never,
      startup: {} as never,
      theme: {} as never,
      i18n: {} as never,
      dashboard: {} as never,
      wizard: {} as never,
      line: {} as never,
    };
  }

  function makeMockCriticalAlert() {
    return {
      show: vi.fn(),
      dismiss: vi.fn(),
      isShowing: false,
    };
  }

  let service: InstanceType<typeof import('./batterySafetyService').BatterySafetyService>;
  let mockAlert: ReturnType<typeof makeMockCriticalAlert>;

  beforeEach(async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    mockAlert = makeMockCriticalAlert();
    service = new BatterySafetyService(makeConfig() as never, mockAlert as never);
  });

  it('does NOT trigger warning when battery is low but UPS is online (OL)', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OL');

    expect(mockAlert.show).not.toHaveBeenCalled();
  });

  it('does NOT trigger shutdown when battery is low but UPS is online (OL CHRG)', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OL CHRG');

    expect(mockAlert.show).not.toHaveBeenCalled();
  });

  it('triggers warning when battery is low and UPS is on battery (OB)', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OB DISCHRG');

    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('warning');
  });

  it('triggers shutdown alert when battery crosses below shutdownPct on OB', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OB DISCHRG LB');

    // The engine emits the highest-priority matching rule only.
    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('critical');
    expect(mockAlert.show.mock.calls[0][0].shutdownCountdownSeconds).toBe(45);
  });

  it('cancels shutdown countdown when UPS transitions from OB to OL', () => {
    // On battery, battery drops below shutdown threshold
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OB DISCHRG LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Power returns — UPS goes online. Battery is still low (15%).
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OL CHRG');

    // The OB→OL transition should dismiss the overlay (cancel countdown)
    expect(mockAlert.dismiss).toHaveBeenCalled();
  });

  it('still cancels shutdown countdown when an intermediate poll omits ups.status', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OB DISCHRG LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // A partial read should not clear the remembered OB state.
    service.handleTelemetry({ battery_charge_pct: 15 } as never, undefined);

    // Once status resumes as online, the pending shutdown should be cancelled.
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OL CHRG');

    expect(mockAlert.dismiss).toHaveBeenCalledTimes(1);
  });

  it('re-arms policy alerts on OB→OL so warnings re-trigger if power fails again', () => {
    // On battery → warning triggered
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OB DISCHRG');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    // Power returns
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OL CHRG');
    mockAlert.show.mockClear();

    // Power fails again — warning should re-trigger at the still-low level
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OB DISCHRG');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);
  });

  it('does NOT cancel FSD overlay on OB→OL transition', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService({
      ...makeConfig(),
      fsd: {
        shutdownEnabled: true,
        shutdownDelaySeconds: 10,
        shutdownMethod: 'shutdown' as const,
        overlayEnabled: true,
      },
    } as never, alert as never);

    // FSD detected on battery
    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB FSD');
    expect(alert.show).toHaveBeenCalledTimes(1);

    alert.dismiss.mockClear();

    // UPS goes online — FSD overlay must persist (fsdShutdownCommitted)
    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    expect(alert.dismiss).not.toHaveBeenCalled();
  });

  it('does NOT trigger warning on first poll with low battery when OL', () => {
    // First-ever poll: battery is low but UPS is online
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OL CHRG');

    expect(mockAlert.show).not.toHaveBeenCalled();
  });
});

// ── LB fallback when battery.charge is unavailable ──────────────────

describe('BatterySafetyService — policy-driven action application', () => {
  function makeConfig(shutdownPolicy: unknown) {
    return {
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: false,
        shutdownEnabled: false,
        criticalAlertEnabled: false,
        criticalShutdownAlertEnabled: false,
        shutdownCountdownSeconds: 45,
        shutdownMethod: 'sleep' as const,
      },
      fsd: {
        shutdownEnabled: false,
        shutdownDelaySeconds: 10,
        shutdownMethod: 'shutdown' as const,
        overlayEnabled: true,
      },
      shutdownPolicy,
      nut: {} as never,
      polling: {} as never,
      data: {} as never,
      debug: { level: 'off' } as never,
      startup: {} as never,
      theme: {} as never,
      i18n: {} as never,
      dashboard: {} as never,
      wizard: {} as never,
      line: {} as never,
    };
  }

  function makePolicy(rule: Record<string, unknown>) {
    return {
      version: 1,
      mode: 'advanced',
      safety: {
        requireHoldForShutdownSeconds: 0,
        maxCountdownSeconds: 300,
        allowImmediateShutdown: true,
        allowFsdAutoCancel: false,
      },
      rules: [
        {
          id: 'advanced-rule',
          name: 'Advanced rule',
          enabled: true,
          priority: 100,
          severity: 'critical',
          trigger: { field: 'ups.onBattery', op: 'eq', value: true },
          createdBy: 'user',
          ...rule,
        },
      ],
    };
  }

  function makeMockCriticalAlert() {
    return {
      show: vi.fn(),
      dismiss: vi.fn(),
      isShowing: false,
    };
  }

  it('starts an advanced countdown even when legacy battery shutdown is disabled', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig(makePolicy({
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 30,
          method: 'shutdown',
        },
        cancelWhen: null,
      })) as never,
      alert as never,
    );

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');

    expect(alert.show).toHaveBeenCalledTimes(1);
    expect(alert.show.mock.calls[0][0].showShutdown).toBe(true);
    expect(alert.show.mock.calls[0][0].shutdownCountdownSeconds).toBe(30);
  });

  it('records cancellation when a policy countdown is cancelled by power restoration', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig(makePolicy({
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 30,
          method: 'shutdown',
        },
        cancelWhen: {
          all: [
            { field: 'ups.online', op: 'eq', value: true },
            { field: 'ups.fsd', op: 'eq', value: false },
          ],
        },
      })) as never,
      alert as never,
    );

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    await flushAsyncShutdownWork();

    const log = svc.getDecisionLog();
    expect(log.some((entry) =>
      entry.event === 'decision' &&
      entry.decision.type === 'startShutdownCountdown' &&
      entry.ruleId === 'advanced-rule',
    )).toBe(true);
    expect(log.some((entry) =>
      entry.event === 'cancellation' &&
      entry.decision.type === 'cancelShutdownCountdown' &&
      entry.ruleId === 'advanced-rule',
    )).toBe(true);
    expect(alert.dismiss).toHaveBeenCalled();
  });

  it('applies runtime remaining shutdown only while UPS is on battery', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig(makePolicy({
        trigger: {
          all: [
            { field: 'ups.onBattery', op: 'eq', value: true },
            { field: 'battery.runtimeSeconds', op: 'lte', value: 300 },
          ],
        },
        action: {
          type: 'startShutdownCountdown',
          countdownSeconds: 30,
          method: 'shutdown',
        },
        cancelWhen: {
          all: [
            { field: 'ups.online', op: 'eq', value: true },
            { field: 'ups.fsd', op: 'eq', value: false },
          ],
        },
      })) as never,
      alert as never,
    );

    svc.handleTelemetry({
      battery_charge_pct: 80,
      battery_runtime_sec: 120,
    } as never, 'OL');
    expect(alert.show).not.toHaveBeenCalled();

    svc.handleTelemetry({
      battery_charge_pct: 80,
      battery_runtime_sec: 120,
    } as never, 'OB');

    expect(alert.show).toHaveBeenCalledTimes(1);
    expect(alert.show.mock.calls[0][0].showShutdown).toBe(true);
    expect(alert.show.mock.calls[0][0].shutdownCountdownSeconds).toBe(30);
  });

  it('does not add a shutdown callback to alert-only policy actions', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig(makePolicy({
        action: { type: 'showCriticalAlert' },
      })) as never,
      alert as never,
    );

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');

    expect(alert.show).toHaveBeenCalledTimes(1);
    expect(alert.show.mock.calls[0][0].showShutdown).toBe(false);
    expect(alert.show.mock.calls[0][1]).toBeUndefined();
  });

  it('re-arms custom alert-only rules after their policy trigger clears', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig(makePolicy({
        action: { type: 'showCriticalAlert' },
      })) as never,
      alert as never,
    );

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    expect(alert.show).toHaveBeenCalledTimes(1);

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    alert.show.mockClear();

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    expect(alert.show).toHaveBeenCalledTimes(1);
  });

  it('executes shutdownNow without marking an active countdown', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig(makePolicy({
        action: {
          type: 'shutdownNow',
          method: 'shutdown',
        },
      })) as never,
      alert as never,
    );

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');

    expect(alert.show).not.toHaveBeenCalled();
    expect((svc as unknown as { activeCountdownRuleId: string | null })
      .activeCountdownRuleId).toBeNull();
  });

  it('records shutdownNow execution results in the policy decision log', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig(makePolicy({
        action: {
          type: 'shutdownNow',
          method: 'shutdown',
        },
      })) as never,
      alert as never,
    );

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    await flushAsyncShutdownWork();

    const executionEntry = svc.getDecisionLog().find((entry) =>
      entry.event === 'execution' || entry.event === 'failure',
    );
    expect(executionEntry?.decision.type).toBe('shutdownNow');
    expect(executionEntry?.ruleId).toBe('advanced-rule');
    expect(executionEntry?.execution?.method).toBe('shutdown');
    expect(executionEntry?.execution?.supported).toBe(process.platform === 'win32');
  });
});

describe('BatterySafetyService — LB fallback without battery.charge', () => {
  function makeConfig(batteryOverrides: Record<string, unknown> = {}) {
    return {
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: true,
        shutdownEnabled: true,
        criticalAlertEnabled: true,
        criticalShutdownAlertEnabled: true,
        shutdownCountdownSeconds: 45,
        shutdownMethod: 'sleep' as const,
        ...batteryOverrides,
      },
      fsd: {
        shutdownEnabled: false,
        shutdownDelaySeconds: 10,
        shutdownMethod: 'shutdown' as const,
        overlayEnabled: true,
      },
      nut: {} as never,
      polling: {} as never,
      data: {} as never,
      debug: { level: 'off' } as never,
      startup: {} as never,
      theme: {} as never,
      i18n: {} as never,
      dashboard: {} as never,
      wizard: {} as never,
      line: {} as never,
    };
  }

  function makeMockCriticalAlert() {
    return {
      show: vi.fn(),
      dismiss: vi.fn(),
      isShowing: false,
    };
  }

  let service: InstanceType<typeof import('./batterySafetyService').BatterySafetyService>;
  let mockAlert: ReturnType<typeof makeMockCriticalAlert>;

  beforeEach(async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    mockAlert = makeMockCriticalAlert();
    service = new BatterySafetyService(makeConfig() as never, mockAlert as never);
  });

  it('triggers shutdown when OB LB is reported without battery.charge', () => {
    service.handleTelemetry({} as never, 'OB LB DISCHRG');

    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('critical');
    expect(mockAlert.show.mock.calls[0][0].shutdownCountdownSeconds).toBe(45);
  });

  it('does NOT trigger on OB alone without battery.charge (no LB)', () => {
    service.handleTelemetry({} as never, 'OB DISCHRG');

    expect(mockAlert.show).not.toHaveBeenCalled();
  });

  it('does NOT trigger on OL LB without battery.charge (battery charging)', () => {
    service.handleTelemetry({} as never, 'OL LB CHRG');

    expect(mockAlert.show).not.toHaveBeenCalled();
  });

  it('cancels LB-triggered shutdown when UPS transitions to OL', () => {
    service.handleTelemetry({} as never, 'OB LB DISCHRG');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Power returns
    service.handleTelemetry({} as never, 'OL CHRG');
    expect(mockAlert.dismiss).toHaveBeenCalled();
  });

  it('re-triggers LB warning after OB→OL→OB cycle without battery.charge', () => {
    // First OB LB triggers shutdown
    service.handleTelemetry({} as never, 'OB LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    // Power returns
    service.handleTelemetry({} as never, 'OL CHRG');
    mockAlert.show.mockClear();

    // Power fails again with LB
    service.handleTelemetry({} as never, 'OB LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);
  });

  it('uses shutdownPct as the synthesized battery percent in the alert', () => {
    service.handleTelemetry({} as never, 'OB LB DISCHRG');

    // The critical alert should show shutdownPct as the battery percent
    const criticalCall = mockAlert.show.mock.calls[0][0];
    expect(criticalCall.batteryPct).toBe(20);
  });

  it('records applied policy decisions with condition explanations', () => {
    service.handleTelemetry({} as never, 'OB LB DISCHRG');

    const log = service.getDecisionLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].decision.type).toBe('startShutdownCountdown');
    expect(log[0].conditionExplanation?.some((line) =>
      line.includes('ups.onBattery eq matched'),
    )).toBe(true);
    expect(log[0].context.statusTokens).toEqual(['OB', 'LB', 'DISCHRG']);
  });
});

// ── Phase 0 safety hotfix regressions ──────────────────────────────
// Covers:
//   L2-F1 (CRITICAL): user-authored cancelShutdownCountdown rules must not be
//     able to defeat an active FSD shutdown through cancelPolicyCountdown.
//   L2-F4 (MAJOR):    handleConfigUpdated must preserve activeCountdownRuleId
//     and the corresponding appliedRuleIds entry when fsdShutdownCommitted.

describe('BatterySafetyService — Phase 0 safety hotfixes', () => {
  function makeConfig(shutdownPolicy?: ShutdownPolicyConfig) {
    return {
      battery: {
        warningPct: 40,
        shutdownPct: 20,
        warningToastEnabled: false,
        shutdownEnabled: false,
        criticalAlertEnabled: false,
        criticalShutdownAlertEnabled: false,
        shutdownCountdownSeconds: 45,
        shutdownMethod: 'sleep' as const,
      },
      fsd: {
        shutdownEnabled: true,
        shutdownDelaySeconds: 10,
        shutdownMethod: 'shutdown' as const,
        overlayEnabled: true,
      },
      shutdownPolicy,
      nut: {} as never,
      polling: {} as never,
      data: {} as never,
      debug: { level: 'off' } as never,
      startup: {} as never,
      theme: {} as never,
      i18n: {} as never,
      dashboard: {} as never,
      wizard: {} as never,
      line: {} as never,
    };
  }

  function makeMockCriticalAlert() {
    return {
      show: vi.fn(),
      dismiss: vi.fn(),
      isShowing: false,
    };
  }

  // Advanced policy: default FSD rule PLUS a user-authored cancel rule whose
  // trigger is plain ups.online==true. Pre-fix this rule defeated FSD.
  function makePolicyWithUserCancelRule(): ShutdownPolicyConfig {
    return {
      version: 1,
      mode: 'advanced',
      safety: {
        requireHoldForShutdownSeconds: 0,
        maxCountdownSeconds: 300,
        allowImmediateShutdown: false,
        // allowFsdAutoCancel intentionally false — this is the scenario the
        // L2-F1 service-level guard must protect against, separately from the
        // schema-level rejection.
        allowFsdAutoCancel: false,
      },
      rules: [
        {
          id: 'default-fsd-shutdown',
          name: 'FSD shutdown',
          enabled: true,
          priority: 1000,
          severity: 'forced',
          trigger: { field: 'ups.fsd', op: 'eq', value: true },
          action: {
            type: 'startShutdownCountdown',
            countdownSeconds: 12,
            method: 'shutdown',
          },
          cancelWhen: null,
          createdBy: 'system',
        },
        {
          id: 'user-cancel-on-online',
          name: 'Cancel on online (user)',
          enabled: true,
          priority: 500,
          severity: 'info',
          trigger: { field: 'ups.online', op: 'eq', value: true },
          action: { type: 'cancelShutdownCountdown' },
          // createdBy: 'system' so the schema does not reject this rule
          // independently. The runtime service-level guard is what we exercise.
          createdBy: 'system',
        },
      ],
    };
  }

  it('does not let a user cancelShutdownCountdown decision defeat an active FSD shutdown', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const service = new BatterySafetyService(
      makeConfig(makePolicyWithUserCancelRule()) as never,
      alert as never,
    );

    // FSD detected on battery — FSD overlay shows, fsdShutdownCommitted set.
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB FSD');
    expect(alert.show).toHaveBeenCalledTimes(1);
    const initialLogLength = service.getDecisionLog().length;

    // Clear so we can observe whether any *additional* dismiss happens.
    alert.dismiss.mockClear();

    // Next poll: UPS reports OL. The user cancel rule's trigger now matches,
    // so the engine emits cancelShutdownCountdown for 'user-cancel-on-online'.
    // The service-level FSD guard MUST suppress it.
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');

    // Observable signals that the cancel decision was suppressed:
    // 1) No additional dismiss on the critical alert.
    expect(alert.dismiss).not.toHaveBeenCalled();
    // 2) No new 'cancellation' event in the decision log.
    const newCancellations = service
      .getDecisionLog()
      .slice(0, service.getDecisionLog().length - initialLogLength)
      .filter((entry) => entry.event === 'cancellation');
    expect(newCancellations).toHaveLength(0);
  });

  it('preserves activeCountdownRuleId and appliedRuleIds for FSD across handleConfigUpdated', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const service = new BatterySafetyService(makeConfig() as never, alert as never);

    // Start FSD — fsdShutdownCommitted=true and activeCountdownRuleId set.
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL FSD');
    expect(alert.show).toHaveBeenCalledTimes(1);
    alert.dismiss.mockClear();

    // Apply a config update that swaps the policy. Pre-fix this would wipe
    // activeCountdownRuleId and appliedRuleIds, leaving the overlay visible
    // but the engine/service decoupled — widening the L2-F1 attack surface.
    service.handleConfigUpdated(makeConfig() as never);

    // The overlay must NOT have been dismissed because FSD is still committed.
    expect(alert.dismiss).not.toHaveBeenCalled();

    // After a subsequent OL telemetry tick (no FSD), the service must still
    // treat FSD as committed — meaning the overlay survives and the engine's
    // cancel paths remain suppressed. Without the L2-F4 fix, activeCountdownRuleId
    // had been cleared by handleConfigUpdated and applyDecision could fire a
    // cancellation again.
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    expect(alert.dismiss).not.toHaveBeenCalled();
  });
});

async function flushAsyncShutdownWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
