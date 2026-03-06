import { execFile, execSync } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { normalizeComPort } from '../../../shared/wizard/validation';
import type { NutPlatformAdapter } from './NutPlatformAdapter';

const execFileAsync = promisify(execFile);

export class WindowsNutPlatformAdapter implements NutPlatformAdapter {
  public async listComPorts(): Promise<string[]> {
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

  public async isNutFolderWritable(folderPath: string): Promise<boolean> {
    console.log(`[nutSetupService] Passive checking folder: ${folderPath}`);

    const isProgramFiles = folderPath.toLowerCase().includes('c:\\program files');
    const isAdmin = await checkIfAdmin();
    if (isProgramFiles && !isAdmin) {
      console.log('[nutSetupService] Path is in Program Files and app is not elevated.');
      return false;
    }

    try {
      const etcPath = path.join(folderPath, 'etc');
      accessSync(etcPath, fsConstants.F_OK);
      accessSync(etcPath, fsConstants.W_OK);
      console.log(`[nutSetupService] Access check passed for: ${etcPath}`);
      return true;
    } catch (error: unknown) {
      const candidate = error as NodeJS.ErrnoException;
      console.log(
        `[nutSetupService] Access check failed: ${candidate.code ?? candidate.message ?? String(error)}`,
      );
      return false;
    }
  }

  public async runElevatedPowerShell(script: string): Promise<void> {
    const payloadScriptPath = path.join(
      os.tmpdir(),
      `easy-ups-nut-setup-payload-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
    );
    const launcherScriptPath = path.join(
      os.tmpdir(),
      `easy-ups-nut-setup-launcher-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
    );

    const payloadScript = [
      '$ErrorActionPreference = "Stop"',
      'try {',
      script,
      '  exit 0',
      '} catch {',
      '  Write-Host ""',
      '  Write-Host "[Easy UPS] Elevated setup script failed." -ForegroundColor Red',
      '  Write-Host $_.Exception.Message -ForegroundColor Red',
      '  if ($_.ScriptStackTrace) {',
      '    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray',
      '  }',
      '  Write-Host ""',
      '  Write-Host "Press any key to continue..." -ForegroundColor Yellow',
      '  try {',
      '    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")',
      '  } catch {',
      '    Read-Host "Press Enter to continue" | Out-Null',
      '  }',
      '  exit 1',
      '}',
      '',
    ].join('\r\n');

    await fs.writeFile(payloadScriptPath, payloadScript, 'utf8');
    const escapedPayloadScriptPath = escapeForSingleQuotedPowerShell(payloadScriptPath);

    const launcherScript = [
      '$ErrorActionPreference = "Stop"',
      `$payloadScriptPath = '${escapedPayloadScriptPath}'`,
      'try {',
      '  $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -WindowStyle Normal -ArgumentList @(',
      "    '-NoProfile',",
      "    '-ExecutionPolicy',",
      "    'Bypass',",
      "    '-File',",
      '    $payloadScriptPath',
      '  )',
      '  if (-not $p) { throw "Failed to launch elevated PowerShell process." }',
      '  exit $p.ExitCode',
      '} catch {',
      '  Write-Error ("Failed to launch elevated process: " + $_.Exception.Message)',
      '  exit 1',
      '}',
      '',
    ].join('\r\n');

    await fs.writeFile(launcherScriptPath, launcherScript, 'utf8');

    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherScriptPath],
        { timeout: 10 * 60 * 1000 },
      );
    } catch (error) {
      throw decorateExecError(error);
    } finally {
      await fs.unlink(payloadScriptPath).catch(() => {
        // Ignore cleanup errors for temp script file.
      });
      await fs.unlink(launcherScriptPath).catch(() => {
        // Ignore cleanup errors for temp script file.
      });
    }
  }
}

async function checkIfAdmin(): Promise<boolean> {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function parseComPortOutput(stdout: string): string[] {
  const deduped = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const normalized = normalizeComPort(line);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return [...deduped].sort(sortComPorts);
}

function sortComPorts(left: string, right: string): number {
  const leftValue = Number(left.replace(/^COM/i, ''));
  const rightValue = Number(right.replace(/^COM/i, ''));
  return leftValue - rightValue;
}

function decorateExecError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  const execError = error as Error & {
    code?: number | string;
    stdout?: string;
    stderr?: string;
  };
  const details: string[] = [error.message];

  if (execError.code !== undefined) {
    details.push(`code: ${String(execError.code)}`);
  }

  if (typeof execError.stderr === 'string' && execError.stderr.trim()) {
    details.push(`stderr: ${execError.stderr.trim()}`);
  }

  if (typeof execError.stdout === 'string' && execError.stdout.trim()) {
    details.push(`stdout: ${execError.stdout.trim()}`);
  }

  return new Error(details.join('\n'));
}

function escapeForSingleQuotedPowerShell(value: string): string {
  return value.replace(/'/g, "''");
}
