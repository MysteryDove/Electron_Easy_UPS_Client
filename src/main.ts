import { app, BrowserWindow, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapMainProcess } from './main/bootstrap/appBootstrap';
import { configStore } from './main/config/configStore';

// Set app identity early so Windows toast notifications and taskbar show the correct name.
app.name = 'Easy UPS Client';
if (process.platform === 'win32') {
  app.setAppUserModelId('Easy UPS Client');
}
app.commandLine.appendSwitch('force-color-profile', 'srgb');
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();
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
    // Keep background polling/tray behavior alive until explicit quit.
    if (isQuitting) {
      return;
    }

    if (isWizardRoute(mainWindow)) {
      isQuitting = true;
      app.quit();
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

function shouldStartHiddenToTrayOnLaunch(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const config = configStore.get();
  if (!config.startup.startHiddenToTray) {
    return false;
  }

  return app.getLoginItemSettings().wasOpenedAtLogin;
}


app.on('ready', async () => {
  try {
    await bootstrapMainProcess();
  } catch (error) {
    console.error('[Main] bootstrap failed', error);
    dialog.showErrorBox(
      'Easy UPS Client startup failed',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
    return;
  }

  if (!shouldStartHiddenToTrayOnLaunch()) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  createWindow();
});

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
