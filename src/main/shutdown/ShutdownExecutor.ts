import { exec } from 'node:child_process';
import type {
  ShutdownMethod,
  ShutdownPolicyPlatform,
} from '../../shared/shutdownPolicy/types';

export type ShutdownExecutionResult = {
  method: ShutdownMethod;
  platform: ShutdownPolicyPlatform;
  supported: boolean;
  success: boolean;
  command?: string;
  message?: string;
  errorMessage?: string;
};

export class ShutdownExecutor {
  private shutdownScheduled = false;
  private activeMethod: ShutdownMethod | null = null;

  public isShutdownScheduled(): boolean {
    return this.shutdownScheduled;
  }

  public getActiveMethod(): ShutdownMethod | null {
    return this.activeMethod;
  }

  public async execute(method: ShutdownMethod): Promise<ShutdownExecutionResult> {
    const platform = process.platform as ShutdownPolicyPlatform;
    const command = getShutdownCommand(platform, method);

    if (!command) {
      return {
        method,
        platform,
        supported: false,
        success: false,
        message: `Shutdown method ${method} is not supported on ${platform}.`,
      };
    }

    if (this.shutdownScheduled) {
      if (this.activeMethod === method) {
        return {
          method: this.activeMethod,
          platform,
          supported: true,
          success: true,
          command,
          message: 'Shutdown command is already scheduled.',
        };
      }
      return {
        method: this.activeMethod ?? method,
        platform,
        supported: true,
        success: false,
        command,
        message: `A different shutdown method is already scheduled: ${this.activeMethod}.`,
      };
    }

    this.shutdownScheduled = true;
    this.activeMethod = method;

    try {
      await execCommand(command);
      return {
        method,
        platform,
        supported: true,
        success: true,
        command,
      };
    } catch (error) {
      this.shutdownScheduled = false;
      this.activeMethod = null;
      return {
        method,
        platform,
        supported: true,
        success: false,
        command,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async cancelPending(): Promise<ShutdownExecutionResult> {
    const platform = process.platform as ShutdownPolicyPlatform;
    const method = this.activeMethod ?? 'shutdown';

    if (!this.shutdownScheduled) {
      return {
        method,
        platform,
        supported: true,
        success: true,
        message: 'No shutdown command was scheduled.',
      };
    }

    const command = getCancelCommand(platform, this.activeMethod);
    if (!command) {
      this.shutdownScheduled = false;
      this.activeMethod = null;
      return {
        method,
        platform,
        supported: true,
        success: true,
        message: 'No platform cancellation command is required.',
      };
    }

    try {
      await execCommand(command);
      return {
        method,
        platform,
        supported: true,
        success: true,
        command,
      };
    } catch (error) {
      return {
        method,
        platform,
        supported: true,
        success: false,
        command,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.shutdownScheduled = false;
      this.activeMethod = null;
    }
  }
}

function getShutdownCommand(
  platform: ShutdownPolicyPlatform,
  method: ShutdownMethod,
): string | null {
  if (platform !== 'win32') {
    return null;
  }

  return method === 'sleep'
    ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
    : 'shutdown.exe /s /f /t 0';
}

function getCancelCommand(
  platform: ShutdownPolicyPlatform,
  method: ShutdownMethod | null,
): string | null {
  if (platform === 'win32' && method === 'shutdown') {
    return 'shutdown.exe /a';
  }

  return null;
}

function execCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
