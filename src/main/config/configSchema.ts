import { z } from 'zod';

const widgetConfigSchema = z
  .object({
    sourceColumn: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    iconKey: z.string().trim().min(1),
    unitOverride: z.string().trim().min(1).optional(),
    colorPreset: z.string().trim().min(1).optional(),
  })
  .strict();

const nutConfigSchema = z
  .object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().min(1).optional(),
    password: z.string().trim().min(1).optional(),
    upsName: z.string().trim().min(1),
    mapping: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const pollingConfigSchema = z
  .object({
    intervalMs: z.number().int().min(500).max(60000),
  })
  .strict();

const dataConfigSchema = z
  .object({
    retentionDays: z.number().int().min(1).max(3650),
  })
  .strict();

const batteryConfigBaseSchema = z
  .object({
    warningPct: z.number().int().min(1).max(100),
    shutdownPct: z.number().int().min(1).max(100),
    warningToastEnabled: z.boolean(),
    shutdownEnabled: z.boolean(),
    criticalAlertEnabled: z.boolean(),
    criticalShutdownAlertEnabled: z.boolean(),
    shutdownCountdownSeconds: z.number().int().min(1).max(300),
    shutdownMethod: z.enum(['sleep', 'shutdown']),
  })
  .strict();

const batteryConfigSchema = batteryConfigBaseSchema.superRefine(
  (batteryConfig, context) => {
    if (batteryConfig.shutdownPct >= batteryConfig.warningPct) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'battery.shutdownPct must be lower than battery.warningPct',
        path: ['shutdownPct'],
      });
    }
  },
);

export const debugLogLevelSchema = z.enum([
  'off',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]);

const debugConfigSchema = z
  .object({
    level: debugLogLevelSchema,
  })
  .strict();

const themeConfigSchema = z
  .object({
    mode: z.enum(['light', 'dark', 'system']),
  })
  .strict();

const i18nConfigSchema = z
  .object({
    locale: z.string().trim().min(1),
  })
  .strict();

const dashboardConfigSchema = z
  .object({
    widgets: z.array(widgetConfigSchema),
  })
  .strict();

const wizardConfigSchema = z
  .object({
    completed: z.boolean(),
  })
  .strict();

const lineConfigSchema = z
  .object({
    nominalVoltage: z.number().min(1).max(500),
    nominalFrequency: z.number().min(1).max(100),
    voltageTolerancePosPct: z.number().min(0).max(100),
    voltageToleranceNegPct: z.number().min(0).max(100),
    frequencyTolerancePosPct: z.number().min(0).max(100),
    frequencyToleranceNegPct: z.number().min(0).max(100),
    alertEnabled: z.boolean(),
    alertCooldownMinutes: z.number().min(1).max(1440),
  })
  .strict();

export const appConfigSchema = z
  .object({
    nut: nutConfigSchema,
    polling: pollingConfigSchema,
    data: dataConfigSchema,
    battery: batteryConfigSchema,
    debug: debugConfigSchema,
    theme: themeConfigSchema,
    i18n: i18nConfigSchema,
    dashboard: dashboardConfigSchema,
    wizard: wizardConfigSchema,
    line: lineConfigSchema,
  })
  .strict();

const appConfigPatchSchema = z
  .object({
    nut: nutConfigSchema.partial().optional(),
    polling: pollingConfigSchema.partial().optional(),
    data: dataConfigSchema.partial().optional(),
    battery: batteryConfigBaseSchema.partial().optional(),
    debug: debugConfigSchema.partial().optional(),
    theme: themeConfigSchema.partial().optional(),
    i18n: i18nConfigSchema.partial().optional(),
    dashboard: dashboardConfigSchema.partial().optional(),
    wizard: wizardConfigSchema.partial().optional(),
    line: lineConfigSchema.partial().optional(),
  })
  .strict();

export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppConfigPatch = z.infer<typeof appConfigPatchSchema>;
export type DebugLogLevel = z.infer<typeof debugLogLevelSchema>;

export const defaultAppConfig: AppConfig = {
  nut: {
    host: '127.0.0.1',
    port: 3493,
    upsName: 'snmpups',
    mapping: {
      battery_voltage: 'battery.voltage',
      battery_charge_pct: 'battery.charge',
      battery_current: 'battery.current',
      input_voltage: 'input.voltage',
      input_frequency_hz: 'input.frequency',
      input_current: 'input.current',
      output_voltage: 'output.voltage',
      output_frequency_hz: 'output.frequency',
      output_current: 'output.current',
      ups_apparent_power_pct: 'ups.power.percent',
      ups_apparent_power_va: 'ups.power',
      ups_realpower_watts: 'ups.realpower',
      ups_load_pct: 'ups.load',
    },
  },
  polling: {
    intervalMs: 6000,
  },
  data: {
    retentionDays: 30,
  },
  battery: {
    warningPct: 40,
    shutdownPct: 20,
    warningToastEnabled: true,
    shutdownEnabled: false,
    criticalAlertEnabled: true,
    criticalShutdownAlertEnabled: true,
    shutdownCountdownSeconds: 45,
    shutdownMethod: 'sleep',
  },
  debug: {
    level: 'info',
  },
  theme: {
    mode: 'system',
  },
  i18n: {
    locale: 'system',
  },
  dashboard: {
    widgets: [],
  },
  wizard: {
    completed: false,
  },
  line: {
    nominalVoltage: 220,
    nominalFrequency: 50,
    voltageTolerancePosPct: 10,
    voltageToleranceNegPct: 10,
    frequencyTolerancePosPct: 1,
    frequencyToleranceNegPct: 1,
    alertEnabled: false,
    alertCooldownMinutes: 5,
  },
};

export function parseConfigPatch(payload: unknown): AppConfigPatch {
  const result = appConfigPatchSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid config patch: ${result.error.message}`);
  }

  return result.data;
}

export function applyConfigPatch(
  current: AppConfig,
  patch: AppConfigPatch,
): AppConfig {
  const merged: AppConfig = {
    nut: patch.nut ? { ...current.nut, ...patch.nut } : current.nut,
    polling: patch.polling
      ? { ...current.polling, ...patch.polling }
      : current.polling,
    data: patch.data ? { ...current.data, ...patch.data } : current.data,
    battery: patch.battery
      ? { ...current.battery, ...patch.battery }
      : current.battery,
    debug: patch.debug ? { ...current.debug, ...patch.debug } : current.debug,
    theme: patch.theme ? { ...current.theme, ...patch.theme } : current.theme,
    i18n: patch.i18n ? { ...current.i18n, ...patch.i18n } : current.i18n,
    dashboard: patch.dashboard
      ? {
        widgets: patch.dashboard.widgets
          ? [...patch.dashboard.widgets]
          : current.dashboard.widgets,
      }
      : current.dashboard,
    wizard: patch.wizard
      ? { ...current.wizard, ...patch.wizard }
      : current.wizard,
    line: patch.line ? { ...current.line, ...patch.line } : current.line,
  };

  return appConfigSchema.parse(merged);
}

export function normalizeStoredConfig(payload: unknown): AppConfig {
  const patchResult = appConfigPatchSchema.safeParse(payload);
  if (!patchResult.success) {
    return defaultAppConfig;
  }

  return applyConfigPatch(defaultAppConfig, patchResult.data);
}
