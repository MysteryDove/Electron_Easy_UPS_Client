import { describe, it, expect } from 'vitest';
import {
  parseUpsStatusTokens,
  deriveUpsBannerState,
  DEFAULT_STATUS_STALE_GRACE_SECONDS,
} from './statusModel';

describe('parseUpsStatusTokens', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(parseUpsStatusTokens(null)).toEqual([]);
    expect(parseUpsStatusTokens(undefined)).toEqual([]);
    expect(parseUpsStatusTokens('')).toEqual([]);
    expect(parseUpsStatusTokens('   ')).toEqual([]);
  });

  it('splits whitespace and uppercases tokens', () => {
    expect(parseUpsStatusTokens('OL CHRG')).toEqual(['OL', 'CHRG']);
    expect(parseUpsStatusTokens('ol   chrg')).toEqual(['OL', 'CHRG']);
    expect(parseUpsStatusTokens('  OB   DISCHRG  LB  ')).toEqual(['OB', 'DISCHRG', 'LB']);
  });

  it('deduplicates repeated tokens', () => {
    expect(parseUpsStatusTokens('OB ob OB')).toEqual(['OB']);
    expect(parseUpsStatusTokens('OL CHRG OL')).toEqual(['OL', 'CHRG']);
  });
});

describe('deriveUpsBannerState — connection-state overrides', () => {
  it('driverIssue overrides everything else', () => {
    const out = deriveUpsBannerState({
      tokens: ['OL'],
      connection: 'ready',
      driverIssue: { code: 'X', summary: 'boom' },
    });
    expect(out.primary).toBe('driverIssue');
    expect(out.severity).toBe('critical');
    expect(out.modifiers).toEqual([]);
  });

  it('idle → disconnected/neutral', () => {
    const out = deriveUpsBannerState({ tokens: ['OL'], connection: 'idle' });
    expect(out).toEqual({ primary: 'disconnected', modifiers: [], severity: 'neutral' });
  });

  it('connecting/initializing/reconnecting → info', () => {
    expect(deriveUpsBannerState({ tokens: [], connection: 'connecting' }).primary).toBe('connecting');
    expect(deriveUpsBannerState({ tokens: [], connection: 'initializing' }).primary).toBe('initializing');
    expect(deriveUpsBannerState({ tokens: [], connection: 'reconnecting' }).primary).toBe('reconnecting');
    expect(deriveUpsBannerState({ tokens: [], connection: 'connecting' }).severity).toBe('info');
  });

  it('ready or degraded falls through to token-based logic', () => {
    expect(deriveUpsBannerState({ tokens: ['OL'], connection: 'ready' }).primary).toBe('online');
    expect(deriveUpsBannerState({ tokens: ['OL'], connection: 'degraded' }).primary).toBe('online');
  });
});

describe('deriveUpsBannerState — legacy numeric fallback', () => {
  it('reconstructs OL when tokens empty and legacyStatusNum=1', () => {
    const out = deriveUpsBannerState({ tokens: [], legacyStatusNum: 1 });
    expect(out.primary).toBe('online');
    expect(out.severity).toBe('ok');
  });

  it('reconstructs OB when tokens empty and legacyStatusNum=0', () => {
    const out = deriveUpsBannerState({ tokens: [], legacyStatusNum: 0 });
    expect(out.primary).toBe('onBattery');
    expect(out.severity).toBe('warn');
  });

  it('does not use legacy when tokens are present', () => {
    const out = deriveUpsBannerState({ tokens: ['FSD'], legacyStatusNum: 1 });
    expect(out.primary).toBe('forcedShutdown');
  });

  it('returns unknown when tokens empty and no legacy num', () => {
    const out = deriveUpsBannerState({ tokens: [] });
    expect(out).toEqual({ primary: 'unknown', modifiers: [], severity: 'neutral' });
  });

  it('ignores nonsense legacy values', () => {
    expect(deriveUpsBannerState({ tokens: [], legacyStatusNum: 42 }).primary).toBe('unknown');
    expect(deriveUpsBannerState({ tokens: [], legacyStatusNum: null }).primary).toBe('unknown');
  });
});

