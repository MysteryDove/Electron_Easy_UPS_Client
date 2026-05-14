import type {
  ConnectionState,
  TelemetryValues,
} from '../../shared/ipc/contracts';
import type {
  ShutdownPolicyConnectionState,
  ShutdownPolicyContext,
} from '../../shared/shutdownPolicy/types';

const DEFAULT_STATUS_STALE_GRACE_SECONDS = 15;

export type ShutdownPolicyContextBuilderOptions = {
  statusStaleGraceSeconds?: number;
};

export type ShutdownPolicyContextBuilderInput = {
  values?: TelemetryValues;
  rawUpsStatus?: string | null;
  connectionState?: ShutdownPolicyConnectionState | ConnectionState;
  pollSucceeded?: boolean;
  now?: number;
  activeCountdownRuleId?: string;
};

export class ShutdownPolicyContextBuilder {
  private readonly statusStaleGraceSeconds: number;
  private lastContextNow: number | null = null;
  private lastStatusAt: number | null = null;
  private lastSuccessfulPollAt: number | null = null;
  private lastKnownStatusTokens: string[] = [];
  private secondsOnBattery = 0;
  private secondsOnline = 0;
  private secondsLowBattery = 0;
  private secondsInFsd = 0;

  public constructor(options: ShutdownPolicyContextBuilderOptions = {}) {
    this.statusStaleGraceSeconds =
      options.statusStaleGraceSeconds ?? DEFAULT_STATUS_STALE_GRACE_SECONDS;
  }

  public reset(): void {
    this.lastContextNow = null;
    this.lastStatusAt = null;
    this.lastSuccessfulPollAt = null;
    this.lastKnownStatusTokens = [];
    this.secondsOnBattery = 0;
    this.secondsOnline = 0;
    this.secondsLowBattery = 0;
    this.secondsInFsd = 0;
  }

  public build(input: ShutdownPolicyContextBuilderInput): ShutdownPolicyContext {
    const reportedNow = input.now ?? Date.now();
    // Keep time monotonic across build calls so stale or out-of-order caller
    // timestamps do not rewind duration tracking.
    const now = this.lastContextNow === null
      ? reportedNow
      : Math.max(this.lastContextNow, reportedNow);
    const values = input.values ?? {};
    const rawStatusTokens = parseUpsStatusTokens(input.rawUpsStatus);
    const hasFreshStatus = rawStatusTokens.length > 0;
    const elapsedSeconds = this.lastContextNow === null
      ? 0
      : secondsBetween(this.lastContextNow, now);

    if (hasFreshStatus) {
      this.lastStatusAt = now;
      this.lastKnownStatusTokens = rawStatusTokens;
    }

    const statusAgeSeconds = this.lastStatusAt === null
      ? Number.POSITIVE_INFINITY
      : secondsBetween(this.lastStatusAt, now);
    const canUseStaleStatus =
      !hasFreshStatus &&
      this.lastKnownStatusTokens.length > 0 &&
      statusAgeSeconds <= this.statusStaleGraceSeconds;
    const statusTokens = hasFreshStatus
      ? rawStatusTokens
      : canUseStaleStatus
        ? [...this.lastKnownStatusTokens]
        : [];

    const baseConnectionState = normalizeConnectionState(input.connectionState);
    const connectionState =
      baseConnectionState === 'connected' &&
      !hasFreshStatus &&
      !canUseStaleStatus &&
      this.lastStatusAt !== null
        ? 'degraded'
        : baseConnectionState;

    const pollSucceeded = input.pollSucceeded ?? didReceiveTelemetry(
      values,
      hasFreshStatus,
    );
    if (pollSucceeded) {
      this.lastSuccessfulPollAt = now;
    }

    const ups = {
      online: statusTokens.includes('OL'),
      onBattery: statusTokens.includes('OB'),
      lowBattery: statusTokens.includes('LB'),
      fsd: statusTokens.includes('FSD'),
      statusTokens,
    };
    const wasLastKnownOnBattery = this.lastKnownStatusTokens.includes('OB');
    const assumePreviouslyOnBatteryDuringConnectionLoss =
      !hasFreshStatus &&
      !canUseStaleStatus &&
      wasLastKnownOnBattery;

    this.secondsOnBattery = advanceDuration(
      this.secondsOnBattery,
      elapsedSeconds,
      ups.onBattery || assumePreviouslyOnBatteryDuringConnectionLoss,
    );
    this.secondsOnline = advanceDuration(
      this.secondsOnline,
      elapsedSeconds,
      ups.online,
    );
    this.secondsLowBattery = advanceDuration(
      this.secondsLowBattery,
      elapsedSeconds,
      ups.lowBattery,
    );
    this.secondsInFsd = advanceDuration(
      this.secondsInFsd,
      elapsedSeconds,
      ups.fsd,
    );
    this.lastContextNow = now;

    const battery: ShutdownPolicyContext['battery'] = {};
    const chargePercent = normalizePercent(values.battery_charge_pct);
    const runtimeSeconds = normalizeSeconds(values.battery_runtime_sec);
    const voltage = normalizeFiniteNumber(values.battery_voltage);
    if (chargePercent !== undefined) {
      battery.chargePercent = chargePercent;
    }
    if (runtimeSeconds !== undefined) {
      battery.runtimeSeconds = runtimeSeconds;
    }
    if (voltage !== undefined) {
      battery.voltage = voltage;
    }

    const state: ShutdownPolicyContext['state'] = {
      secondsOnBattery: this.secondsOnBattery,
      secondsOnline: this.secondsOnline,
      secondsLowBattery: this.secondsLowBattery,
      secondsInFsd: this.secondsInFsd,
    };
    if (input.activeCountdownRuleId !== undefined) {
      state.activeCountdownRuleId = input.activeCountdownRuleId;
    }

    return {
      now,
      ups,
      battery,
      connection: {
        state: connectionState,
        secondsSinceLastSuccessfulPoll: this.lastSuccessfulPollAt === null
          ? 0
          : secondsBetween(this.lastSuccessfulPollAt, now),
      },
      state,
    };
  }
}

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

export function normalizeConnectionState(
  state: ShutdownPolicyContextBuilderInput['connectionState'],
): ShutdownPolicyConnectionState {
  if (state === undefined) {
    return 'connected';
  }

  if (state === 'connected' || state === 'degraded' || state === 'disconnected') {
    return state;
  }

  if (state === 'ready') {
    return 'connected';
  }

  if (state === 'reconnecting') {
    return 'degraded';
  }

  return 'disconnected';
}

function didReceiveTelemetry(
  values: TelemetryValues,
  hasFreshStatus: boolean,
): boolean {
  if (hasFreshStatus) {
    return true;
  }

  return Object.values(values).some((value) =>
    typeof value === 'number' && Number.isFinite(value),
  );
}

function secondsBetween(previous: number, next: number): number {
  return Math.max(0, (next - previous) / 1000);
}

function advanceDuration(
  previousSeconds: number,
  elapsedSeconds: number,
  condition: boolean,
): number {
  return condition ? previousSeconds + elapsedSeconds : 0;
}

function normalizePercent(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 100) {
    return 100;
  }

  return Math.round(value);
}

function normalizeSeconds(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.floor(value);
}

function normalizeFiniteNumber(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}
