import { describe, expect, it } from 'vitest';
import {
  queryRangePayloadSchema,
  telemetryMinMaxRangePayloadSchema,
  wizardCompletePayloadSchema,
} from './schemas';

describe('shared IPC schemas', () => {
  it('accepts explicit telemetry columns and point limits', () => {
    const payload = queryRangePayloadSchema.parse({
      startIso: '2026-03-06T00:00:00.000Z',
      endIso: '2026-03-06T01:00:00.000Z',
      columns: ['battery_voltage', 'input_voltage'],
      maxPoints: 120,
    });

    expect(payload.columns).toEqual(['battery_voltage', 'input_voltage']);
    expect(payload.maxPoints).toBe(120);
  });

  it('rejects unexpected properties', () => {
    expect(() =>
      telemetryMinMaxRangePayloadSchema.parse({
        startIso: '2026-03-06T00:00:00.000Z',
        endIso: '2026-03-06T01:00:00.000Z',
        extra: true,
      }),
    ).toThrow();
  });

  it('validates wizard completion payloads through one shared schema', () => {
    const payload = wizardCompletePayloadSchema.parse({
      host: '127.0.0.1',
      port: 3493,
      upsName: 'ups',
      launchLocalComponents: true,
      localNutFolderPath: 'C:/nut',
      line: {
        nominalVoltage: 230,
        nominalFrequency: 50,
      },
    });

    expect(payload.launchLocalComponents).toBe(true);
    expect(payload.line?.nominalVoltage).toBe(230);
  });
});
