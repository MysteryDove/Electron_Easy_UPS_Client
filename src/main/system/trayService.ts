import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  type NativeImage,
} from 'electron';
import type { AppConfig } from '../config/configSchema';
import type { TelemetryValues } from '../db/telemetryRepository';
import type { ConnectionState } from '../ipc/ipcEvents';
import { t, subscribeToLangChange } from './i18nService';

type BatteryIconBucket = 'empty' | 'low' | 'medium' | 'high' | 'full' | 'disconnected';

const BATTERY_ICON_FILL_RATIO: Record<Exclude<BatteryIconBucket, 'disconnected'>, number> = {
  empty: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  full: 1,
};

const TRAY_ICON_WIDTH = 16;
const TRAY_ICON_HEIGHT = 16;
const warnedKeys = new Set<string>();

export class TrayService {
  private tray: Tray | null = null;
  private readonly iconCache = new Map<string, NativeImage>();
  private upsName = 'UPS';
  private batteryPercent: number | null = null;
  private connectionState: ConnectionState = 'idle';
  private unsubscribeLangChange: (() => void) | null = null;

  /** Tracks OS-level dark mode, independent of the app's themeSource setting. */
  private systemDark = nativeTheme.shouldUseDarkColors;

  private handleThemeUpdated = () => {
    // Only update our cached system dark mode if themeSource is 'system',
    // meaning the event was triggered by an actual OS theme change.
    if (nativeTheme.themeSource === 'system') {
      this.systemDark = nativeTheme.shouldUseDarkColors;
    }
    this.refreshTrayAppearance();
  };

  public start(config: AppConfig): void {
    this.upsName = config.nut.upsName;

    if (this.tray) {
      this.refreshTrayAppearance();
      return;
    }

    nativeTheme.on('updated', this.handleThemeUpdated);

    this.unsubscribeLangChange = subscribeToLangChange(() => {
      this.refreshTrayAppearance();
    });

    this.tray = new Tray(this.getIconForState(this.batteryPercent, this.connectionState));
    this.tray.setContextMenu(this.buildContextMenu());
    this.tray.setToolTip(formatTrayTooltip(this.upsName, this.batteryPercent));
    this.tray.on('double-click', () => {
      this.showMainWindow();
    });
  }

  public stop(): void {
    nativeTheme.off('updated', this.handleThemeUpdated);
    if (this.unsubscribeLangChange) {
      this.unsubscribeLangChange();
    }

    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    this.iconCache.clear();
  }

  public handleConfigUpdated(config: AppConfig): void {
    this.upsName = config.nut.upsName;
    this.refreshTrayAppearance();
  }

  public handleTelemetry(values: TelemetryValues): void {
    const rawBatteryPercent = values.battery_charge_pct;
    if (rawBatteryPercent === undefined) {
      // Ignore partial telemetry payloads that omit battery charge.
      return;
    }

    if (rawBatteryPercent === null) {
      this.updateBatteryPercent(null);
      return;
    }

    if (
      typeof rawBatteryPercent !== 'number' ||
      !Number.isFinite(rawBatteryPercent)
    ) {
      this.updateBatteryPercent(null);
      return;
    }

    this.updateBatteryPercent(rawBatteryPercent);
  }

  public handleConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) {
      return;
    }

    this.connectionState = state;
    this.refreshTrayAppearance();
  }

  private buildContextMenu(): Menu {
    let batteryLabel = t('tray.battery', { percent: formatBatteryPercent(this.batteryPercent) });
    if (this.connectionState !== 'ready') {
      batteryLabel = t('tray.status', { state: this.connectionState });
    }

    return Menu.buildFromTemplate([
      {
        label: batteryLabel,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: t('menu.open'),
        click: () => {
          this.showMainWindow();
        },
      },
      { type: 'separator' },
      {
        label: t('menu.quit'),
        click: () => {
          app.quit();
        },
      },
    ]);
  }

  private showMainWindow(): void {
    const [mainWindow] = BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed(),
    );

    if (!mainWindow) {
      app.emit('activate');
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();
  }

  private updateBatteryPercent(nextPercent: number | null): void {
    const normalized = normalizeBatteryPercent(nextPercent);
    if (this.batteryPercent === normalized) {
      return;
    }

    this.batteryPercent = normalized;
    this.refreshTrayAppearance();
  }

  private refreshTrayAppearance(): void {
    if (!this.tray) {
      return;
    }

    this.tray.setImage(this.getIconForState(this.batteryPercent, this.connectionState));
    this.tray.setToolTip(formatTrayTooltip(this.upsName, this.batteryPercent, this.connectionState));
    this.tray.setContextMenu(this.buildContextMenu());
  }

  private getIconForState(percent: number | null, state: ConnectionState): NativeImage {
    let iconBucket: BatteryIconBucket;
    if (state !== 'ready') {
      iconBucket = 'disconnected';
    } else {
      const normalized = normalizeBatteryPercent(percent);
      iconBucket = resolveBatteryIconBucket(normalized);
    }

    const isDark = this.systemDark;
    const cacheKey = `${iconBucket}-${isDark ? 'dark' : 'light'}`;
    const cachedIcon = this.iconCache.get(cacheKey);
    if (cachedIcon) {
      return cachedIcon;
    }

    const renderedIcon = createGeneratedBatteryIcon(iconBucket, isDark);
    this.iconCache.set(cacheKey, renderedIcon);
    return renderedIcon;
  }
}

