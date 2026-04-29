import { z } from 'zod';
import {
  MAX_POLICY_COUNTDOWN_SECONDS,
  MIN_POLICY_COUNTDOWN_SECONDS,
  SHUTDOWN_METHODS,
} from '../../../shared/shutdownPolicy/constants';

const optionalMessageSchema = z.string().trim().min(1).max(500).optional();

export const policyActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('showWarning'),
      message: optionalMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('showCriticalAlert'),
      message: optionalMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('startShutdownCountdown'),
      countdownSeconds: z
        .number()
        .int()
        .min(MIN_POLICY_COUNTDOWN_SECONDS)
        .max(MAX_POLICY_COUNTDOWN_SECONDS),
      method: z.enum(SHUTDOWN_METHODS),
    })
    .strict(),
  z
    .object({
      type: z.literal('shutdownNow'),
      method: z.enum(SHUTDOWN_METHODS),
    })
    .strict(),
  z
    .object({
      type: z.literal('cancelShutdownCountdown'),
    })
    .strict(),
]);
