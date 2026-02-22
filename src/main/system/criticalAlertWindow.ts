import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
} from 'electron';

const IPC_CRITICAL_ALERT_DISMISS = 'critical-alert:dismiss';
const IPC_CRITICAL_ALERT_SHUTDOWN = 'critical-alert:shutdown';
const IPC_CRITICAL_ALERT_COUNTDOWN_EXPIRED = 'critical-alert:countdown-expired';

export interface CriticalAlertOptions {
  type?: 'warning' | 'critical';
  title: string;
  body: string;
  batteryPct: number;
  shutdownPct: number;
  showShutdown?: boolean;
  /** When set, shows a live countdown timer. At 0 the shutdown callback fires. */
  shutdownCountdownSeconds?: number;
}

export class CriticalAlertWindow {
  private maskWindows: BrowserWindow[] = [];
  private dialogWindow: BrowserWindow | null = null;
  private showing = false;
  private onShutdownRequested: (() => void) | null = null;

  public get isShowing(): boolean {
    return this.showing;
  }

  public show(
    opts: CriticalAlertOptions,
    onShutdownRequested?: () => void,
  ): void {
    if (this.showing) {
      return;
    }

    this.showing = true;
    this.onShutdownRequested = onShutdownRequested ?? null;

    // Listen for dismiss / shutdown / countdown-expired from the dialog renderer
    ipcMain.once(IPC_CRITICAL_ALERT_DISMISS, this.handleDismiss);
    ipcMain.once(IPC_CRITICAL_ALERT_SHUTDOWN, this.handleShutdown);
    ipcMain.once(IPC_CRITICAL_ALERT_COUNTDOWN_EXPIRED, this.handleShutdown);

    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    // Create a mask window on every display
    for (const display of displays) {
      const mask = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      mask.setAlwaysOnTop(true, 'screen-saver');
      mask.setIgnoreMouseEvents(true);
      mask.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(buildMaskHtml())}`,
      );
      mask.once('ready-to-show', () => {
        mask.showInactive();
      });

      this.maskWindows.push(mask);
    }

    // Create the dialog window, centered on the primary display
    const dialogWidth = 500;
    const dialogHeight = opts.shutdownCountdownSeconds ? 380 : 340;
    const dialogX = Math.round(
      primaryDisplay.bounds.x +
      (primaryDisplay.bounds.width - dialogWidth) / 2,
    );
    const dialogY = Math.round(
      primaryDisplay.bounds.y +
      (primaryDisplay.bounds.height - dialogHeight) / 2,
    );

    this.dialogWindow = new BrowserWindow({
      x: dialogX,
      y: dialogY,
      width: dialogWidth,
      height: dialogHeight,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    this.dialogWindow.setAlwaysOnTop(true, 'screen-saver');

    // Block Alt+F4 / window close
    this.dialogWindow.on('close', (e) => {
      if (this.showing) {
        e.preventDefault();
      }
    });

    this.dialogWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildDialogHtml(opts))}`,
    );

    this.dialogWindow.once('ready-to-show', () => {
      this.dialogWindow?.show();
      this.dialogWindow?.focus();
    });
  }

  public dismiss(): void {
    if (!this.showing) {
      return;
    }

    this.showing = false;
    this.onShutdownRequested = null;

    ipcMain.removeListener(IPC_CRITICAL_ALERT_DISMISS, this.handleDismiss);
    ipcMain.removeListener(IPC_CRITICAL_ALERT_SHUTDOWN, this.handleShutdown);
    ipcMain.removeListener(IPC_CRITICAL_ALERT_COUNTDOWN_EXPIRED, this.handleShutdown);

    for (const mask of this.maskWindows) {
      if (!mask.isDestroyed()) {
        mask.destroy();
      }
    }
    this.maskWindows = [];

    if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
      this.dialogWindow.removeAllListeners('close');
      this.dialogWindow.destroy();
    }
    this.dialogWindow = null;
  }

  private handleDismiss = (_: IpcMainEvent): void => {
    this.dismiss();
  };

  private handleShutdown = (_: IpcMainEvent): void => {
    const cb = this.onShutdownRequested;
    this.dismiss();
    cb?.();
  };
}

// ─── Inline HTML builders ─────────────────────────────────────────────

function buildMaskHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  html, body {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }
</style>
</head>
<body></body>
</html>`;
}

function buildDialogHtml(opts: CriticalAlertOptions): string {
  const showShutdown = opts.showShutdown === true;
  const hasCountdown =
    typeof opts.shutdownCountdownSeconds === 'number' &&
    opts.shutdownCountdownSeconds > 0;
  const countdownSec = opts.shutdownCountdownSeconds ?? 0;

  const isWarning = opts.type === 'warning';
  const alertColor = isWarning ? '#f59e0b' : '#E81123';
  const alertHoverColor = isWarning ? '#d97706' : '#f5232e';

  // Build conditional HTML fragments
  const countdownCss = hasCountdown
    ? `
  .countdown { margin-top: 4px; }
  .countdown-bar-track {
    width: 100%; height: 6px; background: #333;
    border-radius: 3px; overflow: hidden;
  }
  .countdown-bar-fill {
    height: 100%; width: 100%; background: ${alertColor};
    border-radius: 3px; transition: width 1s linear;
  }
  .countdown-text {
    margin-top: 8px; font-size: 13px;
    color: ${isWarning ? '#fcd34d' : '#ff6b6b'}; font-weight: 500;
  }`
    : '';

  const countdownHtml = hasCountdown
    ? `<div class="countdown">
      <div class="countdown-bar-track"><div class="countdown-bar-fill" id="countdown-bar"></div></div>
      <div class="countdown-text">System will shut down in <span id="countdown-seconds">${countdownSec}</span>s</div>
    </div>`
    : '';

  const countdownScript = hasCountdown
    ? `
    var countdownTotal = ${countdownSec};
    var remaining = countdownTotal;
    var secondsEl = document.getElementById('countdown-seconds');
    var barEl = document.getElementById('countdown-bar');
    var btnSecEl = document.getElementById('btn-countdown-seconds');
    var tick = setInterval(function() {
      remaining--;
      if (secondsEl) secondsEl.textContent = String(remaining);
      if (barEl) barEl.style.width = ((remaining / countdownTotal) * 100) + '%';
      if (btnSecEl) btnSecEl.textContent = String(remaining);
      if (remaining <= 0) {
        clearInterval(tick);
        ipcRenderer.send('critical-alert:countdown-expired');
      }
    }, 1000);`
    : '';

  const dismissLabel = hasCountdown ? 'Ignore' : 'Dismiss';
  const shutdownBtnHtml = showShutdown
    ? '<button class="btn-shutdown" id="btn-shutdown">Shut Down Now' + (hasCountdown ? ' (<span id="btn-countdown-seconds">' + countdownSec + '</span>s)' : '') + '</button>'
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', -apple-system, sans-serif;
    background: #1e1e1e; color: #f5f5f5;
    width: 100vw; height: 100vh; overflow: hidden;
    display: flex; flex-direction: column;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.08);
    user-select: none; -webkit-app-region: no-drag;
  }
  .header {
    background: ${alertColor}; padding: 16px 24px;
    display: flex; align-items: center; gap: 12px;
  }
  .header svg { flex-shrink: 0; }
  .header-text { font-size: 16px; font-weight: 600; letter-spacing: 0.3px; }
  .body {
    flex: 1; padding: 28px 24px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .battery-display { display: flex; align-items: center; gap: 16px; }
  .battery-icon {
    width: 64px; height: 32px; border: 3px solid #f5f5f5;
    border-radius: 4px; position: relative;
    display: flex; align-items: center; padding: 3px;
  }
  .battery-icon::after {
    content: ''; position: absolute; right: -8px; top: 50%;
    transform: translateY(-50%); width: 5px; height: 14px;
    background: #f5f5f5; border-radius: 0 2px 2px 0;
  }
  .battery-fill {
    height: 100%; background: ${alertColor}; border-radius: 1px;
    min-width: 2px; transition: width 0.3s;
  }
  .battery-pct { font-size: 36px; font-weight: 700; color: ${alertColor}; line-height: 1; }
  .battery-pct-unit { font-size: 18px; font-weight: 400; color: #aaa; margin-left: 2px; }
  .message { font-size: 14px; line-height: 1.5; color: #ccc; }
  .footer {
    padding: 16px 24px; display: flex;
    justify-content: flex-end; gap: 12px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  button {
    padding: 8px 24px; border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
    font-size: 14px; font-weight: 500; cursor: pointer;
    font-family: inherit; transition: background 0.15s, border-color 0.15s;
  }
  .btn-dismiss { background: #333; color: #f5f5f5; }
  .btn-dismiss:hover { background: #444; border-color: rgba(255,255,255,0.25); }
  .btn-shutdown { background: ${alertColor}; color: #fff; border-color: transparent; }
  .btn-shutdown:hover { background: ${alertHoverColor}; }
  ${countdownCss}
</style>
</head>
<body>
  <div class="header">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <span class="header-text">${escapeHtml(opts.title)}</span>
  </div>
  <div class="body">
    <div class="battery-display">
      <div class="battery-icon">
        <div class="battery-fill" style="width: ${Math.max(0, Math.min(100, opts.batteryPct))}%"></div>
      </div>
      <div>
        <span class="battery-pct">${opts.batteryPct}</span><span class="battery-pct-unit">%</span>
      </div>
    </div>
    <div class="message">${escapeHtml(opts.body)}</div>
    ${countdownHtml}
  </div>
  <div class="footer">
    <button class="btn-dismiss" id="btn-dismiss">${dismissLabel}</button>
    ${shutdownBtnHtml}
  </div>
  <script>
    var ipcRenderer = require('electron').ipcRenderer;
    document.getElementById('btn-dismiss').addEventListener('click', function() {
      ipcRenderer.send('critical-alert:dismiss');
    });
    var sBt = document.getElementById('btn-shutdown');
    if (sBt) {
      sBt.addEventListener('click', function() {
        ipcRenderer.send('critical-alert:shutdown');
      });
    }
    ${countdownScript}
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' || (e.altKey && e.key === 'F4')) {
        e.preventDefault();
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
