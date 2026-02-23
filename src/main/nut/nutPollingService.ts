import { BrowserWindow } from 'electron';
import {
  execFile,
  spawn,
  type ChildProcess,
} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
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
const LOCAL_DRIVER_START_DELAY_MS = 1200;
const LOCAL_UPSD_START_DELAY_MS = 1000;
const LOCAL_DRIVER_RELATIVE_PATH_CANDIDATES = [
  'bin/snmp-ups.exe',
  'sbin/snmp-ups.exe',
];
const execFileAsync = promisify(execFile);
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

type ExistingLocalNutProcessIds = {
  driverPids: number[];
  upsdPids: number[];
};

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
  private localDriverProcess: ChildProcess | null = null;
  private localUpsdProcess: ChildProcess | null = null;
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
    await this.stopLocalNutProcesses({ forceManagedChildren: true });
    this.setState('idle');
  }

  public async startLocalComponentsForWizard(
    folderPath: string,
    upsName: string,
  ): Promise<void> {
    const normalizedFolderPath = folderPath.trim();
    if (!normalizedFolderPath) {
      throw new Error('folderPath is required');
    }

    const normalizedUpsName = upsName.trim();
    if (!normalizedUpsName) {
      throw new Error('upsName is required');
    }

    const baseConfig = this.configStore.get();
    const wizardLocalConfig: AppConfig = {
      ...baseConfig,
      nut: {
        ...baseConfig.nut,
        upsName: normalizedUpsName,
        launchLocalComponents: true,
        localNutFolderPath: normalizedFolderPath,
      },
    };

    await this.startLocalNutProcessesIfNeeded(wizardLocalConfig);
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
    await this.stopLocalNutProcesses({ forceManagedChildren: true });
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
      await this.startLocalNutProcessesIfNeeded(config);

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

  private async startLocalNutProcessesIfNeeded(config: AppConfig): Promise<void> {
    if (!config.nut.launchLocalComponents) {
      await this.stopLocalNutProcesses();
      return;
    }

    if (
      this.localDriverProcess &&
      this.localDriverProcess.exitCode === null &&
      this.localUpsdProcess &&
      this.localUpsdProcess.exitCode === null
    ) {
      return;
    }

    await this.stopLocalNutProcesses();

    const folderPath = config.nut.localNutFolderPath?.trim();
    if (!folderPath) {
      throw new Error(
        'localNutFolderPath is required when launchLocalComponents is enabled',
      );
    }

    const driverPath = await this.resolveLocalDriverPath(folderPath);
    const upsdPath = path.join(folderPath, 'sbin', 'upsd.exe');
    await assertFileExists(upsdPath, 'upsd.exe');

    const existingProcesses = await findExistingLocalNutProcessIds(
      driverPath,
      upsdPath,
    );

    if (existingProcesses.driverPids.length > 0) {
      this.log('warn', 'Reusing existing local snmp-ups process', {
        driverPath,
        pids: existingProcesses.driverPids,
      });
    } else {
      this.log('info', 'Starting local snmp-ups process', {
        driverPath,
        upsName: config.nut.upsName,
      });

      const driverProcess = spawn(driverPath, ['-a', config.nut.upsName], {
        cwd: folderPath,
        windowsHide: true,
        stdio: 'ignore',
      });
      this.localDriverProcess = driverProcess;
      this.attachLocalProcessHandlers(driverProcess, 'snmp-ups');

      await sleep(LOCAL_DRIVER_START_DELAY_MS);
      if (driverProcess.exitCode !== null) {
        throw new Error(`snmp-ups exited early with code ${driverProcess.exitCode}`);
      }
    }

    if (existingProcesses.upsdPids.length > 0) {
      this.log('warn', 'Reusing existing local upsd process', {
        upsdPath,
        pids: existingProcesses.upsdPids,
      });
      return;
    }

    this.log('info', 'Starting local upsd process', { upsdPath });
    const upsdProcess = spawn(upsdPath, [], {
      cwd: folderPath,
      windowsHide: true,
      stdio: 'ignore',
    });
    this.localUpsdProcess = upsdProcess;
    this.attachLocalProcessHandlers(upsdProcess, 'upsd');

    await sleep(LOCAL_UPSD_START_DELAY_MS);
    if (upsdProcess.exitCode !== null) {
      throw new Error(`upsd exited early with code ${upsdProcess.exitCode}`);
    }
  }

  private async stopLocalNutProcesses(
    options?: {
      forceManagedChildren?: boolean;
    },
  ): Promise<void> {
    const shouldTerminate = Boolean(
      options?.forceManagedChildren ||
      this.configStore.get().nut.launchLocalComponents,
    );
    const upsd = this.localUpsdProcess;
    const driver = this.localDriverProcess;
    this.localUpsdProcess = null;
    this.localDriverProcess = null;

    if (!shouldTerminate) {
      this.log(
        'debug',
        'Skipping local NUT process termination because launchLocalComponents is disabled',
      );
      return;
    }

    await Promise.all([
      terminateChildProcess(upsd),
      terminateChildProcess(driver),
    ]);
  }

  private async resolveLocalDriverPath(folderPath: string): Promise<string> {
    for (const relativePath of LOCAL_DRIVER_RELATIVE_PATH_CANDIDATES) {
      const fullPath = path.join(folderPath, relativePath);
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }

    throw new Error(
      `snmp-ups.exe not found in ${LOCAL_DRIVER_RELATIVE_PATH_CANDIDATES.join(' or ')}`,
    );
  }

  private attachLocalProcessHandlers(
    processRef: ChildProcess,
    processName: 'snmp-ups' | 'upsd',
  ): void {
    processRef.on('error', (error) => {
      this.log('error', `${processName} process error`, error);
    });
    processRef.on('exit', (code, signal) => {
      this.log('warn', `${processName} process exited`, { code, signal });
      if (processName === 'snmp-ups' && this.localDriverProcess === processRef) {
        this.localDriverProcess = null;
      }
      if (processName === 'upsd' && this.localUpsdProcess === processRef) {
        this.localUpsdProcess = null;
      }
    });
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
    previousConfig.nut.password !== nextConfig.nut.password ||
    previousConfig.nut.launchLocalComponents !==
    nextConfig.nut.launchLocalComponents ||
    previousConfig.nut.localNutFolderPath !== nextConfig.nut.localNutFolderPath
  );
}

