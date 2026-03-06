import { describe, expect, it, vi } from 'vitest';
import type { DuckDbClient } from './duckdbClient';
import { TelemetryRepository } from './telemetryRepository';

function createDbMock() {
  return {
    all: vi.fn(),
    run: vi.fn(),
  } as unknown as DuckDbClient & {
    all: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
}

describe('TelemetryRepository', () => {
  it('queries only requested columns and honors maxPoints', async () => {
    const db = createDbMock();
    db.all.mockResolvedValue([
      {
        ts: '2026-03-06T00:00:00.000Z',
        battery_voltage: 12.4,
      },
    ]);

    const repository = new TelemetryRepository(db);
    const result = await repository.queryRange({
      startIso: '2026-03-06T00:00:00.000Z',
      endIso: '2026-03-06T01:00:00.000Z',
      columns: ['battery_voltage'],
      maxPoints: 25,
    });

    expect(result).toEqual([
      {
        ts: '2026-03-06T00:00:00.000Z',
        values: {
          battery_voltage: 12.4,
        },
      },
    ]);

    expect(db.all).toHaveBeenCalledTimes(1);
    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('battery_voltage');
    expect(sql).not.toContain('input_voltage');
    expect(params).toEqual([
      new Date('2026-03-06T00:00:00.000Z'),
      new Date('2026-03-06T01:00:00.000Z'),
      25,
      25,
      25,
    ]);
  });

  it('limits min/max aggregation to the selected columns', async () => {
    const db = createDbMock();
    db.all.mockResolvedValue([
      {
        min_input_voltage: 218,
        max_input_voltage: 231,
      },
    ]);

    const repository = new TelemetryRepository(db);
    const result = await repository.getMinMaxForRange({
      startIso: '2026-03-06T00:00:00.000Z',
      endIso: '2026-03-06T01:00:00.000Z',
      columns: ['input_voltage'],
    });

    expect(result).toEqual({
      input_voltage: {
        min: 218,
        max: 231,
      },
    });

    expect(db.all).toHaveBeenCalledTimes(1);
    const [sql] = db.all.mock.calls[0];
    expect(sql).toContain('MIN(input_voltage)');
    expect(sql).toContain('MAX(input_voltage)');
    expect(sql).not.toContain('MIN(output_voltage)');
  });
});
