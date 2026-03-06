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
import { IPC_EVENTS, type LocalDriverLaunchIssue } from '../ipc/ipcChannels';
import type { ConnectionState } from '../ipc/ipcEvents';
import { hasNoMatchingUsbHidUpsSignal } from '../../shared/wizard/usbHidErrors';
import { discoverNutCapabilities } from './nutCapabilityDiscovery';
import { NutClient } from './nutClient';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const LOCAL_DRIVER_START_DELAY_MS = 1200;
const LOCAL_UPSD_START_DELAY_MS = 1000;
const DEFAULT_LOCAL_DRIVER_EXECUTABLE = 'snmp-ups';
const MAX_CAPTURED_PROCESS_LOG_LINES = 240;
const MAX_CAPTURED_PROCESS_LOG_LINE_LENGTH = 2000;
const MAX_LOCAL_DRIVER_TECHNICAL_DETAILS_LENGTH = 8000;
const COM_PORT_PATTERN = /^COM\d+$/iu;
const DRIVER_STATE_READY_VALUE = 'quiet';
const UPS_STATUS_WAIT_VALUE = 'WAIT';
const DRIVER_STATE_READY_TIMEOUT_MS = 45 * 1000;
const DRIVER_STATE_WAIT_GRACE_TIMEOUT_MS = 45 * 1000;
const DRIVER_STATE_READY_POLL_INTERVAL_MS = 1000;
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

type UpsConfDriverConfig = {
  driverExecutable: string | null;
  port: string | null;
};

export class NutPollingService {
  private readonly configStore: ConfigStore;
  private readonly telemetryRepository: TelemetryRepository;
  private readonly nutClient: NutClient;
  private readonly telemetryUpdatedListeners = new Set<NutTelemetryUpdatedListener>();
  private readonly connectionStateListeners = new Set<(state: ConnectionState) => void>();
  private currentConfig: AppConfig;
  private debugLogLevel: DebugLogLevel;
  private state: ConnectionState = 'idle';
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private pollInFlight = false;
  private lifecycleTask: Promise<void> = Promise.resolve();
  private localDriverProcess: ChildProcess | null = null;
  private localUpsdProcess: ChildProcess | null = null;
  private localDriverExecutable: string | null = null;
  private localDriverConfiguredPort: string | null = null;
  private localDriverCommandLine: string | null = null;
  private readonly localProcessOutputCapture = new WeakMap<
    ChildProcess,
    LocalProcessOutputCapture
  >();
  private localDriverLaunchIssue: LocalDriverLaunchIssue | null = null;
  private requiresManualDriverRetry = false;
  private availableFields: Set<string> = new Set();
  private staticFields: Set<string> = new Set();
  private dynamicFields: Set<string> = new Set();
  private staticSnapshot: Record<string, string> = {};
  private dynamicSnapshot: Record<string, string> = {};

