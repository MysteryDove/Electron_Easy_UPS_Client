import { BrowserWindow } from 'electron';
import type { AppConfig, DebugLogLevel } from '../config/configSchema';
import type { ConfigStore } from '../config/configStore';
import type {
  TelemetryRepository,
  TelemetryValues,
} from '../db/telemetryRepository';
import { IPC_EVENTS } from '../ipc/ipcChannels';
import type { ConnectionState } from '../ipc/ipcEvents';
import { discoverNutCapabilities } from './nutCapabilityDiscovery';
import { NutClient } from './nutClient';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const LOG_LEVEL_PRIORITY: Record<DebugLogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export type NutTelemetryUpdatedPayload = {
  ts: string;
  values: TelemetryValues;
};

type NutTelemetryUpdatedListener = (
  payload: NutTelemetryUpdatedPayload,
) => void;

export class NutPollingService {
  private readonly configStore: ConfigStore;
  private readonly telemetryRepository: TelemetryRepository;
  private readonly nutClient: NutClient;
  private readonly telemetryUpdatedListeners = new Set<NutTelemetryUpdatedListener>();
  private readonly connectionStateListeners = new Set<(state: ConnectionState) => void>();
  private debugLogLevel: DebugLogLevel;
  private state: ConnectionState = 'idle';
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private pollInFlight = false;
  private availableFields: Set<string> = new Set();
  private staticFields: Set<string> = new Set();
  private dynamicFields: Set<string> = new Set();
  private staticSnapshot: Record<string, string> = {};