async function terminateChildProcess(processRef: ChildProcess | null): Promise<void> {
  if (!processRef || processRef.killed || processRef.exitCode !== null) {
    return;
  }

  const pid = processRef.pid;
  if (!pid) {
    return;
  }

  await terminateProcessByPid(pid);
}

async function terminateProcessByPid(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']).catch(
      () => {
        // Ignore termination failures; process may have already exited.
      },
    );
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore termination failures; process may have already exited.
  }
}

async function findExistingLocalNutProcessIds(
  driverPath: string,
  upsdPath: string,
): Promise<ExistingLocalNutProcessIds> {
  if (process.platform !== 'win32') {
    return { driverPids: [], upsdPids: [] };
  }

  const [driverPids, upsdPids] = await Promise.all([
    findWindowsProcessPidsByExecutablePath(driverPath),
    findWindowsProcessPidsByExecutablePath(upsdPath),
  ]);

  return {
    driverPids,
    upsdPids,
  };
}

async function findWindowsProcessPidsByExecutablePath(
  executablePath: string,
  commandLineContains?: string,
): Promise<number[]> {
  const escapedPath = escapeForSingleQuotedPowerShell(executablePath);
  const commandFilter = commandLineContains?.trim();
  const scriptParts = [
    '$ErrorActionPreference = "Stop"',
    `$targetPath = '${escapedPath}'`,
    '$processes = @(Get-CimInstance Win32_Process | Where-Object {',
    '  $_.ExecutablePath -and $_.ExecutablePath.Equals($targetPath, [System.StringComparison]::OrdinalIgnoreCase)',
    '})',
  ];

  if (commandFilter) {
    const escapedCommandFilter = escapeForSingleQuotedPowerShell(commandFilter);
    scriptParts.push(
      `$commandFilter = '${escapedCommandFilter}'`,
      '$processes = @($processes | Where-Object {',
      '  $_.CommandLine -and $_.CommandLine.IndexOf($commandFilter, [System.StringComparison]::OrdinalIgnoreCase) -ge 0',
      '})',
    );
  }

  scriptParts.push(
    '$pids = @($processes | ForEach-Object { [int]$_.ProcessId })',
    '$pids | ConvertTo-Json -Compress',
  );

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        scriptParts.join('; '),
      ],
      { windowsHide: true },
    );

    return parseProcessIdList(stdout);
  } catch (error) {
    console.warn('[NutPollingService] Failed to inspect running local NUT processes', error);
    return [];
  }
}

function parseProcessIdList(stdout: string): number[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is number => (
        typeof entry === 'number' &&
        Number.isInteger(entry) &&
        entry > 0
      ));
    }

    if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0) {
      return [parsed];
    }
  } catch {
    // Ignore parse failures and return an empty list.
  }

  return [];
}

function escapeForSingleQuotedPowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function assertFileExists(targetPath: string, name: string): Promise<void> {
  if (!(await fileExists(targetPath))) {
    throw new Error(`${name} not found: ${targetPath}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
