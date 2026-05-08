import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd: string, cb: (err: Error | null) => void) => cb(null)),
}));

import { exec } from 'node:child_process';
import { ShutdownExecutor } from './ShutdownExecutor';

const execMock = vi.mocked(exec);

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  setPlatform('win32');
  execMock.mockImplementation((_cmd, cb) => {
    (cb as (err: Error | null) => void)(null);
    return {} as ReturnType<typeof exec>;
  });
});

describe('ShutdownExecutor.execute()', () => {
  it('returns unsupported when platform is not win32', async () => {
    setPlatform('linux');
    const executor = new ShutdownExecutor();
    const result = await executor.execute('shutdown');
    expect(result.supported).toBe(false);
    expect(result.success).toBe(false);
  });

  it('executes and returns success on win32', async () => {
    const executor = new ShutdownExecutor();
    const result = await executor.execute('shutdown');
    expect(result.success).toBe(true);
    expect(result.supported).toBe(true);
    expect(result.method).toBe('shutdown');
    expect(execMock).toHaveBeenCalledOnce();
  });

  it('returns success with activeMethod when called again with the same method', async () => {
    const executor = new ShutdownExecutor();
    await executor.execute('shutdown');
    execMock.mockClear();

    const result = await executor.execute('shutdown');
    expect(result.success).toBe(true);
    expect(result.method).toBe('shutdown');
    expect(result.message).toContain('already scheduled');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('returns success: false with the activeMethod when called with a different method', async () => {
    const executor = new ShutdownExecutor();
    await executor.execute('shutdown');
    execMock.mockClear();

    const result = await executor.execute('sleep');
    expect(result.success).toBe(false);
    // method in the result must be the already-active method, not the requested one
    expect(result.method).toBe('shutdown');
    expect(result.message).toContain('shutdown');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('reports the actually active method in the result, not the requested one', async () => {
    const executor = new ShutdownExecutor();
    await executor.execute('sleep');
    execMock.mockClear();

    const result = await executor.execute('shutdown');
    expect(result.method).toBe('sleep');
    expect(result.success).toBe(false);
  });

  it('clears scheduled state on exec failure', async () => {
    execMock.mockImplementationOnce((_cmd, cb) => {
      (cb as (err: Error | null) => void)(new Error('exec failed'));
      return {} as ReturnType<typeof exec>;
    });
    const executor = new ShutdownExecutor();
    const result = await executor.execute('shutdown');
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('exec failed');
    expect(executor.isShutdownScheduled()).toBe(false);
    expect(executor.getActiveMethod()).toBeNull();
  });
});

describe('ShutdownExecutor.cancelPending()', () => {
  it('returns success with no-op message when nothing is scheduled', async () => {
    const executor = new ShutdownExecutor();
    const result = await executor.cancelPending();
    expect(result.success).toBe(true);
    expect(result.message).toContain('No shutdown command was scheduled');
  });

  it('cancels a pending shutdown via shutdown.exe /a on win32', async () => {
    const executor = new ShutdownExecutor();
    await executor.execute('shutdown');
    execMock.mockClear();

    const result = await executor.cancelPending();
    expect(result.success).toBe(true);
    expect(result.command).toContain('shutdown.exe /a');
    expect(executor.isShutdownScheduled()).toBe(false);
    expect(executor.getActiveMethod()).toBeNull();
  });

  it('cancels sleep method without issuing a platform cancel command', async () => {
    const executor = new ShutdownExecutor();
    await executor.execute('sleep');
    execMock.mockClear();

    const result = await executor.cancelPending();
    expect(result.success).toBe(true);
    expect(result.command).toBeUndefined();
    expect(result.message).toContain('No platform cancellation command is required');
    expect(execMock).not.toHaveBeenCalled();
    expect(executor.isShutdownScheduled()).toBe(false);
  });

  it('clears state even when cancel exec fails', async () => {
    const executor = new ShutdownExecutor();
    await executor.execute('shutdown');
    execMock.mockImplementationOnce((_cmd, cb) => {
      (cb as (err: Error | null) => void)(new Error('abort failed'));
      return {} as ReturnType<typeof exec>;
    });

    const result = await executor.cancelPending();
    expect(result.success).toBe(false);
    expect(executor.isShutdownScheduled()).toBe(false);
    expect(executor.getActiveMethod()).toBeNull();
  });
});