  public constructor(configStore: ConfigStore, telemetryRepository: TelemetryRepository) {
    this.configStore = configStore;
    this.telemetryRepository = telemetryRepository;
    this.nutClient = new NutClient();
    this.debugLogLevel = this.configStore.get().debug.level;
  }

  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    void this.connectAndInitialize();
  }

  public async stop(): Promise<void> {
    this.started = false;
    this.clearPollTimer();
    this.clearReconnectTimer();
    await this.nutClient.close();
    this.setState('idle');
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getStaticSnapshot(): Record<string, string> {
    return this.staticSnapshot;
  }

  public onTelemetryUpdated(listener: NutTelemetryUpdatedListener): () => void {
    this.telemetryUpdatedListeners.add(listener);
    return () => {
      this.telemetryUpdatedListeners.delete(listener);
    };
  }

  public onConnectionStateChanged(
    listener: (state: ConnectionState) => void,
  ): () => void {
    this.connectionStateListeners.add(listener);
    return () => {
      this.connectionStateListeners.delete(listener);
    };
  }

  public async handleConfigUpdated(
    previousConfig: AppConfig,
    nextConfig: AppConfig,
  ): Promise<void> {
    this.debugLogLevel = nextConfig.debug.level;

    if (!previousConfig.wizard.completed && nextConfig.wizard.completed) {
      if (!this.started) {
        this.start();
      }
      return;
    }

    if (!this.started) {
      return;
    }

    const reconnectRequired = hasNutConnectionConfigChanged(
      previousConfig,
      nextConfig,
    );
    const pollingIntervalChanged =
      previousConfig.polling.intervalMs !== nextConfig.polling.intervalMs;

    if (reconnectRequired) {
      await this.reconnectNow();
      return;
    }

    if (pollingIntervalChanged && this.state === 'ready') {
      this.startPollingTimer(nextConfig.polling.intervalMs);
    }
  }

  private async reconnectNow(): Promise<void> {
    this.clearPollTimer();
    this.clearReconnectTimer();
    await this.nutClient.close();
    this.reconnectAttempt = 0;
    this.setState('reconnecting');
    void this.connectAndInitialize();
  }

  private async connectAndInitialize(): Promise<void> {
    if (!this.started) {
      return;
    }

    try {
      const config = this.configStore.get();
      this.debugLogLevel = config.debug.level;
      this.setState('connecting');

      await this.nutClient.connect({
        host: config.nut.host,
        port: config.nut.port,
        upsName: config.nut.upsName,
        username: config.nut.username,
        password: config.nut.password,
      });

      this.setState('initializing');
      const discoveryResult = await discoverNutCapabilities(
        this.nutClient,
        config.nut.upsName,
      );

      this.availableFields = discoveryResult.availableFields;
      this.staticFields = discoveryResult.staticFields;
      this.dynamicFields = discoveryResult.dynamicFields;
      this.staticSnapshot = discoveryResult.staticSnapshot;
      this.log('debug', 'Capability discovery completed', {
        availableFieldCount: this.availableFields.size,
        staticFieldCount: this.staticFields.size,
        dynamicFieldCount: this.dynamicFields.size,
      });

      this.emitToRenderers(IPC_EVENTS.upsStaticData, {
        values: this.staticSnapshot,
        fields: {
          available: [...this.availableFields],
          static: [...this.staticFields],
          dynamic: [...this.dynamicFields],
        },
      });

      this.logPolledSnapshot(
        discoveryResult.initialDynamicSnapshot,
        'initial',
      );
      await this.persistAndBroadcastTelemetry(discoveryResult.initialDynamicSnapshot);

      this.reconnectAttempt = 0;
      this.setState('ready');
      this.startPollingTimer(config.polling.intervalMs);
    } catch (error) {
      await this.handleConnectionFailure(error);
    }
  }

  private startPollingTimer(intervalMs: number): void {
    this.clearPollTimer();

    const normalizedIntervalMs = clampPollingIntervalMs(intervalMs);
    this.pollTimer = setInterval(() => {
      void this.pollDynamicFields();
    }, normalizedIntervalMs);
  }

  private clearPollTimer(): void {
    if (!this.pollTimer) {
      return;
    }

    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async pollDynamicFields(): Promise<void> {
    if (!this.started || this.pollInFlight || this.dynamicFields.size === 0) {
      return;
    }

    this.pollInFlight = true;
    try {
      const config = this.configStore.get();
      this.debugLogLevel = config.debug.level;
      const snapshot = await this.nutClient.getVariables(config.nut.upsName, [
        ...this.dynamicFields,
      ]);
      this.logPolledSnapshot(snapshot);

      await this.persistAndBroadcastTelemetry(snapshot);
    } catch (error) {
      await this.handleConnectionFailure(error);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async persistAndBroadcastTelemetry(
    dynamicSnapshot: Record<string, string>,
  ): Promise<void> {
    const config = this.configStore.get();
    const timestamp = new Date();
    const values = await this.telemetryRepository.insertFromNutSnapshot(
      timestamp,
      dynamicSnapshot,
      config.nut.mapping,
    );
    if (Object.keys(values).length === 0) {
      return;
    }

    this.logMappedTelemetry(values);

    const payload: NutTelemetryUpdatedPayload = {
      ts: timestamp.toISOString(),
      values,
    };

    this.emitToRenderers(IPC_EVENTS.upsTelemetryUpdated, payload);
    this.notifyTelemetryUpdatedListeners(payload);
  }

  private async handleConnectionFailure(error: unknown): Promise<void> {
    this.clearPollTimer();

    try {
      await this.nutClient.close();
    } catch {
      // Ignore close errors during reconnect flow.
    }

    if (!this.started) {
      return;
    }

    console.error('[NutPollingService] connection failure', error);
    this.setState('degraded');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) {
      return;
    }

    const delayMs = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );

    this.reconnectAttempt += 1;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectAndInitialize();
    }, delayMs);
  }

  private setState(nextState: ConnectionState): void {
    if (this.state === nextState) {
      return;
    }

    this.state = nextState;
    this.emitToRenderers(IPC_EVENTS.connectionStateChanged, {
      state: nextState,
    });

    for (const listener of this.connectionStateListeners) {
      try {
        listener(nextState);
      } catch (error) {
        console.error('[NutPollingService] connection state listener failed', error);
      }
    }
  }

  private emitToRenderers(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue;
      }

      window.webContents.send(channel, payload);
    }
  }

  private notifyTelemetryUpdatedListeners(
    payload: NutTelemetryUpdatedPayload,
  ): void {
    for (const listener of this.telemetryUpdatedListeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error(
          '[NutPollingService] telemetry update listener failed',
          error,
        );
      }
    }
  }

  private logPolledSnapshot(
    snapshot: Record<string, string>,
    context: 'initial' | 'runtime' = 'runtime',
  ): void {
    const fieldCount = Object.keys(snapshot).length;
    if (this.shouldLog('debug')) {
      this.log(
        'debug',
        `[${context}] Polled ${fieldCount} dynamic NUT fields`,
        prettyJson(snapshot),
      );
      return;
    }

    this.log('info', `[${context}] Polled ${fieldCount} dynamic NUT fields`);
  }

  private logMappedTelemetry(values: Record<string, unknown>): void {
    const fieldCount = Object.keys(values).length;
    if (this.shouldLog('debug')) {
      this.log(
        'debug',
        `Mapped ${fieldCount} telemetry values`,
        prettyJson(values),
      );
      return;
    }

    this.log('info', `Mapped ${fieldCount} telemetry values`);
  }

  private shouldLog(level: Exclude<DebugLogLevel, 'off'>): boolean {
    return LOG_LEVEL_PRIORITY[this.debugLogLevel] >= LOG_LEVEL_PRIORITY[level];
  }

  private log(
    level: Exclude<DebugLogLevel, 'off'>,
    message: string,
    payload?: unknown,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const prefix = '[NutPollingService]';
    if (level === 'error') {
      console.error(prefix, message, payload ?? '');
      return;
    }

    if (level === 'warn') {
      console.warn(prefix, message, payload ?? '');
      return;
    }

    if (level === 'info') {
      console.info(prefix, message, payload ?? '');
      return;
    }

    console.debug(prefix, message, payload ?? '');
  }
}

function prettyJson(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return JSON.stringify(payload);
  }

  const sorted = Object.keys(payload as Record<string, unknown>)
    .sort()
    .reduce(
      (accumulator, key) => {
        accumulator[key] = (payload as Record<string, unknown>)[key];
        return accumulator;
      },
      {} as Record<string, unknown>,
    );

  return JSON.stringify(sorted, null, 2);
}

function clampPollingIntervalMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 2000;
  }

  const rounded = Math.floor(value);
  if (rounded < 500) {
    return 500;
  }

  if (rounded > 60000) {
    return 60000;
  }

  return rounded;
}

function hasNutConnectionConfigChanged(
  previousConfig: AppConfig,
  nextConfig: AppConfig,
): boolean {
  return (
    previousConfig.nut.host !== nextConfig.nut.host ||
    previousConfig.nut.port !== nextConfig.nut.port ||
    previousConfig.nut.upsName !== nextConfig.nut.upsName ||
    previousConfig.nut.username !== nextConfig.nut.username ||
    previousConfig.nut.password !== nextConfig.nut.password
  );
}