describe('deriveUpsBannerState — primary state priority ladder', () => {
  it('FSD → forcedShutdown/critical', () => {
    expect(deriveUpsBannerState({ tokens: ['OB', 'LB', 'FSD'] }).primary).toBe('forcedShutdown');
    expect(deriveUpsBannerState({ tokens: ['OB', 'LB', 'FSD'] }).severity).toBe('critical');
  });

  it('OFF → off/critical', () => {
    const out = deriveUpsBannerState({ tokens: ['OFF'] });
    expect(out.primary).toBe('off');
    expect(out.severity).toBe('critical');
  });

  it('OB+LB → batteryLow/critical', () => {
    const out = deriveUpsBannerState({ tokens: ['OB', 'LB'] });
    expect(out.primary).toBe('batteryLow');
    expect(out.severity).toBe('critical');
  });

  it('OB+RB → batteryFailing/critical', () => {
    const out = deriveUpsBannerState({ tokens: ['OB', 'RB'] });
    expect(out.primary).toBe('batteryFailing');
    expect(out.severity).toBe('critical');
  });

  it('OB+OL → transferring/info', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'OB'] });
    expect(out.primary).toBe('transferring');
    expect(out.severity).toBe('info');
  });

  it('OB-alone → onBattery/warn', () => {
    const out = deriveUpsBannerState({ tokens: ['OB'] });
    expect(out.primary).toBe('onBattery');
    expect(out.severity).toBe('warn');
  });

  it('OB+DISCHRG → onBattery with discharging chip', () => {
    const out = deriveUpsBannerState({ tokens: ['OB', 'DISCHRG'] });
    expect(out.primary).toBe('onBattery');
    expect(out.modifiers).toContain('discharging');
  });

  it('OL+BYPASS → bypass/warn', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'BYPASS'] });
    expect(out.primary).toBe('bypass');
    expect(out.severity).toBe('warn');
  });

  it('BYPASS alone → bypass/warn', () => {
    const out = deriveUpsBannerState({ tokens: ['BYPASS'] });
    expect(out.primary).toBe('bypass');
    expect(out.severity).toBe('warn');
  });

  it('OL+OVER → overload/critical', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'OVER'] });
    expect(out.primary).toBe('overload');
    expect(out.severity).toBe('critical');
  });

  it('OL+CAL → calibration/info', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'CAL'] });
    expect(out.primary).toBe('calibration');
    expect(out.severity).toBe('info');
  });

  it('OL+BOOST → boosting/info', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'BOOST'] });
    expect(out.primary).toBe('boosting');
    expect(out.severity).toBe('info');
  });

  it('OL+TRIM → trimming/info', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'TRIM'] });
    expect(out.primary).toBe('trimming');
    expect(out.severity).toBe('info');
  });

  it('OL → online/ok', () => {
    const out = deriveUpsBannerState({ tokens: ['OL'] });
    expect(out.primary).toBe('online');
    expect(out.severity).toBe('ok');
  });

  it('OL+CHRG → online with charging chip', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'CHRG'] });
    expect(out.primary).toBe('online');
    expect(out.modifiers).toContain('charging');
  });

  it('OL+RB → online with replaceBattery chip', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'RB'] });
    expect(out.primary).toBe('online');
    expect(out.modifiers).toContain('replaceBattery');
  });

  it('ALARM-only → alarm/warn', () => {
    const out = deriveUpsBannerState({ tokens: ['ALARM'] });
    expect(out.primary).toBe('alarm');
    expect(out.severity).toBe('warn');
  });

  it('OL+ALARM → online with alarm chip', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'ALARM'] });
    expect(out.primary).toBe('online');
    expect(out.modifiers).toContain('alarm');
  });

  it('OL+ECO → online with eco chip', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'ECO'] });
    expect(out.primary).toBe('online');
    expect(out.modifiers).toContain('eco');
  });

  it('OL+HB → online with highBattery chip', () => {
    const out = deriveUpsBannerState({ tokens: ['OL', 'HB'] });
    expect(out.primary).toBe('online');
    expect(out.modifiers).toContain('highBattery');
  });

  it('empty tokens → unknown/neutral', () => {
    const out = deriveUpsBannerState({ tokens: [] });
    expect(out).toEqual({ primary: 'unknown', modifiers: [], severity: 'neutral' });
  });
});

describe('deriveUpsBannerState — stale escalation', () => {
  it('adds stale modifier and bumps ok→warn beyond grace', () => {
    const out = deriveUpsBannerState({
      tokens: ['OL'],
      staleSeconds: DEFAULT_STATUS_STALE_GRACE_SECONDS + 1,
    });
    expect(out.modifiers).toContain('stale');
    expect(out.severity).toBe('warn');
  });

  it('adds stale modifier and bumps info→warn', () => {
    const out = deriveUpsBannerState({
      tokens: ['OL', 'BOOST'],
      staleSeconds: 60,
    });
    expect(out.modifiers).toContain('stale');
    expect(out.severity).toBe('warn');
  });

  it('keeps critical as critical when stale', () => {
    const out = deriveUpsBannerState({
      tokens: ['OB', 'LB'],
      staleSeconds: 60,
    });
    expect(out.modifiers).toContain('stale');
    expect(out.severity).toBe('critical');
  });

  it('keeps warn as warn when stale', () => {
    const out = deriveUpsBannerState({
      tokens: ['OB'],
      staleSeconds: 60,
    });
    expect(out.modifiers).toContain('stale');
    expect(out.severity).toBe('warn');
  });

  it('does not add stale within grace window', () => {
    const out = deriveUpsBannerState({
      tokens: ['OL'],
      staleSeconds: DEFAULT_STATUS_STALE_GRACE_SECONDS - 1,
    });
    expect(out.modifiers).not.toContain('stale');
    expect(out.severity).toBe('ok');
  });

  it('does not add stale when there are no tokens', () => {
    const out = deriveUpsBannerState({
      tokens: [],
      staleSeconds: 99,
    });
    expect(out.modifiers).not.toContain('stale');
    expect(out.primary).toBe('unknown');
  });
});
