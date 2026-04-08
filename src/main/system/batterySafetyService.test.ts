import { describe, expect, it, vi, beforeEach } from 'vitest';
import { containsFsdToken } from './batterySafetyService';

// Mock Electron's Notification (imported by batterySafetyService)
vi.mock('electron', () => ({
  Notification: class {
    static isSupported() { return false; }
    show() { /* noop */ }
  },
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
