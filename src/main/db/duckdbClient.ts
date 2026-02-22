import { app } from 'electron';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  DuckDBConnection as DuckDbConnectionType,
  DuckDBInstance as DuckDbInstanceType,
} from '@duckdb/node-api';
import { TELEMETRY_COLUMNS } from '../nut/nutValueMapper';

export const UPS_TELEMETRY_TABLE = 'ups_telemetry';

export type DuckDbParam = string | number | null | Date;

type DuckDbNodeApiModule = {
  DuckDBInstance: {
    create: (
      path?: string,
      options?: Record<string, string>,
    ) => Promise<DuckDbInstanceType>;
  };
};

const runtimeRequire = createRequire(__filename);

export class DuckDbClient {
  private instance: DuckDbInstanceType | null = null;
  private connection: DuckDbConnectionType | null = null;
  private readonly dbFilePath: string;

  public constructor(dbFilePath?: string) {
    this.dbFilePath =
      dbFilePath ??
      path.join(app.getPath('userData'), 'data', 'ups_telemetry.duckdb');
  }

  public getPath(): string {
    return this.dbFilePath;
  }

  public async initialize(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.dbFilePath), { recursive: true });
    const { DuckDBInstance } = loadDuckDbNodeApi();
    const instance = await DuckDBInstance.create(this.dbFilePath);
    this.instance = instance;
    this.connection = await instance.connect();
    await this.initializeSchema();
  }

  public async close(): Promise<void> {
    const connection = this.connection;
    const instance = this.instance;
    this.connection = null;
    this.instance = null;

    if (connection) {
      connection.closeSync();
    }

    if (instance) {
      instance.closeSync();
    }
  }

  public run(sql: string, params: DuckDbParam[] = []): Promise<void> {
    const connection = this.requireConnection();
    return connection
      .run(toDuckDbParameterSql(sql), normalizeParams(params))
      .then((): void => undefined);
  }

  public async all<T>(sql: string, params: DuckDbParam[] = []): Promise<T[]> {
    const connection = this.requireConnection();
    const reader = await connection.runAndReadAll(
      toDuckDbParameterSql(sql),
      normalizeParams(params),
    );
    return reader.getRowObjectsJS() as T[];
  }

  private requireConnection(): DuckDbConnectionType {
    if (!this.connection) {
      throw new Error('DuckDB connection has not been initialized');
    }

    return this.connection;
  }

  private async initializeSchema(): Promise<void> {
    const columnDefinitions = TELEMETRY_COLUMNS.map(
      (column) => `${column} DOUBLE`,
    ).join(',\n      ');

    await this.run(`
      CREATE TABLE IF NOT EXISTS ${UPS_TELEMETRY_TABLE} (
        ts TIMESTAMP PRIMARY KEY,
        ${columnDefinitions}
      )
    `);

    // Migrate: add any new columns that don't exist yet in an older DB
    for (const column of TELEMETRY_COLUMNS) {
      try {
        await this.run(
          `ALTER TABLE ${UPS_TELEMETRY_TABLE} ADD COLUMN IF NOT EXISTS ${column} DOUBLE`,
        );
      } catch {
        // Column already exists — ignore
      }
    }
  }
}

function loadDuckDbNodeApi(): DuckDbNodeApiModule {
  return runtimeRequire('@duckdb/node-api') as DuckDbNodeApiModule;
}

function toDuckDbParameterSql(sql: string): string {
  let parameterIndex = 0;
  return sql.replace(/\?/g, () => {
    parameterIndex += 1;
    return `$${parameterIndex}`;
  });
}

function normalizeParams(params: DuckDbParam[]): Array<string | number | null> {
  return params.map((param) =>
    param instanceof Date ? param.toISOString() : param,
  );
}
