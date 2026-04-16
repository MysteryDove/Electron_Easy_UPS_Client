import { describe, expect, it, vi, beforeEach } from 'vitest';
import { containsFsdToken, containsLbToken, containsObToken } from './batterySafetyService';

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

  it('calls initiateWindowsShutdown directly when overlay is disabled', async () => {
    const { BatterySafetyService } = await import('./batterySafetyService');
    const alert = makeMockCriticalAlert();
    const svc = new BatterySafetyService(
      makeConfig({ overlayEnabled: false }) as never,
      alert as never,
    );

    // We can't easily assert the shutdown exec, but we can verify overlay
    // was NOT shown (the shutdown fires directly instead)
    svc.handleTelemetry({ battery_charge_pct: 80 } as never, 'FSD');
    expect(alert.show).not.toHaveBeenCalled();
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

    // 80→15 crosses both warningPct (40) and shutdownPct (20):
    // first show() for warning overlay, then dismissed and second show() for critical
    expect(mockAlert.show).toHaveBeenCalledTimes(2);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('warning');
    expect(mockAlert.show.mock.calls[1][0].type).toBe('critical');
  });

  it('cancels shutdown countdown when UPS transitions from OB to OL', () => {
    // On battery, battery drops below shutdown threshold
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OB DISCHRG LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(2);

    mockAlert.dismiss.mockClear();

    // Power returns — UPS goes online. Battery is still low (15%).
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OL CHRG');

    // The OB→OL transition should dismiss the overlay (cancel countdown)
    expect(mockAlert.dismiss).toHaveBeenCalled();
  });

  it('still cancels shutdown countdown when an intermediate poll omits ups.status', () => {
    service.handleTelemetry({ battery_charge_pct: 80 } as never, 'OB');
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OB DISCHRG LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(2);

    mockAlert.dismiss.mockClear();

    // A partial read should not clear the remembered OB state.
    service.handleTelemetry({ battery_charge_pct: 15 } as never, undefined);

    // Once status resumes as online, the pending shutdown should be cancelled.
    service.handleTelemetry({ battery_charge_pct: 15 } as never, 'OL CHRG');

    expect(mockAlert.dismiss).toHaveBeenCalledTimes(1);
  });

  it('resets warned/shutdownWarned on OB→OL so warnings re-trigger if power fails again', () => {
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

    // Both warning (shutdownPct <= warningPct) and critical alerts should fire
    expect(mockAlert.show).toHaveBeenCalledTimes(2);
    expect(mockAlert.show.mock.calls[0][0].type).toBe('warning');
    expect(mockAlert.show.mock.calls[1][0].type).toBe('critical');
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
    expect(mockAlert.show).toHaveBeenCalledTimes(2);

    mockAlert.dismiss.mockClear();

    // Power returns
    service.handleTelemetry({} as never, 'OL CHRG');
    expect(mockAlert.dismiss).toHaveBeenCalled();
  });

  it('re-triggers LB warning after OB→OL→OB cycle without battery.charge', () => {
    // First OB LB triggers shutdown
    service.handleTelemetry({} as never, 'OB LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(2);

    // Power returns
    service.handleTelemetry({} as never, 'OL CHRG');
    mockAlert.show.mockClear();

    // Power fails again with LB
    service.handleTelemetry({} as never, 'OB LB');
    expect(mockAlert.show).toHaveBeenCalledTimes(2);
  });

  it('uses shutdownPct as the synthesized battery percent in the alert', () => {
    service.handleTelemetry({} as never, 'OB LB DISCHRG');

    // The critical alert should show shutdownPct as the battery percent
    const criticalCall = mockAlert.show.mock.calls[1][0];
    expect(criticalCall.batteryPct).toBe(20);
  });
});
