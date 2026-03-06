import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
const setMock = vi.fn();

vi.mock('electron-store', () => ({
  default: class MockStore {
    public get(key: string): unknown {
      return getMock(key);
    }

    public set(key: string, value: unknown): void {
      setMock(key, value);
    }
  },
}));

describe('ConfigStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    getMock.mockReset();
    setMock.mockReset();
    getMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns cached settings without persisting on get', async () => {
    const { ConfigStore } = await import('./configStore');

    setMock.mockClear();
    const store = new ConfigStore();

    expect(setMock).toHaveBeenCalledTimes(1);
    setMock.mockClear();

    const firstRead = store.get();
    const secondRead = store.get();

    expect(firstRead).toEqual(secondRead);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('persists once when updating the cached snapshot', async () => {
    const { ConfigStore } = await import('./configStore');

    setMock.mockClear();
    const store = new ConfigStore();

    setMock.mockClear();
    const updated = store.update({
      polling: { intervalMs: 5000 },
      data: { retentionDays: 60 },
    });

    expect(updated.polling.intervalMs).toBe(5000);
    expect(updated.data.retentionDays).toBe(60);
    expect(store.get().polling.intervalMs).toBe(5000);
    expect(store.get().data.retentionDays).toBe(60);
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({
        polling: expect.objectContaining({ intervalMs: 5000 }),
        data: expect.objectContaining({ retentionDays: 60 }),
      }),
    );
  });
});
