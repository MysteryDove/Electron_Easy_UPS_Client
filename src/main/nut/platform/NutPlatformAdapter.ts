import { NoopNutPlatformAdapter } from './NoopNutPlatformAdapter';
import { WindowsNutPlatformAdapter } from './WindowsNutPlatformAdapter';

export interface NutPlatformAdapter {
  listComPorts(): Promise<string[]>;
  isNutFolderWritable(folderPath: string): Promise<boolean>;
  runElevatedPowerShell(script: string): Promise<void>;
}

let cachedAdapter: NutPlatformAdapter | null = null;

export function getNutPlatformAdapter(): NutPlatformAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  cachedAdapter = process.platform === 'win32'
    ? new WindowsNutPlatformAdapter()
    : new NoopNutPlatformAdapter();

  return cachedAdapter;
}