  public constructor(configStore: ConfigStore, telemetryRepository: TelemetryRepository) {
    this.configStore = configStore;
    this.telemetryRepository = telemetryRepository;
    this.nutClient = new NutClient();
    this.currentConfig = this.configStore.get();
    this.debugLogLevel = this.currentConfig.debug.level;
  }

  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    void this.enqueueLifecycle(() => this.connectAndInitialize());
  }

  public async stop(): Promise<void> {
    this.started = false;
    await this.enqueueLifecycle(async () => {
      this.requiresManualDriverRetry = false;
      this.clearPollTimer();
      this.clearReconnectTimer();
      await this.nutClient.close();
      await this.stopLocalNutProcesses({ forceManagedChildren: true });
      this.setState('idle');
    });
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

    const baseConfig = this.currentConfig;
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

  public getDynamicSnapshot(): Record<string, string> {
    return this.dynamicSnapshot;
  }

  public getLocalDriverLaunchIssue(): LocalDriverLaunchIssue | null {
    return this.localDriverLaunchIssue;
  }

  public async retryLocalDriverLaunchAfterIssue(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.started) {
      return {
        success: false,
        error: 'NUT polling service is not running',
      };
    }

    await this.enqueueLifecycle(async () => {
      this.requiresManualDriverRetry = false;
      this.clearPollTimer();
      this.clearReconnectTimer();
      await this.nutClient.close().catch(() => {
        // Ignore close errors during retry flow.
      });
      await this.stopLocalNutProcesses({ forceManagedChildren: true });
      this.reconnectAttempt = 0;
      this.setState('reconnecting');
      await this.connectAndInitialize();
    });

    if (this.state === 'ready') {
      return { success: true };
    }

    return {
      success: false,
      error:
        this.localDriverLaunchIssue?.summary ??
        'Driver retry failed. Resolve the issue and try again.',
    };
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
    this.currentConfig = nextConfig;
    this.debugLogLevel = nextConfig.debug.level;

    await this.enqueueLifecycle(async () => {
      if (!previousConfig.wizard.completed && nextConfig.wizard.completed) {
        if (!this.started) {
          this.started = true;
        }
        await this.connectAndInitialize();
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
    });
  }

  private async reconnectNow(): Promise<void> {
    this.requiresManualDriverRetry = false;
    this.clearPollTimer();
    this.clearReconnectTimer();
    await this.stopLocalNutProcesses({ forceManagedChildren: true });
    await this.nutClient.close();
    this.reconnectAttempt = 0;
    this.setState('reconnecting');
    await this.connectAndInitialize();
  }

  private async connectAndInitialize(): Promise<void> {
    if (!this.started) {
      return;
    }

    try {
      const config = this.currentConfig;
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
      this.dynamicSnapshot = discoveryResult.initialDynamicSnapshot;
      this.log('debug', 'Capability discovery completed', {
        availableFieldCount: this.availableFields.size,
        staticFieldCount: this.staticFields.size,
        dynamicFieldCount: this.dynamicFields.size,
      });

      if (config.nut.launchLocalComponents) {
        try {
          await this.waitForDriverStateQuiet(config.nut.upsName);
        } catch (error) {
          const technicalDetails = summarizeUnknownError(error);
          const capturedOutput = this.localDriverProcess
            ? this.getCapturedProcessOutput(this.localDriverProcess)
            : { stdout: '', stderr: '' };
          this.setLocalDriverLaunchIssue(
            classifyLocalDriverLaunchIssue({
              driverExecutable: this.localDriverExecutable,
              configuredPort: this.localDriverConfiguredPort,
              commandLine: this.localDriverCommandLine ?? undefined,
              capturedOutput,
              technicalDetails,
              genericFailureSummary:
                isUsbHidDriverExecutable(this.localDriverExecutable)
                  ? 'USB HID driver initialization did not complete during startup.'
                  : `Driver initialization did not reach driver.state=${DRIVER_STATE_READY_VALUE}.`,
            }),
          );
          throw error;
        }
      }

      this.emitStaticSnapshot();
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
      this.setLocalDriverLaunchIssue(null);
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

    const driverConfig = await readDriverConfigFromUpsConf(
      folderPath,
      config.nut.upsName,
    );
    const {
      driverPath,
      driverExecutable,
    } = await this.resolveLocalDriverPath(
      folderPath,
      driverConfig.driverExecutable,
    );
    const driverArgs = ['-a', config.nut.upsName];
    const driverCommandLine = formatCommandLineForLog(driverPath, driverArgs);
    const configuredComPort = normalizeComPortToken(driverConfig.port);
    this.localDriverExecutable = driverExecutable;
    this.localDriverConfiguredPort = configuredComPort;
    this.localDriverCommandLine = driverCommandLine;
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
      if (configuredComPort) {
        const precheck = await detectComPortPresenceForLaunch(configuredComPort);
        if (precheck.exists === false) {
          this.setLocalDriverLaunchIssue({
            code: 'SERIAL_COM_PRECHECK_MISSING',
            summary: `Configured serial port ${configuredComPort} was not found before launching the driver.`,
            occurredAt: new Date().toISOString(),
            signature: `SERIAL_COM_PRECHECK_MISSING:${configuredComPort}:${driverExecutable}`,
            driverExecutable,
            port: configuredComPort,
            commandLine: driverCommandLine,
            technicalDetails: truncateTechnicalDetails(
              formatComPrecheckTechnicalDetails({
                port: configuredComPort,
                detectedPorts: precheck.detectedPorts,
                detectionError: precheck.detectionError,
              }),
            ),
          });

          throw new Error(
            `Configured serial port ${configuredComPort} is not currently available. Reconnect the UPS serial cable and retry.`,
          );
        }
      }

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
          const technicalDetails = formatLocalProcessEarlyExitError(
            driverExecutable,
            driverProcess.exitCode,
            driverCommandLine,
            captured,
          );
          this.setLocalDriverLaunchIssue(
            classifyLocalDriverLaunchIssue({
              driverExecutable,
              configuredPort: configuredComPort,
              commandLine: driverCommandLine,
              capturedOutput: captured,
              technicalDetails,
            }),
          );
          throw new Error(technicalDetails);
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
      this.currentConfig.nut.launchLocalComponents,
    );
    const upsd = this.localUpsdProcess;
    const driver = this.localDriverProcess;
    this.localUpsdProcess = null;
    this.localDriverProcess = null;
    this.localDriverExecutable = null;
    this.localDriverConfiguredPort = null;
    this.localDriverCommandLine = null;

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
    configuredDriverExecutable: string | null,
  ): Promise<{ driverPath: string; driverExecutable: string }> {
    const driverExecutable =
      configuredDriverExecutable ?? DEFAULT_LOCAL_DRIVER_EXECUTABLE;
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
    if (!this.started || this.pollInFlight || this.dynamicFields.size === 0) {
      return;
    }

    this.pollInFlight = true;
    try {
      const config = this.currentConfig;
      this.debugLogLevel = config.debug.level;
      const dynamicSnapshot = await this.nutClient.getVariables(config.nut.upsName, [
        ...this.dynamicFields,
      ]);
      this.logPolledSnapshot(dynamicSnapshot);
      this.updateCurrentNutSnapshot(dynamicSnapshot);
      this.emitCurrentNutSnapshot();
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
    const config = this.currentConfig;
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

    if (this.requiresManualDriverRetry) {
      this.log(
        'warn',
        'Automatic reconnect is paused until user retries local driver launch',
      );
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
      void this.enqueueLifecycle(() => this.connectAndInitialize());
    }, delayMs);
  }

  private setLocalDriverLaunchIssue(issue: LocalDriverLaunchIssue | null): void {
    if (!issue) {
      this.requiresManualDriverRetry = false;
      if (!this.localDriverLaunchIssue) {
        return;
      }

      this.localDriverLaunchIssue = null;
      this.emitToRenderers(IPC_EVENTS.localDriverLaunchIssueChanged, { issue: null });
      return;
    }

    this.requiresManualDriverRetry = true;

    if (issue && this.localDriverLaunchIssue?.signature === issue.signature) {
      return;
    }

    this.localDriverLaunchIssue = issue;
    this.emitToRenderers(IPC_EVENTS.localDriverLaunchIssueChanged, { issue });
  }

  private setState(nextState: ConnectionState): void {
    if (this.state === nextState) {
      return;
    }

    if (nextState === 'ready') {
      this.setLocalDriverLaunchIssue(null);
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
    this.dynamicSnapshot = dynamicSnapshot;
  }

  private emitCurrentNutSnapshot(): void {
    this.emitToRenderers(IPC_EVENTS.upsDynamicData, {
      values: this.dynamicSnapshot,
    });
  }

  private emitStaticSnapshot(): void {
    this.emitToRenderers(IPC_EVENTS.upsStaticData, {
      values: this.staticSnapshot,
      fields: {
        available: [...this.availableFields],
        static: [...this.staticFields],
        dynamic: [...this.dynamicFields],
      },
    });
  }

  private enqueueLifecycle(task: () => Promise<void>): Promise<void> {
    const nextTask = this.lifecycleTask.then(task, task);
    this.lifecycleTask = nextTask.catch(() => {
      // Keep the lifecycle queue usable after failures.
    });
    return nextTask;
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

  private async waitForDriverStateQuiet(upsName: string): Promise<void> {
    const primaryDeadline = Date.now() + DRIVER_STATE_READY_TIMEOUT_MS;
    const absoluteDeadline =
      primaryDeadline + DRIVER_STATE_WAIT_GRACE_TIMEOUT_MS;
    let lastObservation = 'driver.state is unavailable';
    let waitGraceUsed = false;

    while (Date.now() <= absoluteDeadline) {
      let driverStateValue: string | null = null;
      let upsStatusValue: string | null = null;

      try {
        const driverState = await this.nutClient.getVariable(upsName, 'driver.state');
        const normalized = driverState.trim().toLowerCase();
        if (normalized === DRIVER_STATE_READY_VALUE) {
          return;
        }

        driverStateValue = driverState;
        lastObservation = `driver.state=${driverState}`;
      } catch (error) {
        lastObservation = `driver.state query failed (${summarizeUnknownError(error)})`;
      }

      try {
        const upsStatus = await this.nutClient.getVariable(upsName, 'ups.status');
        if (upsStatus.trim()) {
          upsStatusValue = upsStatus.trim();
          if (driverStateValue) {
            lastObservation = `driver.state=${driverStateValue}; ups.status=${upsStatusValue}`;
          } else {
            lastObservation = `ups.status=${upsStatusValue}`;
          }
        }
      } catch {
        // Ignore ups.status read failures; driver.state remains primary signal.
      }

      const statusTokens = (upsStatusValue ?? '')
        .split(/\s+/u)
        .filter(Boolean)
        .map((token) => token.toUpperCase());
      const upsStatusWait = statusTokens.includes(UPS_STATUS_WAIT_VALUE);

      const now = Date.now();
      if (now > primaryDeadline && !upsStatusWait) {
        break;
      }

      if (now > primaryDeadline && upsStatusWait) {
        waitGraceUsed = true;
      }

      const remainingMs = absoluteDeadline - now;
      if (remainingMs <= 0) {
        break;
      }

      await sleep(Math.min(DRIVER_STATE_READY_POLL_INTERVAL_MS, remainingMs));
    }

    throw new Error(
      waitGraceUsed
        ? `Timed out waiting for driver initialization (including ups.status=${UPS_STATUS_WAIT_VALUE} grace). Expected driver.state=${DRIVER_STATE_READY_VALUE}. Last observation: ${lastObservation}`
        : `Timed out waiting for driver initialization. Expected driver.state=${DRIVER_STATE_READY_VALUE}. Last observation: ${lastObservation}`,
    );
  }
}

async function readDriverConfigFromUpsConf(
  folderPath: string,
  upsName: string,
): Promise<UpsConfDriverConfig> {
  const upsConfPath = path.join(folderPath, 'etc', 'ups.conf');
  let upsConfContent: string;
  try {
    upsConfContent = await fs.readFile(upsConfPath, 'utf8');
  } catch {
    return {
      driverExecutable: null,
      port: null,
    };
  }

  return parseDriverConfigFromUpsConf(upsConfContent, upsName);
}

function parseDriverConfigFromUpsConf(
  upsConfContent: string,
  upsName: string,
): UpsConfDriverConfig {
  const normalizedUpsName = upsName.trim().toLowerCase();
  if (!normalizedUpsName) {
    return {
      driverExecutable: null,
      port: null,
    };
  }

  let driverExecutable: string | null = null;
  let port: string | null = null;
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

    if (driverExecutable === null) {
      const driverMatch = line.match(/^driver\s*=\s*(.+)$/iu);
      if (driverMatch) {
        driverExecutable = sanitizeDriverExecutable(driverMatch[1]);
      }
    }

    if (port === null) {
      const portMatch = line.match(/^port\s*=\s*(.+)$/iu);
      if (portMatch) {
        port = sanitizeUpsConfValue(portMatch[1]);
      }
    }

    if (driverExecutable !== null && port !== null) {
      break;
    }
  }

  return {
    driverExecutable,
    port,
  };
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

function sanitizeUpsConfValue(rawValue: string): string | null {
  const sanitized = rawValue
    .trim()
    .replace(/^["']|["']$/gu, '');

  if (!sanitized) {
    return null;
  }

  return sanitized;
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

function classifyLocalDriverLaunchIssue(options: {
  driverExecutable: string | null | undefined;
  configuredPort: string | null;
  commandLine?: string;
  capturedOutput: { stdout: string; stderr: string };
  technicalDetails: string;
  genericFailureSummary?: string;
}): LocalDriverLaunchIssue {
  const driverExecutable = options.driverExecutable ?? DEFAULT_LOCAL_DRIVER_EXECUTABLE;
  const combinedOutput = [
    options.capturedOutput.stdout,
    options.capturedOutput.stderr,
    options.technicalDetails,
  ]
    .filter(Boolean)
    .join('\n');

  if (isUsbHidDriverExecutable(driverExecutable)) {
    const noMatchingUps = hasNoMatchingUsbHidUpsSignal(combinedOutput);
    return {
      code: noMatchingUps
        ? 'USB_HID_UPS_NOT_FOUND'
        : 'USB_HID_DRIVER_LAUNCH_FAILED',
      summary: noMatchingUps
        ? 'No matching USB HID UPS was found.'
        : options.genericFailureSummary ?? 'USB HID driver launch failed during startup.',
      occurredAt: new Date().toISOString(),
      signature: noMatchingUps
        ? `USB_HID_UPS_NOT_FOUND:${driverExecutable}`
        : `USB_HID_DRIVER_LAUNCH_FAILED:${driverExecutable}`,
      driverExecutable,
      commandLine: options.commandLine,
      stdout: options.capturedOutput.stdout || undefined,
      stderr: options.capturedOutput.stderr || undefined,
      technicalDetails: truncateTechnicalDetails(options.technicalDetails),
    };
  }

  const openFailure = detectComOpenFailure(combinedOutput);

  if (openFailure.matched) {
    const resolvedPort = openFailure.port ?? options.configuredPort ?? undefined;
    return {
      code: 'SERIAL_COM_OPEN_FAILED',
      summary: resolvedPort
        ? `Driver failed to open ${resolvedPort}.`
        : 'Driver failed to open the configured COM port.',
      occurredAt: new Date().toISOString(),
      signature: `SERIAL_COM_OPEN_FAILED:${resolvedPort ?? 'unknown'}:${driverExecutable}`,
      driverExecutable,
      port: resolvedPort,
      commandLine: options.commandLine,
      stdout: options.capturedOutput.stdout || undefined,
      stderr: options.capturedOutput.stderr || undefined,
      technicalDetails: truncateTechnicalDetails(options.technicalDetails),
    };
  }

  return {
    code: 'SERIAL_DRIVER_LAUNCH_FAILED',
    summary: options.genericFailureSummary ?? 'Driver launch failed during startup.',
    occurredAt: new Date().toISOString(),
    signature: `SERIAL_DRIVER_LAUNCH_FAILED:${driverExecutable}`,
    driverExecutable,
    port: options.configuredPort ?? undefined,
    commandLine: options.commandLine,
    stdout: options.capturedOutput.stdout || undefined,
    stderr: options.capturedOutput.stderr || undefined,
    technicalDetails: truncateTechnicalDetails(options.technicalDetails),
  };
}

function isUsbHidDriverExecutable(
  driverExecutable: string | null | undefined,
): boolean {
  return sanitizeDriverExecutable(driverExecutable ?? '') === 'usbhid-ups';
}

function detectComOpenFailure(text: string): {
  matched: boolean;
  port: string | null;
} {
  const patterns = [
    /(?:could\s+not|cannot|unable\s+to|failed\s+to)\s+open\s+(com\d+)/iu,
    /cannot\s+open\s+(com\d+)/iu,
    /open\s+(com\d+)\s+failed/iu,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    return {
      matched: true,
      port: normalizeComPortToken(match[1]),
    };
  }

  const genericMatch = /(?:could\s+not|cannot|unable\s+to|failed\s+to)\s+open\s+com/iu.test(
    text,
  );
  return {
    matched: genericMatch,
    port: null,
  };
}

async function detectComPortPresenceForLaunch(port: string): Promise<{
  exists: boolean | null;
  detectedPorts: string[];
  detectionError?: string;
}> {
  if (process.platform !== 'win32') {
    return {
      exists: null,
      detectedPorts: [],
    };
  }

  try {
    const detectedPorts = await listWindowsComPorts();
    return {
      exists: detectedPorts.includes(port),
      detectedPorts,
    };
  } catch (error) {
    return {
      exists: null,
      detectedPorts: [],
      detectionError: summarizeUnknownError(error),
    };
  }
}

async function listWindowsComPorts(): Promise<string[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  const script = '[System.IO.Ports.SerialPort]::GetPortNames()';
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
    {
      windowsHide: true,
      timeout: 10 * 1000,
    },
  );

  return parseComPortOutput(stdout);
}

function parseComPortOutput(stdout: string): string[] {
  const ports = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const normalized = normalizeComPortToken(line);
    if (normalized) {
      ports.add(normalized);
    }
  }

  return [...ports].sort(sortComPorts);
}

function sortComPorts(left: string, right: string): number {
  const leftNum = Number(left.replace(/^COM/iu, ''));
  const rightNum = Number(right.replace(/^COM/iu, ''));
  return leftNum - rightNum;
}

function normalizeComPortToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim().toUpperCase();
  if (!COM_PORT_PATTERN.test(candidate)) {
    return null;
  }

  return candidate;
}

function formatComPrecheckTechnicalDetails(options: {
  port: string;
  detectedPorts: string[];
  detectionError?: string;
}): string {
  const lines = [
    'Serial COM pre-launch check failed.',
    `Configured port: ${options.port}`,
    `Detected COM ports: ${options.detectedPorts.length > 0 ? options.detectedPorts.join(', ') : '(none)'}`,
  ];

  if (options.detectionError) {
    lines.push(`Detection error: ${options.detectionError}`);
  }

  return lines.join('\n');
}

function truncateTechnicalDetails(value: string): string {
  if (value.length <= MAX_LOCAL_DRIVER_TECHNICAL_DETAILS_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_LOCAL_DRIVER_TECHNICAL_DETAILS_LENGTH)}\n...[truncated]`;
}

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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
