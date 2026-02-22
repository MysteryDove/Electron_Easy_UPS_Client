import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { bootstrapMainProcess } from './main/bootstrap/appBootstrap';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Set app identity early so Windows toast notifications and taskbar show the correct name.
app.name = 'Easy UPS Client';
if (process.platform === 'win32') {
  app.setAppUserModelId('Easy UPS Client');
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Uncomment the following line to open DevTools during development:
  // mainWindow.webContents.openDevTools();
};


app.on('ready', async () => {
  try {
    await bootstrapMainProcess();
  } catch (error) {
    console.error('[Main] bootstrap failed', error);
  }

  createWindow();
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