function normalizeBatteryPercent(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return clampPercent(Math.round(value));
}

function clampPercent(value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value >= 100) {
    return 100;
  }

  return value;
}

function formatTrayTooltip(
  upsName: string,
  batteryPercent: number | null,
  state?: ConnectionState,
): string {
  if (state && state !== 'ready') {
    return `${upsName} | ${t('tray.status', { state })}`;
  }

  const batteryDisplay = t('tray.battery', { percent: formatBatteryPercent(batteryPercent) });
  return `${upsName} | ${batteryDisplay}`;
}

function formatBatteryPercent(percent: number | null): string {
  if (percent === null) {
    return '--%';
  }

  return `${clampPercent(percent)}%`;
}

function resolveBatteryIconBucket(percent: number | null): BatteryIconBucket {
  if (percent === null) {
    return 'empty';
  }

  if (percent <= 10) {
    return 'empty';
  }

  if (percent <= 35) {
    return 'low';
  }

  if (percent <= 65) {
    return 'medium';
  }

  if (percent <= 90) {
    return 'high';
  }

  return 'full';
}

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) {
    return;
  }

  warnedKeys.add(key);
  console.warn(message);
}

function createGeneratedBatteryIcon(bucket: BatteryIconBucket, isDark: boolean): NativeImage {
  const width = TRAY_ICON_WIDTH;
  const height = TRAY_ICON_HEIGHT;
  const bitmap = Buffer.alloc(width * height * 4, 0);

  if (bucket === 'disconnected') {
    const errorColor = rgba(248, 113, 113, 255); // var(--color-error)
    // Draw a plug or a red X or a slashed line. Let's do a simple red X for "disconnected" / "no wifi".
    // 3px thick red X
    for (let i = 2; i < 14; i += 1) {
      setPixel(bitmap, width, i, i, errorColor);
      setPixel(bitmap, width, i + 1, i, errorColor);
      setPixel(bitmap, width, i, i + 1, errorColor);

      setPixel(bitmap, width, 15 - i, i, errorColor);
      setPixel(bitmap, width, 15 - i + 1, i, errorColor);
      setPixel(bitmap, width, 15 - i, i + 1, errorColor);
    }
  } else {
    const borderColor = isDark ? rgba(235, 235, 245, 255) : rgba(28, 28, 30, 255);
    const bodyBgColor = isDark ? rgba(255, 255, 255, 40) : rgba(49, 49, 52, 255);
    const fillColor = resolveGeneratedFillColor(bucket);

    // Battery body outline
    strokeRect(bitmap, width, height, 1, 4, 11, 8, borderColor);
    // Battery positive terminal
    fillRect(bitmap, width, height, 12, 6, 2, 4, borderColor);
    // Background inside body for contrast
    fillRect(bitmap, width, height, 2, 5, 9, 6, bodyBgColor);

    const fillRatio = BATTERY_ICON_FILL_RATIO[bucket];
    const fillWidth = Math.max(0, Math.min(9, Math.round(9 * fillRatio)));
    if (fillWidth > 0) {
      fillRect(bitmap, width, height, 2, 5, fillWidth, 6, fillColor);
    }
  }

  const image = nativeImage
    .createFromBitmap(bitmap, {
      width,
      height,
      scaleFactor: 1,
    })
    .resize({
      width: TRAY_ICON_WIDTH,
      height: TRAY_ICON_HEIGHT,
      quality: 'best',
    });

  if (image.isEmpty()) {
    warnOnce(
      'generated-icon-failed',
      '[TrayService] Failed to create generated bitmap tray icon.',
    );
  }

  return image;
}

function resolveGeneratedFillColor(bucket: BatteryIconBucket): RGBAColor {
  if (bucket === 'empty') {
    return rgba(255, 75, 75, 255); // Bright red for maximum contrast
  }

  if (bucket === 'low') {
    return rgba(255, 160, 50, 255); // Brighter orange
  }

  if (bucket === 'medium') {
    return rgba(239, 198, 59, 255);
  }

  if (bucket === 'high') {
    return rgba(91, 191, 104, 255);
  }

  return rgba(60, 184, 95, 255);
}

type RGBAColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

function rgba(r: number, g: number, b: number, a: number): RGBAColor {
  return { r, g, b, a };
}

function strokeRect(
  bitmap: Buffer,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGBAColor,
): void {
  fillRect(bitmap, imageWidth, imageHeight, x, y, width, 1, color);
  fillRect(
    bitmap,
    imageWidth,
    imageHeight,
    x,
    y + height - 1,
    width,
    1,
    color,
  );
  fillRect(bitmap, imageWidth, imageHeight, x, y, 1, height, color);
  fillRect(
    bitmap,
    imageWidth,
    imageHeight,
    x + width - 1,
    y,
    1,
    height,
    color,
  );
}

function fillRect(
  bitmap: Buffer,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGBAColor,
): void {
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(imageWidth, x + width);
  const endY = Math.min(imageHeight, y + height);

  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      setPixel(bitmap, imageWidth, column, row, color);
    }
  }
}

function setPixel(
  bitmap: Buffer,
  imageWidth: number,
  x: number,
  y: number,
  color: RGBAColor,
): void {
  const offset = (y * imageWidth + x) * 4;
  // NativeImage bitmap format is BGRA.
  bitmap[offset] = color.b;
  bitmap[offset + 1] = color.g;
  bitmap[offset + 2] = color.r;
  bitmap[offset + 3] = color.a;
}
