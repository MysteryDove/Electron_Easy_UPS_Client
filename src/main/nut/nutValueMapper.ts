export const TELEMETRY_COLUMNS = [
  'battery_voltage',
  'battery_charge_pct',
  'battery_current',
  'battery_temperature',
  'battery_runtime_sec',
  'input_voltage',
  'input_frequency_hz',
  'input_current',
  'output_voltage',
  'output_frequency_hz',
  'output_current',
  'ups_apparent_power_pct',
  'ups_apparent_power_va',
  'ups_realpower_watts',
  'ups_load_pct',
  'ups_temperature',
  'ups_status_num'
] as const;

export type TelemetryColumn = (typeof TELEMETRY_COLUMNS)[number];

const NUT_FIELD_TO_COLUMN_ENTRIES: ReadonlyArray<[string, TelemetryColumn]> = [
  ['battery.voltage', 'battery_voltage'],
  ['battery.charge', 'battery_charge_pct'],
  ['battery.current', 'battery_current'],
  ['battery.temperature', 'battery_temperature'],
  ['battery.runtime', 'battery_runtime_sec'],
  ['input.voltage', 'input_voltage'],
  ['input.frequency', 'input_frequency_hz'],
  ['input.current', 'input_current'],
  ['output.voltage', 'output_voltage'],
  ['output.frequency', 'output_frequency_hz'],
  ['output.current', 'output_current'],
  ['ups.power.percent', 'ups_apparent_power_pct'],
  ['ups.power', 'ups_apparent_power_va'],
  ['ups.realpower', 'ups_realpower_watts'],
  ['output.realpower', 'ups_realpower_watts'],
  ['ups.load', 'ups_load_pct'],
  ['ups.temperature', 'ups_temperature'],
  ['ups.status', 'ups_status_num'],
];

export const NUT_FIELD_TO_COLUMN: Readonly<Record<string, TelemetryColumn>> =
  Object.freeze(
    NUT_FIELD_TO_COLUMN_ENTRIES.reduce(
      (accumulator, [nutField, column]) => {
        accumulator[nutField] = column;
        return accumulator;
      },
      {} as Record<string, TelemetryColumn>,
    ),
  );

export const KNOWN_DYNAMIC_NUT_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(NUT_FIELD_TO_COLUMN),
);

/**
 * Parse NUT's `ups.status` string into a numeric code.
 * Result: 1 = Online (OL), 0 = On Battery (OB), null = unknown.
 * The value contains flags like "OL", "OB", "OL CHRG", "OB DISCHRG LB", etc.
 */
function parseUpsStatusToNumeric(raw: string): number | null {
  const upper = raw.toUpperCase().trim();
  if (upper.startsWith('OL')) return 1;
  if (upper.startsWith('OB')) return 0;
  return null;
}

export function mapNutValueToNumber(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const valueMatch = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!valueMatch) {
    return null;
  }

  const parsed = Number(valueMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapNutSnapshotToTelemetryColumns(
  snapshot: Record<string, string>,
  customMapping?: Record<string, string>,
): Partial<Record<TelemetryColumn, number | null>> {
  const mapped: Partial<Record<TelemetryColumn, number | null>> = {};

  const effectiveMapping: Record<string, TelemetryColumn> = { ...NUT_FIELD_TO_COLUMN };

  if (customMapping) {
    for (const [col, field] of Object.entries(customMapping)) {
      const column = col as TelemetryColumn;
      if (TELEMETRY_COLUMNS.includes(column) && field) {
        for (const [k, v] of Object.entries(effectiveMapping)) {
          if (v === column) {
            delete effectiveMapping[k];
          }
        }
        effectiveMapping[field] = column;
      }
    }
  }

  for (const [nutField, rawValue] of Object.entries(snapshot)) {
    const column = effectiveMapping[nutField];
    if (!column) {
      continue;
    }

    // Special-case: ups_status_num is parsed from a string status flag, not a number
    if (column === 'ups_status_num') {
      mapped[column] = parseUpsStatusToNumeric(rawValue);
      continue;
    }

    mapped[column] = mapNutValueToNumber(rawValue);
  }

  return mapped;
}

