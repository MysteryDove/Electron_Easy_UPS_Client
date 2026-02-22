import { once } from 'node:events';
import net from 'node:net';

type PendingRead = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type NutConnectionOptions = {
  host: string;
  port: number;
  upsName: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
};

export class NutProtocolError extends Error { }

export class NutClient {
  private socket: net.Socket | null = null;
  private buffer = '';
  private queuedLines: string[] = [];
  private pendingReads: PendingRead[] = [];
  private commandChain: Promise<void> = Promise.resolve();
  private timeoutMs = 5000;

  public isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  public async connect(options: NutConnectionOptions): Promise<void> {
    await this.close();

    this.timeoutMs = options.timeoutMs ?? 5000;
    const connectTimeoutMs = this.timeoutMs;

    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });

    socket.setEncoding('utf8');
    this.attachSocketHandlers(socket);

    // Apply a timeout on the TCP connection itself so we don't hang forever
    // when the target host is unreachable / firewalled.
    await this.withTimeout(
      once(socket, 'connect'),
      connectTimeoutMs,
      `TCP connection to ${options.host}:${options.port} timed out after ${connectTimeoutMs}ms`,
      () => {
        // On timeout, destroy the socket so we don't leak it.
        socket.destroy();
      },
    );

    this.socket = socket;

    if (options.username) {
      await this.executeSimpleCommand(
        `USERNAME ${formatCommandToken(options.username)}`,
      );
    }

    if (options.password) {
      await this.executeSimpleCommand(
        `PASSWORD ${formatCommandToken(options.password)}`,
      );
    }

    if (options.username || options.password) {
      await this.executeSimpleCommand(
        `LOGIN ${formatCommandToken(options.upsName)}`,
      );
    }
  }

  public async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.buffer = '';
    this.queuedLines = [];
    this.failPendingReads(new Error('NUT socket closed'));

    if (!socket || socket.destroyed) {
      return;
    }

    socket.end();
    if (!socket.destroyed) {
      // Don't wait forever for close – give it 2 seconds then force-destroy.
      await this.withTimeout(
        once(socket, 'close'),
        2000,
        'Socket close timed out',
        () => {
          socket.destroy();
        },
      ).catch(() => {
        // Ignore close timeout errors; the socket is destroyed anyway.
      });
    }
  }

  public async listVariables(upsName: string): Promise<Record<string, string>> {
    return this.enqueue(async () => {
      await this.writeLine(`LIST VAR ${formatCommandToken(upsName)}`);
      const variables: Record<string, string> = {};

      for (; ;) {
        const line = await this.readLine(this.timeoutMs);
        if (line.startsWith('ERR ')) {
          throw new NutProtocolError(`LIST VAR failed: ${line}`);
        }

        if (line.startsWith('BEGIN LIST VAR')) {
          continue;
        }

        if (line.startsWith('END LIST VAR')) {
          break;
        }

        const parsed = parseVarLine(line);
        if (!parsed || parsed.upsName !== upsName) {
          continue;
        }

        variables[parsed.variableName] = parsed.value;
      }

      return variables;
    });
  }

  public async getVariable(
    upsName: string,
    variableName: string,
  ): Promise<string> {
    return this.enqueue(async () => {
      await this.writeLine(
        `GET VAR ${formatCommandToken(upsName)} ${formatCommandToken(
          variableName,
        )}`,
      );

      const line = await this.readLine(this.timeoutMs);
      if (line.startsWith('ERR ')) {
        throw new NutProtocolError(
          `GET VAR ${variableName} failed with ${line}`,
        );
      }

      const parsed = parseVarLine(line);
      if (!parsed || parsed.upsName !== upsName) {
        throw new NutProtocolError(`Unexpected GET VAR response: ${line}`);
      }

      return parsed.value;
    });
  }

  public async getVariables(
    upsName: string,
    variableNames: string[],
  ): Promise<Record<string, string>> {
    const values: Record<string, string> = {};

    for (const variableName of variableNames) {
      const value = await this.getVariable(upsName, variableName);
      values[variableName] = value;
    }

    return values;
  }

  private async executeSimpleCommand(command: string): Promise<void> {
    await this.enqueue(async () => {
      await this.writeLine(command);
      const line = await this.readLine(this.timeoutMs);
      if (!line.startsWith('OK')) {
        throw new NutProtocolError(`Command "${command}" failed with ${line}`);
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const chained = this.commandChain.then(operation, operation);
    this.commandChain = chained.then(
      (): void => undefined,
      (): void => undefined,
    );
    return chained;
  }

  private attachSocketHandlers(socket: net.Socket): void {
    socket.on('data', (chunk: string | Buffer) => {
      this.buffer += String(chunk);
      this.drainBufferedLines();
    });

    socket.on('error', (error: Error) => {
      this.failPendingReads(error);
    });

    socket.on('close', () => {
      this.failPendingReads(new Error('NUT socket closed'));
    });
  }

  private drainBufferedLines(): void {
    for (; ;) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, '');
      this.pushLine(line);
    }
  }

  private pushLine(line: string): void {
    const pendingRead = this.pendingReads.shift();
    if (!pendingRead) {
      this.queuedLines.push(line);
      return;
    }

    clearTimeout(pendingRead.timer);
    pendingRead.resolve(line);
  }

  private readLine(timeoutMs: number): Promise<string> {
    if (this.queuedLines.length > 0) {
      const line = this.queuedLines.shift();
      if (typeof line === 'string') {
        return Promise.resolve(line);
      }
    }

    if (!this.isConnected()) {
      return Promise.reject(new Error('NUT socket is not connected'));
    }

    return new Promise<string>((resolve, reject) => {
      const read = {} as PendingRead;
      const timer = setTimeout(() => {
        this.pendingReads = this.pendingReads.filter((entry) => entry !== read);
        reject(new Error(`NUT response timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      read.resolve = resolve;
      read.reject = reject;
      read.timer = timer;

      this.pendingReads.push(read);
    });
  }

  private failPendingReads(error: Error): void {
    if (this.pendingReads.length === 0) {
      return;
    }

    for (const read of this.pendingReads) {
      clearTimeout(read.timer);
      read.reject(error);
    }

    this.pendingReads = [];
  }

  private writeLine(command: string): Promise<void> {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('NUT socket is not connected'));
    }

    return new Promise<void>((resolve, reject) => {
      this.socket?.write(`${command}\n`, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  /**
   * Race a promise against a timeout. If the timeout fires first, run the
   * optional `onTimeout` cleanup callback and reject with the given message.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
    onTimeout?: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}

function parseVarLine(
  line: string,
): { upsName: string; variableName: string; value: string } | null {
  const match = line.match(/^VAR\s+(\S+)\s+(\S+)\s+"((?:[^"\\]|\\.)*)"$/);
  if (!match) {
    return null;
  }

  return {
    upsName: match[1],
    variableName: match[2],
    value: unescapeNutValue(match[3]),
  };
}

function unescapeNutValue(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function formatCommandToken(value: string): string {
  if (/^[A-Za-z0-9_.:-]+$/.test(value)) {
    return value;
  }

  const escaped = value.replace(/(["\\])/g, '\\$1');
  return `"${escaped}"`;
}
