import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export function applyStartWithWindowsSetting(startWithWindows: boolean): void {
  if (process.platform !== 'win32') {
    return;
  }

  // Avoid registering electron.exe as a startup app during development.
  if (!app.isPackaged) {
    return;
  }

  try {
    const appFolder = path.dirname(process.execPath);
    const rootFolder = path.dirname(appFolder);
    const updateExePath = path.join(rootFolder, 'Update.exe');

    if (existsSync(updateExePath)) {
      app.setLoginItemSettings({
        openAtLogin: startWithWindows,
        path: updateExePath,
        args: ['--processStart', `"${path.basename(process.execPath)}"`],
      });
      return;
    }

    app.setLoginItemSettings({ openAtLogin: startWithWindows });
  } catch (error) {
    console.warn(
      '[StartupService] Failed to update Start with Windows setting.',
      error,
    );
  }
}
