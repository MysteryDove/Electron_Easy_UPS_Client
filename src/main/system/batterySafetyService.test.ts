import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUpsStatusTokens } from '../shutdown/ShutdownPolicyContextBuilder';
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

const DEFAULT_TEST_TIME_MS = Date.parse('2026-05-14T00:00:00.000Z');

function installTestClock(): (seconds: number) => void {
  let nowMs = DEFAULT_TEST_TIME_MS;
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);

  return (seconds: number) => {
    nowMs += seconds * 1000;
    vi.setSystemTime(nowMs);
  };
}

describe('parseUpsStatusTokens — FSD detection', () => {
  it('returns true for bare FSD token (uppercase)', () => {
    expect(parseUpsStatusTokens('FSD').includes('FSD')).toBe(true);
  });

  it('returns true for lowercase fsd', () => {
    expect(parseUpsStatusTokens('fsd').includes('FSD')).toBe(true);
  });

  it('returns true for mixed-case Fsd', () => {
    expect(parseUpsStatusTokens('Fsd').includes('FSD')).toBe(true);
  });

  it('returns true when FSD is one of several tokens', () => {
    expect(parseUpsStatusTokens('OB FSD LB').includes('FSD')).toBe(true);
  });

  it('returns true for FSD with extra whitespace', () => {
    expect(parseUpsStatusTokens('  OB   FSD  ').includes('FSD')).toBe(true);
  });

  it('returns false for online status without FSD', () => {
    expect(parseUpsStatusTokens('OL').includes('FSD')).toBe(false);
  });

  it('returns false for on-battery status without FSD', () => {
    expect(parseUpsStatusTokens('OB LB DISCHRG').includes('FSD')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(parseUpsStatusTokens('').includes('FSD')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(parseUpsStatusTokens(undefined).includes('FSD')).toBe(false);
  });

  it('returns false for null', () => {
    expect(parseUpsStatusTokens(null).includes('FSD')).toBe(false);
  });

  it('does not match FSD as substring of another token', () => {
    expect(parseUpsStatusTokens('NOFSD').includes('FSD')).toBe(false);
  });
});

describe('parseUpsStatusTokens — OB detection', () => {
  it('returns true for bare OB token', () => {
    expect(parseUpsStatusTokens('OB').includes('OB')).toBe(true);
  });

  it('returns true when OB is one of several tokens', () => {
    expect(parseUpsStatusTokens('OB DISCHRG LB').includes('OB')).toBe(true);
  });

  it('returns true for lowercase ob', () => {
    expect(parseUpsStatusTokens('ob dischrg').includes('OB')).toBe(true);
  });

  it('returns false for OL status', () => {
    expect(parseUpsStatusTokens('OL').includes('OB')).toBe(false);
  });

  it('returns false for OL CHRG', () => {
    expect(parseUpsStatusTokens('OL CHRG').includes('OB')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(parseUpsStatusTokens('').includes('OB')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(parseUpsStatusTokens(undefined).includes('OB')).toBe(false);
  });

  it('returns false for null', () => {
    expect(parseUpsStatusTokens(null).includes('OB')).toBe(false);
  });

  it('does not match OB as substring of another token', () => {
    expect(parseUpsStatusTokens('KNOB').includes('OB')).toBe(false);
  });
});

describe('parseUpsStatusTokens — LB detection', () => {
  it('returns true for bare LB token', () => {
    expect(parseUpsStatusTokens('LB').includes('LB')).toBe(true);
  });

  it('returns true when LB is one of several tokens', () => {
    expect(parseUpsStatusTokens('OB DISCHRG LB').includes('LB')).toBe(true);
  });

  it('returns true for lowercase lb', () => {
    expect(parseUpsStatusTokens('ob lb dischrg').includes('LB')).toBe(true);
  });

  it('returns false for OL status', () => {
    expect(parseUpsStatusTokens('OL').includes('LB')).toBe(false);
  });

  it('returns false for OB without LB', () => {
    expect(parseUpsStatusTokens('OB DISCHRG').includes('LB')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(parseUpsStatusTokens('').includes('LB')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(parseUpsStatusTokens(undefined).includes('LB')).toBe(false);
  });

  it('returns false for null', () => {
    expect(parseUpsStatusTokens(null).includes('LB')).toBe(false);
  });

  it('does not match LB as substring of another token', () => {
    expect(parseUpsStatusTokens('BULB').includes('LB')).toBe(false);
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
  let advanceClock: (seconds: number) => void;

  beforeEach(async () => {
    advanceClock = installTestClock();
    const { BatterySafetyService } = await import('./batterySafetyService');
    mockAlert = makeMockCriticalAlert();
    service = new BatterySafetyService(makeConfig() as never, mockAlert as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function triggerDefaultFsd(status = 'OL FSD', telemetry: Record<string, unknown> = { battery_charge_pct: 80 }) {
    service.handleTelemetry(telemetry as never, status);
    advanceClock(3);
    service.handleTelemetry(telemetry as never, status);
  }

  it('shows FSD overlay on first FSD detection', () => {
    triggerDefaultFsd();

    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('critical');
  });

  it('shows FSD overlay even when battery percent is missing', () => {
    triggerDefaultFsd('OL FSD', {});

    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('critical');
    expect(mockAlert.show.mock.calls[0][0].batteryPct).toBe(20);
  });

  it('does NOT dismiss the FSD overlay when subsequent telemetry lacks FSD', () => {
    // FSD detected
    triggerDefaultFsd();
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Next poll returns non-FSD status (NUT master shutting down)
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    expect(mockAlert.dismiss).not.toHaveBeenCalled();
  });

  it('does NOT dismiss FSD overlay when battery recovers above warning threshold', () => {
    // FSD detected at 30%
    triggerDefaultFsd('OB FSD LB', { battery_charge_pct: 30 });
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Battery "recovers" to 80% (e.g. stale reading) — must not dismiss FSD
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
    expect(mockAlert.dismiss).not.toHaveBeenCalled();
  });

  it('does NOT show FSD overlay twice for repeated FSD telemetry', () => {
    triggerDefaultFsd('OL FSD');
    advanceClock(1);
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB FSD LB');
    advanceClock(1);
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
    triggerDefaultFsd();
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
    triggerDefaultFsd('OB FSD');
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
  let advanceClock: (seconds: number) => void;

  beforeEach(async () => {
    advanceClock = installTestClock();
    const { BatterySafetyService } = await import('./batterySafetyService');
    mockAlert = makeMockCriticalAlert();
    service = new BatterySafetyService(makeConfig() as never, mockAlert as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function triggerDefaultWarning(charge = 30, status = 'OB DISCHRG') {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: charge } as never, status);
    advanceClock(5);
    service.handleTelemetry({ battery_charge_pct: charge } as never, status);
  }

  function triggerDefaultShutdown(charge = 15, status = 'OB DISCHRG LB') {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: charge } as never, status);
    advanceClock(10);
    service.handleTelemetry({ battery_charge_pct: charge } as never, status);
  }

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
    triggerDefaultWarning();

    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('warning');
  });

  it('triggers shutdown alert when battery crosses below shutdownPct on OB', () => {
    triggerDefaultShutdown();

    // The engine emits the highest-priority matching rule only.
    expect(mockAlert.show).toHaveBeenCalledTimes(1);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('critical');
    expect(mockAlert.show.mock.calls[0][0].shutdownCountdownSeconds).toBe(45);
  });

  it('cancels shutdown countdown when UPS transitions from OB to OL', () => {
    // On battery, battery drops below shutdown threshold
    triggerDefaultShutdown();
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Power returns — UPS goes online. Battery is still low (15%).
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OL CHRG');

    // The OB→OL transition should dismiss the overlay (cancel countdown)
    expect(mockAlert.dismiss).toHaveBeenCalled();
  });

  it('still cancels shutdown countdown when an intermediate poll omits ups.status', () => {
    triggerDefaultShutdown();
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
    triggerDefaultWarning();
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    // Power returns
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OL CHRG');
    mockAlert.show.mockClear();

    // Power fails again — warning should re-trigger at the still-low level
    service.handleTelemetry({ battery_charge_pct: 30 } as never, 'OB DISCHRG');
    advanceClock(5);
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
    advanceClock(3);
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

  it('releases a failed shutdown command so the same rule can re-fire on the next telemetry tick', async () => {
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
    const execute = vi.fn().mockRejectedValue(new Error('fake failure'));
    (svc as unknown as {
      shutdownExecutor: { execute: typeof execute };
    }).shutdownExecutor.execute = execute;

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    const onCountdownElapsed = alert.show.mock.calls[0][1] as (() => void) | undefined;

    expect(onCountdownElapsed).toBeTypeOf('function');

    onCountdownElapsed?.();
    await flushAsyncShutdownWork();

    const internals = svc as unknown as {
      activeCountdownRuleId: string | null;
      appliedRuleIds: Set<string>;
    };
    expect(internals.activeCountdownRuleId).toBeNull();
    expect(internals.appliedRuleIds.has('advanced-rule')).toBe(false);
    expect(svc.getDecisionLog().some((entry) =>
      entry.event === 'failure' &&
      entry.ruleId === 'advanced-rule' &&
      entry.execution?.errorMessage === 'fake failure',
    )).toBe(true);

    alert.show.mockClear();

    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');

    expect(alert.show).toHaveBeenCalledTimes(1);
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
  let advanceClock: (seconds: number) => void;

  beforeEach(async () => {
    advanceClock = installTestClock();
    const { BatterySafetyService } = await import('./batterySafetyService');
    mockAlert = makeMockCriticalAlert();
    service = new BatterySafetyService(makeConfig() as never, mockAlert as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function triggerDefaultLbShutdown(status = 'OB LB DISCHRG') {
    service.handleTelemetry({} as never, status);
    advanceClock(10);
    service.handleTelemetry({} as never, status);
  }

  it('triggers shutdown when OB LB is reported without battery.charge', () => {
    triggerDefaultLbShutdown();

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
    triggerDefaultLbShutdown();
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    mockAlert.dismiss.mockClear();

    // Power returns
    service.handleTelemetry({} as never, 'OL CHRG');
    expect(mockAlert.dismiss).toHaveBeenCalled();
  });

  it('re-triggers LB warning after OB→OL→OB cycle without battery.charge', () => {
    // First OB LB triggers shutdown
    triggerDefaultLbShutdown('OB LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);

    // Power returns
    service.handleTelemetry({} as never, 'OL CHRG');
    mockAlert.show.mockClear();

    // Power fails again with LB
    service.handleTelemetry({} as never, 'OB LB');
    advanceClock(10);
    service.handleTelemetry({} as never, 'OB LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(1);
  });

  it('uses shutdownPct as the synthesized battery percent in the alert', () => {
    triggerDefaultLbShutdown();

    // The critical alert should show shutdownPct as the battery percent
    const criticalCall = mockAlert.show.mock.calls[0][0];
    expect(criticalCall.batteryPct).toBe(20);
  });

  it('records applied policy decisions with condition explanations', () => {
    triggerDefaultLbShutdown();

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

  let advanceClock: (seconds: number) => void;

  beforeEach(() => {
    advanceClock = installTestClock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    advanceClock(3);
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

describe('BatterySafetyService — communication-loss timer and failure handling', () => {
  function makeConfig(shutdownPolicy: ShutdownPolicyConfig) {
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

  function makeMockCriticalAlert() {
    return {
      show: vi.fn(),
      dismiss: vi.fn(),
      isShowing: false,
    };
  }

  it('evaluates communication-loss rules on reconnecting timer ticks and clears the timer on stop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T00:00:00.000Z'));

    try {
      const { BatterySafetyService } = await import('./batterySafetyService');
      const alert = makeMockCriticalAlert();
      const service = new BatterySafetyService(
        makeConfig({
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
              id: 'comms-loss-warning',
              name: 'Comms loss warning',
              enabled: true,
              priority: 100,
              severity: 'critical',
              trigger: {
                all: [
                  { field: 'state.secondsOnBattery', op: 'gte', value: 0 },
                  {
                    field: 'connection.secondsSinceLastSuccessfulPoll',
                    op: 'gte',
                    value: 5,
                  },
                ],
              },
              action: { type: 'showCriticalAlert' },
              createdBy: 'user',
            },
          ],
        }) as never,
        alert as never,
      );

      service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
      alert.show.mockClear();

      service.handleConnectionState('reconnecting');
      expect(
        (service as unknown as {
          communicationLossEvaluationTimer: ReturnType<typeof setInterval> | null;
        }).communicationLossEvaluationTimer,
      ).not.toBeNull();

      vi.advanceTimersByTime(5000);

      expect(alert.show).toHaveBeenCalledTimes(1);
      expect(alert.show.mock.calls[0][0].type).toBe('critical');

      service.stop();
      expect(
        (service as unknown as {
          communicationLossEvaluationTimer: ReturnType<typeof setInterval> | null;
        }).communicationLossEvaluationTimer,
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a failure alert when cancelling a pending shutdown command fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { BatterySafetyService } = await import('./batterySafetyService');
      const alert = makeMockCriticalAlert();
      const service = new BatterySafetyService(
        makeConfig({
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
              id: 'countdown-rule',
              name: 'Countdown rule',
              enabled: true,
              priority: 100,
              severity: 'critical',
              trigger: { field: 'ups.onBattery', op: 'eq', value: true },
              action: {
                type: 'startShutdownCountdown',
                countdownSeconds: 30,
                method: 'shutdown',
              },
              cancelWhen: { field: 'ups.online', op: 'eq', value: true },
              createdBy: 'user',
            },
          ],
        }) as never,
        alert as never,
      );

      (
        service as unknown as {
          shutdownExecutor: {
            cancelPending: ReturnType<typeof vi.fn>;
          };
        }
      ).shutdownExecutor.cancelPending = vi.fn().mockResolvedValue({
        method: 'shutdown',
        platform: process.platform,
        supported: true,
        success: false,
        command: 'shutdown.exe /a',
        errorMessage: 'cancel failed',
      });

      service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
      alert.show.mockClear();

      service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OL');
      await flushAsyncShutdownWork();

      expect(alert.show).toHaveBeenCalledTimes(1);
      expect(alert.show.mock.calls[0][0]).toMatchObject({
        type: 'critical',
        title: 'batterySafety.shutdownCommandFailedTitle',
        body: 'batterySafety.shutdownCommandFailedBody',
        showShutdown: false,
      });
      expect(
        service.getDecisionLog().some((entry) =>
          entry.event === 'failure' &&
          entry.decision.type === 'cancelShutdownCountdown' &&
          entry.execution?.command === 'shutdown.exe /a',
        ),
      ).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

async function flushAsyncShutdownWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
