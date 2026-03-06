import { describe, expect, it } from 'vitest';
import {
  normalizeNutSetupPrepareDriverPayload,
  normalizeNutSetupValidatePayload,
  normalizeSystemOpenExternalPayload,
} from './nutSetupNormalizers';

describe('nutSetup normalizers', () => {
  it('normalizes validate payload', () => {
    const result = normalizeNutSetupValidatePayload({
      folderPath: 'C:/nut',
      requireUsbHidExperimentalSupport: true,
    });

    expect(result.folderPath).toBe('C:/nut');
    expect(result.requireUsbHidExperimentalSupport).toBe(true);
  });

  it('rejects invalid prepare-driver payload', () => {
    expect(() => normalizeNutSetupPrepareDriverPayload({})).toThrow('folderPath is required');
  });

  it('accepts https urls only', () => {
    expect(normalizeSystemOpenExternalPayload({ url: 'https://example.com' }).url).toBe('https://example.com/');
    expect(() => normalizeSystemOpenExternalPayload({ url: 'file:///tmp/a' })).toThrow('Only http(s) URLs are allowed');
  });
});
