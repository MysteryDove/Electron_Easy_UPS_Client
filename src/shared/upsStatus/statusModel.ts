export const DEFAULT_STATUS_STALE_GRACE_SECONDS = 15;

export function parseUpsStatusTokens(rawUpsStatus: string | null | undefined): string[] {
  if (!rawUpsStatus) {
    return [];
  }

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of rawUpsStatus.split(/\s+/u)) {
    const normalized = token.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tokens.push(normalized);
  }
  return tokens;
}

export type BannerSeverity = 'ok' | 'info' | 'warn' | 'critical' | 'neutral';

export type BannerPrimary =
  | 'online'
  | 'onBattery'
  | 'batteryLow'
  | 'batteryFailing'
  | 'forcedShutdown'
  | 'off'
  | 'bypass'
  | 'overload'
  | 'calibration'
  | 'boosting'
  | 'trimming'
  | 'transferring'
  | 'alarm'
  | 'unknown'
  | 'driverIssue'
  | 'reconnecting'
  | 'initializing'
  | 'connecting'
  | 'disconnected';

export type BannerModifier =
  | 'charging'
  | 'discharging'
  | 'replaceBattery'
  | 'alarm'
  | 'eco'
  | 'overload'
  | 'bypass'
  | 'highBattery'
  | 'stale';

export type BannerConnectionState =
  | 'idle'
  | 'connecting'
  | 'initializing'
  | 'ready'
  | 'degraded'
  | 'reconnecting';

type BannerDriverIssueLike = { code?: string; summary?: string } | null | undefined;

export type DeriveUpsBannerStateInput = {
  tokens: string[];
  legacyStatusNum?: number | null;
  connection?: BannerConnectionState | null;
  staleSeconds?: number;
  driverIssue?: BannerDriverIssueLike;
};

export type DerivedUpsBannerState = {
  primary: BannerPrimary;
  modifiers: BannerModifier[];
  severity: BannerSeverity;
};

export function deriveUpsBannerState(
  input: DeriveUpsBannerStateInput,
): DerivedUpsBannerState {
  if (input.driverIssue) {
    return { primary: 'driverIssue', modifiers: [], severity: 'critical' };
  }

  switch (input.connection) {
    case 'idle':
      return { primary: 'disconnected', modifiers: [], severity: 'neutral' };
    case 'connecting':
      return { primary: 'connecting', modifiers: [], severity: 'info' };
    case 'initializing':
      return { primary: 'initializing', modifiers: [], severity: 'info' };
    case 'reconnecting':
      return { primary: 'reconnecting', modifiers: [], severity: 'info' };
  }

  let tokens = input.tokens;
  if (tokens.length === 0 && (input.legacyStatusNum === 0 || input.legacyStatusNum === 1)) {
    tokens = input.legacyStatusNum === 1 ? ['OL'] : ['OB'];
  }

  const base = derivePrimaryAndModifiers(tokens);

  const stale =
    typeof input.staleSeconds === 'number' &&
    input.staleSeconds > DEFAULT_STATUS_STALE_GRACE_SECONDS;

  if (!stale || tokens.length === 0) {
    return base;
  }

  return {
    primary: base.primary,
    modifiers: [...base.modifiers, 'stale'],
    severity: base.severity === 'ok' || base.severity === 'info' ? 'warn' : base.severity,
  };
}

function derivePrimaryAndModifiers(tokens: string[]): DerivedUpsBannerState {
  if (tokens.length === 0) {
    return { primary: 'unknown', modifiers: [], severity: 'neutral' };
  }

  const has = (token: string): boolean => tokens.includes(token);

  if (has('FSD')) {
    return {
      primary: 'forcedShutdown',
      modifiers: collectModifiers(tokens, ['FSD', 'OB', 'LB', 'OL']),
      severity: 'critical',
    };
  }

  if (has('OFF')) {
    return {
      primary: 'off',
      modifiers: collectModifiers(tokens, ['OFF']),
      severity: 'critical',
    };
  }

  if (has('OB') && has('LB')) {
    return {
      primary: 'batteryLow',
      modifiers: collectModifiers(tokens, ['OB', 'LB']),
      severity: 'critical',
    };
  }

  if (has('OB') && has('RB')) {
    return {
      primary: 'batteryFailing',
      modifiers: collectModifiers(tokens, ['OB', 'RB']),
      severity: 'critical',
    };
  }

  if (has('OB') && has('OL')) {
    return {
      primary: 'transferring',
      modifiers: collectModifiers(tokens, ['OB', 'OL']),
      severity: 'info',
    };
  }

  if (has('OB')) {
    return {
      primary: 'onBattery',
      modifiers: collectModifiers(tokens, ['OB']),
      severity: 'warn',
    };
  }

  if (has('BYPASS')) {
    return {
      primary: 'bypass',
      modifiers: collectModifiers(tokens, ['BYPASS', 'OL']),
      severity: 'warn',
    };
  }

  if (has('OVER')) {
    return {
      primary: 'overload',
      modifiers: collectModifiers(tokens, ['OVER', 'OL']),
      severity: 'critical',
    };
  }

  if (has('CAL')) {
    return {
      primary: 'calibration',
      modifiers: collectModifiers(tokens, ['CAL', 'OL']),
      severity: 'info',
    };
  }

  if (has('OL') && has('BOOST')) {
    return {
      primary: 'boosting',
      modifiers: collectModifiers(tokens, ['OL', 'BOOST']),
      severity: 'info',
    };
  }

  if (has('OL') && has('TRIM')) {
    return {
      primary: 'trimming',
      modifiers: collectModifiers(tokens, ['OL', 'TRIM']),
      severity: 'info',
    };
  }

  if (has('OL')) {
    return {
      primary: 'online',
      modifiers: collectModifiers(tokens, ['OL']),
      severity: 'ok',
    };
  }

  if (has('ALARM')) {
    return {
      primary: 'alarm',
      modifiers: collectModifiers(tokens, ['ALARM']),
      severity: 'warn',
    };
  }

  return { primary: 'unknown', modifiers: [], severity: 'neutral' };
}

function collectModifiers(tokens: string[], primaryAbsorbs: string[]): BannerModifier[] {
  const absorbed = new Set(primaryAbsorbs);
  const has = (token: string): boolean => tokens.includes(token);

  const modifiers: BannerModifier[] = [];

  if (has('CHRG')) modifiers.push('charging');
  if (has('DISCHRG')) modifiers.push('discharging');
  if (has('RB') && !absorbed.has('RB')) modifiers.push('replaceBattery');
  if (has('ALARM') && !absorbed.has('ALARM')) modifiers.push('alarm');
  if (has('ECO')) modifiers.push('eco');
  if (has('HB')) modifiers.push('highBattery');
  if (has('OVER') && !absorbed.has('OVER')) modifiers.push('overload');
  if (has('BYPASS') && !absorbed.has('BYPASS')) modifiers.push('bypass');

  return modifiers;
}
