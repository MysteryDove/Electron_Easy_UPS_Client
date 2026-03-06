import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

export const queryRangePayloadSchema = z
  .object({
    startIso: nonEmptyString,
    endIso: nonEmptyString,
    columns: z.array(nonEmptyString).optional(),
    maxPoints: z.number().finite().optional(),
  })
  .strict();

export const telemetryMinMaxRangePayloadSchema = z
  .object({
    startIso: nonEmptyString,
    endIso: nonEmptyString,
    columns: z.array(nonEmptyString).optional(),
  })
  .strict();

export const wizardTestConnectionPayloadSchema = z
  .object({
    host: nonEmptyString,
    port: z.number(),
    username: nonEmptyString.optional(),
    password: nonEmptyString.optional(),
    upsName: nonEmptyString,
  })
  .strict();

export const wizardCompletePayloadSchema = z
  .object({
    host: nonEmptyString,
    port: z.number(),
    username: nonEmptyString.optional(),
    password: nonEmptyString.optional(),
    upsName: nonEmptyString,
    mapping: z.record(z.string(), z.string()).optional(),
    line: z
      .object({
        nominalVoltage: z.number(),
        nominalFrequency: z.number(),
      })
      .strict()
      .optional(),
    launchLocalComponents: z.boolean().optional(),
    localNutFolderPath: nonEmptyString.optional(),
  })
  .strict();

export const systemOpenExternalPayloadSchema = z
  .object({
    url: nonEmptyString,
  })
  .strict();
