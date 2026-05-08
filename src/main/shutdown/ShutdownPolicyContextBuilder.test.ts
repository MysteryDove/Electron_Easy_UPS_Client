import { describe, expect, it } from 'vitest';
import {
  parseUpsStatusTokens,
  ShutdownPolicyContextBuilder,
} from './ShutdownPolicyContextBuilder';

describe('ShutdownPolicyContextBuilder', () => {
  it('parses status tokens case-insensitively and removes duplicates', () => {
    expect(parseUpsStatusTokens(' ob   lb OB fsd ')).toEqual([
      'OB',
      'LB',
      'FSD',
    ]);
  });

  it('normalizes raw telemetry and status into policy context', () => {
    const builder = new ShutdownPolicyContextBuilder();
    const context = builder.build({
      rawUpsStatus: 'OB DISCHRG LB',
      values: {
        battery_charge_pct: 19.6,
        battery_runtime_sec: 123.9,
        battery_voltage: 12.4,
      },
      now: 1000,
    });

    expect(context.ups.onBattery).toBe(true);
    expect(context.ups.lowBattery).toBe(true);
    expect(context.battery.chargePercent).toBe(20);
    expect(context.battery.runtimeSeconds).toBe(123);
    expect(context.battery.voltage).toBe(12.4);
    expect(context.connection.state).toBe('connected');
  });

  it('preserves the last known on-battery state during the stale-status grace period', () => {
    const builder = new ShutdownPolicyContextBuilder({
      statusStaleGraceSeconds: 5,
    });

    builder.build({ rawUpsStatus: 'OB DISCHRG', now: 0 });
    const context = builder.build({ rawUpsStatus: undefined, now: 4000 });

    expect(context.ups.onBattery).toBe(true);
    expect(context.connection.state).toBe('connected');
  });

  it('downgrades connected state after status is stale beyond the grace period', () => {
    const builder = new ShutdownPolicyContextBuilder({
      statusStaleGraceSeconds: 5,
    });

    builder.build({ rawUpsStatus: 'OB DISCHRG', now: 0 });
    const context = builder.build({ rawUpsStatus: undefined, now: 7000 });

    expect(context.ups.onBattery).toBe(false);
    expect(context.connection.state).toBe('degraded');
  });

  it('tracks duration transitions from OB to OL', () => {
    const builder = new ShutdownPolicyContextBuilder();

    builder.build({ rawUpsStatus: 'OB', now: 0 });
    const onBattery = builder.build({ rawUpsStatus: 'OB DISCHRG', now: 5000 });
    const online = builder.build({ rawUpsStatus: 'OL CHRG', now: 8000 });

    expect(onBattery.state.secondsOnBattery).toBe(5);
    expect(online.ups.online).toBe(true);
    expect(online.state.secondsOnBattery).toBe(0);
    expect(online.state.secondsOnline).toBe(3);
  });

  it('detects FSD and tracks seconds in FSD', () => {
    const builder = new ShutdownPolicyContextBuilder();

    builder.build({ rawUpsStatus: 'OL FSD', now: 0 });
    const context = builder.build({ rawUpsStatus: 'OL FSD', now: 3000 });

    expect(context.ups.fsd).toBe(true);
    expect(context.state.secondsInFsd).toBe(3);
  });

  it('computes seconds since last successful poll', () => {
    const builder = new ShutdownPolicyContextBuilder();

    builder.build({ rawUpsStatus: 'OL', now: 1000, pollSucceeded: true });
    const context = builder.build({
      rawUpsStatus: undefined,
      connectionState: 'disconnected',
      pollSucceeded: false,
      now: 6000,
    });

    expect(context.connection.state).toBe('disconnected');
    expect(context.connection.secondsSinceLastSuccessfulPoll).toBe(5);
  });

  it('keeps previously-on-battery duration advancing during communication loss', () => {
    const builder = new ShutdownPolicyContextBuilder({
      statusStaleGraceSeconds: 5,
    });

    builder.build({ rawUpsStatus: 'OB', now: 0, pollSucceeded: true });
    builder.build({ rawUpsStatus: 'OB', now: 60000, pollSucceeded: true });
    const context = builder.build({
      connectionState: 'reconnecting',
      pollSucceeded: false,
      now: 370000,
    });

    expect(context.ups.onBattery).toBe(false);
    expect(context.connection.state).toBe('degraded');
    expect(context.connection.secondsSinceLastSuccessfulPoll).toBe(310);
    expect(context.state.secondsOnBattery).toBe(370);
  });
});
