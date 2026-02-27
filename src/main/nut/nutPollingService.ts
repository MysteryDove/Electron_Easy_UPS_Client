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
const DEFAULT_LOCAL_DRIVER_EXECUTABLE = 'snmp-ups';
const MAX_CAPTURED_PROCESS_LOG_LINES = 240;
const MAX_CAPTURED_PROCESS_LOG_LINE_LENGTH = 2000;
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

type LocalProcessOutputCapture = {
  stdout: string[];
  stderr: string[];
  stdoutRemainder: string;
  stderrRemainder: string;
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
  private readonly localProcessOutputCapture = new WeakMap<
    ChildProcess,
    LocalProcessOutputCapture
  >();
  private availableFields: Set<string> = new Set();
  private staticFields: Set<string> = new Set();
  private dynamicFields: Set<string> = new Set();
  // Contains the latest full raw NUT snapshot (static + dynamic fields).
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
      this.staticSnapshot = {
        ...discoveryResult.staticSnapshot,
        ...discoveryResult.initialDynamicSnapshot,
      };
      this.log('debug', 'Capability discovery completed', {
        availableFieldCount: this.availableFields.size,
        staticFieldCount: this.staticFields.size,
        dynamicFieldCount: this.dynamicFields.size,
      });

      this.emitCurrentNutSnapshot();

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

    const {
      driverPath,
      driverExecutable,
    } = await this.resolveLocalDriverPath(folderPath, config.nut.upsName);
    const upsdPath = path.join(folderPath, 'sbin', 'upsd.exe');
    await assertFileExists(upsdPath, 'upsd.exe');

    const existingProcesses = await findExistingLocalNutProcessIds(
      driverPath,
      upsdPath,
    );

    if (existingProcesses.driverPids.length > 0) {
      this.log('warn', 'Reusing existing local NUT driver process', {
        driverExecutable,
        driverPath,
        pids: existingProcesses.driverPids,
      });
    } else {
      const driverArgs = ['-a', config.nut.upsName];
      const driverCommandLine = formatCommandLineForLog(driverPath, driverArgs);
      this.log('info', 'Starting local NUT driver process', {
        driverExecutable,
        driverPath,
        upsName: config.nut.upsName,
        commandLine: driverCommandLine,
      });

      const driverProcess = spawn(driverPath, driverArgs, {
        cwd: folderPath,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.localDriverProcess = driverProcess;
      this.attachLocalProcessOutputCapture(driverProcess, 'driver');
      this.attachLocalProcessHandlers(driverProcess, 'driver', {
        commandLine: driverCommandLine,
        cwd: folderPath,
      });

      await sleep(LOCAL_DRIVER_START_DELAY_MS);
      if (driverProcess.exitCode !== null) {
        const attachedDriverPids = await findWindowsProcessPidsByExecutablePath(
          driverPath,
          `-a ${config.nut.upsName}`,
        );
        if (driverProcess.exitCode === 0 && attachedDriverPids.length > 0) {
          this.log(
            'warn',
            'Local NUT driver launcher exited but active driver process was detected',
            {
              driverExecutable,
              commandLine: driverCommandLine,
              attachedDriverPids,
            },
          );
          this.logCapturedProcessOutputIfAvailable(driverProcess, 'driver');
          this.localDriverProcess = null;
        } else {
          const captured = this.getCapturedProcessOutput(driverProcess);
          throw new Error(
            formatLocalProcessEarlyExitError(
              driverExecutable,
              driverProcess.exitCode,
              driverCommandLine,
              captured,
            ),
          );
        }
      }
    }

    if (existingProcesses.upsdPids.length > 0) {
      this.log('warn', 'Reusing existing local upsd process', {
        upsdPath,
        pids: existingProcesses.upsdPids,
      });
      return;
    }

    const upsdArgs: string[] = [];
    const upsdCommandLine = formatCommandLineForLog(upsdPath, upsdArgs);
    this.log('info', 'Starting local upsd process', {
      upsdPath,
      commandLine: upsdCommandLine,
    });
    const upsdProcess = spawn(upsdPath, upsdArgs, {
      cwd: folderPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.localUpsdProcess = upsdProcess;
    this.attachLocalProcessOutputCapture(upsdProcess, 'upsd');
    this.attachLocalProcessHandlers(upsdProcess, 'upsd', {
      commandLine: upsdCommandLine,
      cwd: folderPath,
    });

    await sleep(LOCAL_UPSD_START_DELAY_MS);
    if (upsdProcess.exitCode !== null) {
      const captured = this.getCapturedProcessOutput(upsdProcess);
      throw new Error(
        formatLocalProcessEarlyExitError(
          'upsd',
          upsdProcess.exitCode,
          upsdCommandLine,
          captured,
        ),
      );
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

  private async resolveLocalDriverPath(
    folderPath: string,
    upsName: string,
  ): Promise<{ driverPath: string; driverExecutable: string }> {
    const configuredDriver =
      await readDriverExecutableFromUpsConf(folderPath, upsName);
    const driverExecutable = configuredDriver ?? DEFAULT_LOCAL_DRIVER_EXECUTABLE;
    const relativeCandidates = [
      `bin/${driverExecutable}.exe`,
      `sbin/${driverExecutable}.exe`,
    ];

    for (const relativePath of relativeCandidates) {
      const fullPath = path.join(folderPath, relativePath);
      if (await fileExists(fullPath)) {
        return { driverPath: fullPath, driverExecutable };
      }
    }

    throw new Error(
      `${driverExecutable}.exe not found in ${relativeCandidates.join(' or ')}`,
    );
  }

  private attachLocalProcessHandlers(
    processRef: ChildProcess,
    processName: 'driver' | 'upsd',
    metadata?: {
      commandLine?: string;
      cwd?: string;
    },
  ): void {
    processRef.on('error', (error) => {
      this.log('error', `${processName} process error`, {
        error,
        ...(metadata?.commandLine ? { commandLine: metadata.commandLine } : {}),
        ...(metadata?.cwd ? { cwd: metadata.cwd } : {}),
      });
      this.logCapturedProcessOutputIfAvailable(processRef, processName);
    });
    processRef.on('exit', (code, signal) => {
      this.log('warn', `${processName} process exited`, {
        code,
        signal,
        ...(metadata?.commandLine ? { commandLine: metadata.commandLine } : {}),
        ...(metadata?.cwd ? { cwd: metadata.cwd } : {}),
      });
      this.logCapturedProcessOutputIfAvailable(processRef, processName);
      if (processName === 'driver' && this.localDriverProcess === processRef) {
        this.localDriverProcess = null;
      }
      if (processName === 'upsd' && this.localUpsdProcess === processRef) {
        this.localUpsdProcess = null;
      }
    });
  }

  private attachLocalProcessOutputCapture(
    processRef: ChildProcess,
    processName: 'driver' | 'upsd',
  ): void {
    const capture: LocalProcessOutputCapture = {
      stdout: [],
      stderr: [],
      stdoutRemainder: '',
      stderrRemainder: '',
    };
    this.localProcessOutputCapture.set(processRef, capture);

    processRef.stdout?.setEncoding('utf8');
    processRef.stdout?.on('data', (chunk: string | Buffer) => {
      this.captureLocalProcessChunk(capture, processName, 'stdout', chunk);
    });

    processRef.stderr?.setEncoding('utf8');
    processRef.stderr?.on('data', (chunk: string | Buffer) => {
      this.captureLocalProcessChunk(capture, processName, 'stderr', chunk);
    });
  }

  private captureLocalProcessChunk(
    capture: LocalProcessOutputCapture,
    processName: 'driver' | 'upsd',
    stream: 'stdout' | 'stderr',
    chunk: string | Buffer,
  ): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (!text) {
      return;
    }

    const remainderField =
      stream === 'stdout' ? 'stdoutRemainder' : 'stderrRemainder';
    const linesField = stream === 'stdout' ? 'stdout' : 'stderr';
    const combined = `${capture[remainderField]}${text}`;
    const lines = combined.split(/\r?\n/u);
    capture[remainderField] = lines.pop() ?? '';

    for (const rawLine of lines) {
      const normalizedLine = rawLine.trimEnd();
      if (!normalizedLine) {
        continue;
      }

      const truncatedLine =
        normalizedLine.length > MAX_CAPTURED_PROCESS_LOG_LINE_LENGTH
          ? `${normalizedLine.slice(0, MAX_CAPTURED_PROCESS_LOG_LINE_LENGTH)} ...`
          : normalizedLine;

      capture[linesField].push(truncatedLine);
      if (capture[linesField].length > MAX_CAPTURED_PROCESS_LOG_LINES) {
        capture[linesField].splice(
          0,
          capture[linesField].length - MAX_CAPTURED_PROCESS_LOG_LINES,
        );
      }

      if (this.shouldLog('debug')) {
        this.log('debug', `[local ${processName} ${stream}] ${truncatedLine}`);
      }
    }
  }

  private getCapturedProcessOutput(
    processRef: ChildProcess,
  ): { stdout: string; stderr: string } {
    const capture = this.localProcessOutputCapture.get(processRef);
    if (!capture) {
      return { stdout: '', stderr: '' };
    }

    const stdoutLines = [...capture.stdout];
    const stderrLines = [...capture.stderr];
    if (capture.stdoutRemainder.trim()) {
      stdoutLines.push(capture.stdoutRemainder.trimEnd());
    }
    if (capture.stderrRemainder.trim()) {
      stderrLines.push(capture.stderrRemainder.trimEnd());
    }

    return {
      stdout: stdoutLines.join('\n'),
      stderr: stderrLines.join('\n'),
    };
  }

  private logCapturedProcessOutputIfAvailable(
    processRef: ChildProcess,
    processName: 'driver' | 'upsd',
  ): void {
    if (!this.shouldLog('debug')) {
      return;
    }

    const captured = this.getCapturedProcessOutput(processRef);
    if (captured.stdout) {
      this.log('debug', `[local ${processName}] captured stdout`, captured.stdout);
    }
    if (captured.stderr) {
      this.log('debug', `[local ${processName}] captured stderr`, captured.stderr);
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
    if (!this.started || this.pollInFlight || this.availableFields.size === 0) {
      return;
    }

    this.pollInFlight = true;
    try {
      const config = this.configStore.get();
      this.debugLogLevel = config.debug.level;
      const fullSnapshot = await this.nutClient.getVariables(config.nut.upsName, [
        ...this.availableFields,
      ]);
      this.logPolledSnapshot(fullSnapshot);
      this.updateCurrentNutSnapshot(fullSnapshot);
      this.emitCurrentNutSnapshot();

      const dynamicSnapshot = pickSnapshotByFields(
        fullSnapshot,
        this.dynamicFields,
      );
      await this.persistAndBroadcastTelemetry(dynamicSnapshot);
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

  private updateCurrentNutSnapshot(
    dynamicSnapshot: Record<string, string>,
  ): void {
    this.staticSnapshot = {
      ...this.staticSnapshot,
      ...dynamicSnapshot,
    };
  }

  private emitCurrentNutSnapshot(): void {
    this.emitToRenderers(IPC_EVENTS.upsStaticData, {
      values: this.staticSnapshot,
      fields: {
        available: [...this.availableFields],
        static: [...this.staticFields],
        dynamic: [...this.dynamicFields],
      },
    });
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
    const message = `[${context}] Polled ${fieldCount} NUT fields`;

    if (this.shouldLog('trace')) {
      this.log(
        'debug',
        message,
        prettyJson(snapshot),
      );
      return;
    }

    if (this.shouldLog('debug')) {
      this.log('debug', message);
      return;
    }

    this.log('info', message);
  }

  private logMappedTelemetry(values: Record<string, unknown>): void {
    const fieldCount = Object.keys(values).length;
    const message = `Mapped ${fieldCount} telemetry values`;

    if (this.shouldLog('trace')) {
      this.log(
        'debug',
        message,
        prettyJson(values),
      );
      return;
    }

    if (this.shouldLog('debug')) {
      this.log('debug', message);
      return;
    }

    this.log('info', message);
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
      if (payload === undefined) {
        console.error(prefix, message);
      } else {
        console.error(prefix, message, payload);
      }
      return;
    }

    if (level === 'warn') {
      if (payload === undefined) {
        console.warn(prefix, message);
      } else {
        console.warn(prefix, message, payload);
      }
      return;
    }

    if (level === 'info') {
      if (payload === undefined) {
        console.info(prefix, message);
      } else {
        console.info(prefix, message, payload);
      }
      return;
    }

    if (payload === undefined) {
      console.debug(prefix, message);
    } else {
      console.debug(prefix, message, payload);
    }
  }
}

async function readDriverExecutableFromUpsConf(
  folderPath: string,
  upsName: string,
): Promise<string | null> {
  const upsConfPath = path.join(folderPath, 'etc', 'ups.conf');
  let upsConfContent: string;
  try {
    upsConfContent = await fs.readFile(upsConfPath, 'utf8');
  } catch {
    return null;
  }

  return parseDriverExecutableFromUpsConf(upsConfContent, upsName);
}

function parseDriverExecutableFromUpsConf(
  upsConfContent: string,
  upsName: string,
): string | null {
  const normalizedUpsName = upsName.trim().toLowerCase();
  if (!normalizedUpsName) {
    return null;
  }

  let activeSection = '';
  for (const rawLine of upsConfContent.split(/\r?\n/u)) {
    const commentIndex = rawLine.search(/[;#]/u);
    const line =
      (commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      activeSection = sectionMatch[1].trim().toLowerCase();
      continue;
    }

    if (activeSection !== normalizedUpsName) {
      continue;
    }

    const driverMatch = line.match(/^driver\s*=\s*(.+)$/iu);
    if (!driverMatch) {
      continue;
    }

    const driverExecutable = sanitizeDriverExecutable(driverMatch[1]);
    if (driverExecutable) {
      return driverExecutable;
    }
  }

  return null;
}

function sanitizeDriverExecutable(rawValue: string): string | null {
  const normalized = rawValue
    .trim()
    .replace(/^["']|["']$/gu, '')
    .replace(/\.exe$/iu, '');
  if (!normalized) {
    return null;
  }

  if (!/^[a-zA-Z0-9._-]+$/u.test(normalized)) {
    return null;
  }

  return normalized;
}

function formatCommandLineForLog(
  executablePath: string,
  args: string[],
): string {
  const escapedExecutable = quoteCommandLineSegment(executablePath);
  const escapedArgs = args.map(quoteCommandLineSegment).join(' ');
  return escapedArgs ? `${escapedExecutable} ${escapedArgs}` : escapedExecutable;
}

function quoteCommandLineSegment(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatLocalProcessEarlyExitError(
  processLabel: string,
  exitCode: number | null,
  commandLine: string,
  capturedOutput: { stdout: string; stderr: string },
): string {
  const parts = [
    `${processLabel} exited early with code ${String(exitCode)}`,
    `command: ${commandLine}`,
  ];

  if (capturedOutput.stdout) {
    parts.push(`stdout:\n${capturedOutput.stdout}`);
  }
  if (capturedOutput.stderr) {
    parts.push(`stderr:\n${capturedOutput.stderr}`);
  }

  return parts.join('\n');
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

function pickSnapshotByFields(
  source: Record<string, string>,
  fields: Set<string>,
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const fieldName of fields) {
    if (typeof source[fieldName] === 'string') {
      snapshot[fieldName] = source[fieldName];
    }
  }
  return snapshot;
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
