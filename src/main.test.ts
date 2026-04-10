import { beforeEach, describe, expect, it, vi } from 'vitest';

type AppEventHandler = (...args: unknown[]) => unknown;

type MainHarnessOptions = {
  startHiddenToTray?: boolean;
  bootstrapPromise?: Promise<unknown>;
  shutdownPromise?: Promise<void>;
};

type MainHarness = {
  appMock: ReturnType<typeof createAppMock>;
  appHandlers: Map<string, AppEventHandler>;
  bootstrapMainProcess: ReturnType<typeof vi.fn>;
  shutdownMainProcess: ReturnType<typeof vi.fn>;
  BrowserWindowMock: typeof BrowserWindowMockBase;
};

class BrowserWindowMockBase {
  public static instances: BrowserWindowMockBase[] = [];

  public readonly webContents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    getURL: vi.fn(() => 'app://index'),
  };

  private visible = true;

  public constructor(public readonly options: unknown) {
    BrowserWindowMockBase.instances.push(this);
  }

  public static reset(): void {
    BrowserWindowMockBase.instances = [];
  }

  public loadURL = vi.fn();
  public loadFile = vi.fn();
  public on = vi.fn();
  public once = vi.fn();
  public show = vi.fn(() => {
    this.visible = true;
  });
  public hide = vi.fn(() => {
    this.visible = false;
  });
  public focus = vi.fn();
  public restore = vi.fn();
  public isMinimized = vi.fn(() => false);
  public isVisible = vi.fn(() => this.visible);
  public isDestroyed = vi.fn(() => false);
}

function createAppMock() {
  return {
    name: '',
    isPackaged: false,
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    setAppUserModelId: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
    },
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    getLoginItemSettings: vi.fn(() => ({ wasOpenedAtLogin: false })),
    getAppPath: vi.fn(() => 'C:/app'),
  };
}

async function loadMainHarness(options: MainHarnessOptions = {}): Promise<MainHarness> {
  vi.resetModules();
  BrowserWindowMockBase.reset();

  const appHandlers = new Map<string, AppEventHandler>();
  const appMock = createAppMock();
  appMock.on.mockImplementation((event: string, handler: AppEventHandler) => {
    appHandlers.set(event, handler);
    return appMock;
  });

  const bootstrapMainProcess = vi.fn(
    () => options.bootstrapPromise ?? Promise.resolve(undefined),
  );
  const shutdownMainProcess = vi.fn(
    () => options.shutdownPromise ?? Promise.resolve(),
  );

  vi.doMock('electron', () => ({
    app: appMock,
    BrowserWindow: BrowserWindowMockBase,
    dialog: {
      showErrorBox: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
    },
  }));

  vi.doMock('./main/bootstrap/appBootstrap', () => ({
    bootstrapMainProcess,
    shutdownMainProcess,
  }));

  vi.doMock('./main/config/configStore', () => ({
    configStore: {
      get: vi.fn(() => ({
        startup: {
          startHiddenToTray: options.startHiddenToTray ?? false,
        },
      })),
    },
  }));

  (globalThis as { MAIN_WINDOW_VITE_DEV_SERVER_URL?: string }).MAIN_WINDOW_VITE_DEV_SERVER_URL = undefined;
  (globalThis as { MAIN_WINDOW_VITE_NAME?: string }).MAIN_WINDOW_VITE_NAME = 'main_window';

  await import('./main');

  return {
    appMock,
    appHandlers,
    bootstrapMainProcess,
    shutdownMainProcess,
    BrowserWindowMock: BrowserWindowMockBase,
  };
}

describe('main lifecycle wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('boots the main process and creates a window on app ready', async () => {
    const harness = await loadMainHarness();

    const readyHandler = harness.appHandlers.get('ready');
    expect(readyHandler).toBeTypeOf('function');

    await readyHandler?.();

    expect(harness.bootstrapMainProcess).toHaveBeenCalledTimes(1);
    expect(harness.BrowserWindowMock.instances).toHaveLength(1);
    expect(harness.appMock.quit).not.toHaveBeenCalled();
  });

  it('gracefully shuts down only once on repeated before-quit events', async () => {
    let resolveShutdown: (() => void) | null = null;
    const shutdownPromise = new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    });
    const harness = await loadMainHarness({ shutdownPromise });

    const beforeQuitHandler = harness.appHandlers.get('before-quit');
    expect(beforeQuitHandler).toBeTypeOf('function');

    const firstEvent = {
      preventDefault: vi.fn(),
    };
    const secondEvent = {
      preventDefault: vi.fn(),
    };

    beforeQuitHandler?.(firstEvent);
    beforeQuitHandler?.(secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.shutdownMainProcess).toHaveBeenCalledTimes(1);
    expect(harness.appMock.quit).not.toHaveBeenCalled();

    resolveShutdown?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.appMock.quit).toHaveBeenCalledTimes(1);
  });
});