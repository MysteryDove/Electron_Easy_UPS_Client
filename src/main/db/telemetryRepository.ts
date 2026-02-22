import { type DuckDbParam, DuckDbClient, UPS_TELEMETRY_TABLE } from './duckdbClient';
import {
  mapNutSnapshotToTelemetryColumns,
  TELEMETRY_COLUMNS,
  type TelemetryColumn,
} from '../nut/nutValueMapper';

export type TelemetryValues = Partial<Record<TelemetryColumn, number | null>>;

export type TelemetryDataPoint = {
  ts: string;
  values: TelemetryValues;
};

export type QueryRangePayload = {
  startIso: string;
  endIso: string;
  columns?: TelemetryColumn[];
  maxPoints?: number;
};

type TelemetrySqlRow = {
  ts: Date | string;
} & Partial<Record<TelemetryColumn, number | null>>;

export class TelemetryRepository {
  private readonly db: DuckDbClient;

  public constructor(dbClient: DuckDbClient) {
    this.db = dbClient;
  }

  public getAvailableColumns(): TelemetryColumn[] {
    return [...TELEMETRY_COLUMNS];
  }

  public async insertFromNutSnapshot(
    timestamp: Date,
    snapshot: Record<string, string>,
    customMapping?: Record<string, string>,
  ): Promise<TelemetryValues> {
    const values = mapNutSnapshotToTelemetryColumns(snapshot, customMapping);
    if (Object.keys(values).length === 0) {
      return values;
    }

    await this.insertTelemetryPoint(timestamp, values);
    return values;
  }

  public async insertTelemetryPoint(
    timestamp: Date,
    values: TelemetryValues,
  ): Promise<void> {
    const columnsSql = ['ts', ...TELEMETRY_COLUMNS].join(', ');
    const placeholdersSql = ['?', ...TELEMETRY_COLUMNS.map(() => '?')].join(', ');
    const updateSql = TELEMETRY_COLUMNS.map(
      (column) => `${column}=excluded.${column}`,
    ).join(', ');

    const params: DuckDbParam[] = [
      timestamp,
      ...TELEMETRY_COLUMNS.map((column) => {
        const value = values[column];
        return typeof value === 'number' && Number.isFinite(value)
          ? value
          : null;
      }),
    ];

    await this.db.run(
      `
      INSERT INTO ${UPS_TELEMETRY_TABLE} (${columnsSql})
      VALUES (${placeholdersSql})
      ON CONFLICT (ts) DO UPDATE SET ${updateSql}
      `,
      params,
    );
  }

  public async getLatestTelemetryPoint(): Promise<TelemetryDataPoint | null> {
    const rows = await this.db.all<TelemetrySqlRow>(
      `
      SELECT ts, ${TELEMETRY_COLUMNS.join(', ')}
      FROM ${UPS_TELEMETRY_TABLE}
      ORDER BY ts DESC
      LIMIT 1
      `,
    );

    if (rows.length === 0) {
      return null;
    }

    return mapSqlRowToTelemetryDataPoint(rows[0], [...TELEMETRY_COLUMNS] as TelemetryColumn[]);
  }

  public async getMinMaxForRange(
    startIso: string,
    endIso: string,
  ): Promise<Record<string, { min: number | null; max: number | null }>> {
    const start = new Date(startIso);
    const end = new Date(endIso);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Invalid query range timestamps');
    }

    const columns = this.getAvailableColumns();
    const selectParts = columns.map((col) => `MIN(${col}) as min_${col}, MAX(${col}) as max_${col}`);
    const sql = `SELECT ${selectParts.join(', ')} FROM ${UPS_TELEMETRY_TABLE} WHERE ts >= ? AND ts <= ?`;

    const rows = await this.db.all<Record<string, number | null>>(sql, [start, end]);
    const row = rows[0] || {};

    const limits: Record<string, { min: number | null; max: number | null }> = {};
    for (const col of columns) {
      const rawMin = row[`min_${col}`];
      const rawMax = row[`max_${col}`];
      limits[col] = {
        min: rawMin !== null && rawMin !== undefined ? Number(rawMin) : null,
        max: rawMax !== null && rawMax !== undefined ? Number(rawMax) : null,
      };
    }

    return limits;
  }

  public async queryRange(payload: QueryRangePayload): Promise<TelemetryDataPoint[]> {
    const start = new Date(payload.startIso);
    const end = new Date(payload.endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Invalid query range timestamps');
    }

    if (start > end) {
      throw new Error('Query range start must be before end');
    }

    const columns =
      payload.columns && payload.columns.length > 0
        ? payload.columns.filter((column) => TELEMETRY_COLUMNS.includes(column))
        : ([...TELEMETRY_COLUMNS] as TelemetryColumn[]);

    if (columns.length === 0) {
      return [];
    }

    const rows = await this.db.all<TelemetrySqlRow>(
      `
      SELECT ts, ${columns.join(', ')}
      FROM ${UPS_TELEMETRY_TABLE}
      WHERE ts >= ? AND ts <= ?
      ORDER BY ts ASC
      `,
      [start, end],
    );

    const maxPoints = normalizeMaxPoints(payload.maxPoints);
    const sampledRows = sampleRows(rows, maxPoints);
    return sampledRows.map((row) => mapSqlRowToTelemetryDataPoint(row, columns));
  }

  public async deleteOlderThan(cutoffDate: Date): Promise<number> {
    const countRows = await this.db.all<{ count: number }>(
      `
      SELECT COUNT(*) AS count
      FROM ${UPS_TELEMETRY_TABLE}
      WHERE ts < ?
      `,
      [cutoffDate],
    );

    const count = Number(countRows[0]?.count ?? 0);
    if (count <= 0) {
      return 0;
    }

    await this.db.run(
      `
      DELETE FROM ${UPS_TELEMETRY_TABLE}
      WHERE ts < ?
      `,
      [cutoffDate],
    );

    return count;
  }
}

function mapSqlRowToTelemetryDataPoint(
  row: TelemetrySqlRow,
  columns: TelemetryColumn[],
): TelemetryDataPoint {
  const values: TelemetryValues = {};

  for (const column of columns) {
    const rawValue = row[column];
    if (rawValue === null || rawValue === undefined) {
      values[column] = null;
      continue;
    }

    const numeric = Number(rawValue);
    values[column] = Number.isFinite(numeric) ? numeric : null;
  }

  return {
    ts: normalizeTimestamp(row.ts),
    values,
  };
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return String(value);
}

function normalizeMaxPoints(maxPoints: number | undefined): number {
  if (!maxPoints || !Number.isFinite(maxPoints)) {
    return 300;
  }

  const rounded = Math.floor(maxPoints);
  if (rounded < 1) {
    return 1;
  }

  if (rounded > 5000) {
    return 5000;
  }

  return rounded;
}

function sampleRows<T>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) {
    return rows;
  }

  if (maxPoints <= 1) {
    return [rows[rows.length - 1]];
  }

  const sampled: T[] = [];
  const scale = (rows.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round(i * scale);
    sampled.push(rows[index]);
  }

  return sampled;
}
