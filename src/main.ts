import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  bootstrapMainProcess,
  shutdownMainProcess,
} from './main/bootstrap/appBootstrap';
import { configStore } from './main/config/configStore';
import { t } from './main/system/i18nService';

// Set app identity early so Windows toast notifications and taskbar show the correct name.
app.name = 'Easy UPS Client';
if (process.platform === 'win32') {
  app.setAppUserModelId('Easy UPS Client');
}
app.commandLine.appendSwitch('force-color-profile', 'srgb');
let mainWindow: BrowserWindow | null = null;
let startupPromise: Promise<void> | null = null;
let shutdownRequested = false;
let shutdownCompleted = false;
let shutdownPromise: Promise<void> | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function resolveWindowIconPath(): string | undefined {
  if (app.isPackaged) {
    return undefined;
  }

  const candidatePath = path.join(app.getAppPath(), 'assets/icons/app-icon.png');

  if (fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  return undefined;
}

const createWindow = () => {
  const existingWindow = getMainWindow();
  if (existingWindow) {
    focusMainWindow(existingWindow);
    return;
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    autoHideMenuBar: true,
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });


  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on('close', (event) => {
    if (shutdownCompleted) {
      return;
    }

    if (shutdownRequested || isWizardRoute(mainWindow)) {
      event.preventDefault();
      requestGracefulQuit();
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isHttpUrl(url)) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });

  // Uncomment the following line to open DevTools during development:
  // mainWindow.webContents.openDevTools();
};

function showMainWindow(): void {
  const existingWindow = getMainWindow();
  if (existingWindow) {
    focusMainWindow(existingWindow);
    return;
  }

  void showMainWindowWhenReady();
}

function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  return mainWindow;
}

function focusMainWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.focus();
}

async function showMainWindowWhenReady(): Promise<void> {
  await app.whenReady();
  if (startupPromise) {
    try {
      await startupPromise;
    } catch {
      return;
    }
  }

  const existingWindow = getMainWindow();
  if (existingWindow) {
    focusMainWindow(existingWindow);
    return;
  }

  createWindow();
}

function requestGracefulQuit(): void {
  if (shutdownCompleted) {
    app.quit();
    return;
  }

  shutdownRequested = true;
  if (shutdownPromise) {
    return;
  }

  shutdownPromise = (async () => {
    try {
      await shutdownMainProcess();
    } catch (error) {
      console.error('[Main] graceful shutdown failed', error);
    } finally {
      shutdownCompleted = true;
      app.quit();
    }
  })();
}

function shouldStartHiddenToTrayOnLaunch(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const config = configStore.get();
  if (!config.startup.startHiddenToTray) {
    return false;
  }

  return process.argv.includes('--autostart')
    || app.getLoginItemSettings().wasOpenedAtLogin;
}


if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.on('ready', async () => {
    startupPromise = bootstrapMainProcess().then((): void => undefined);

    try {
      await startupPromise;
    } catch (error) {
      console.error('[Main] bootstrap failed', error);
      dialog.showErrorBox(
        t('startup.bootstrapFailedTitle', {
          defaultValue: 'Easy UPS Client startup failed',
        }),
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
      return;
    }

    if (!shouldStartHiddenToTrayOnLaunch()) {
      createWindow();
    }
  });

  app.on('before-quit', (event) => {
    if (shutdownCompleted) {
      return;
    }

    event.preventDefault();
    requestGracefulQuit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    showMainWindow();
  });
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isWizardRoute(window: BrowserWindow | null): boolean {
  if (!window || window.isDestroyed()) {
    return false;
  }

  const currentUrl = window.webContents.getURL();
  if (!currentUrl) {
    return false;
  }

  try {
    const parsed = new URL(currentUrl);
    return parsed.hash === '#/wizard' || parsed.hash.startsWith('#/wizard?');
  } catch {
    return false;
  }
}
