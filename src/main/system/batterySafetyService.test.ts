import { describe, expect, it } from 'vitest';
import { containsFsdToken } from './batterySafetyService';

describe('containsFsdToken', () => {
  it('returns true for bare FSD token (uppercase)', () => {
    expect(containsFsdToken('FSD')).toBe(true);
  });

  it('returns true for lowercase fsd', () => {
    expect(containsFsdToken('fsd')).toBe(true);
  });

  it('returns true for mixed-case Fsd', () => {
    expect(containsFsdToken('Fsd')).toBe(true);
  });

  it('returns true when FSD is one of several tokens', () => {
    expect(containsFsdToken('OB FSD LB')).toBe(true);
  });

  it('returns true for FSD with extra whitespace', () => {
    expect(containsFsdToken('  OB   FSD  ')).toBe(true);
  });

  it('returns false for online status without FSD', () => {
    expect(containsFsdToken('OL')).toBe(false);
  });

  it('returns false for on-battery status without FSD', () => {
    expect(containsFsdToken('OB LB DISCHRG')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsFsdToken('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(containsFsdToken(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(containsFsdToken(null)).toBe(false);
  });

  it('does not match FSD as substring of another token', () => {
    expect(containsFsdToken('NOFSD')).toBe(false);
  });
});
