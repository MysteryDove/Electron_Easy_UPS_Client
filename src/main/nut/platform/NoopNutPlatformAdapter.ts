import { access } from 'node:fs/promises';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import type { NutPlatformAdapter } from './NutPlatformAdapter';

export class NoopNutPlatformAdapter implements NutPlatformAdapter {
  public async listComPorts(): Promise<string[]> {
    return [];
  }

  public async isNutFolderWritable(folderPath: string): Promise<boolean> {
    try {
      await access(path.join(folderPath, 'etc'), fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async runElevatedPowerShell(_script: string): Promise<void> {
    throw new Error('Elevation is only supported on Windows');
  }
}
