import { describe, expect, it } from 'vitest';
import {
  buildUsbHidTechnicalDetails,
  hasNoMatchingUsbHidUpsSignal,
} from './usbHidErrors';

describe('usbHidErrors', () => {
  it('detects no matching HID UPS message regardless of casing', () => {
    expect(
      hasNoMatchingUsbHidUpsSignal('stderr: No matching HID UPS found'),
    ).toBe(true);
    expect(
      hasNoMatchingUsbHidUpsSignal('stderr: no MATCHING hid ups FOUND'),
    ).toBe(true);
  });

  it('returns false when no signal is present', () => {
    expect(
      hasNoMatchingUsbHidUpsSignal('driver exited early with code 1'),
    ).toBe(false);
  });

  it('builds merged technical details and trims empty values', () => {
    expect(
      buildUsbHidTechnicalDetails('  first line  ', undefined, '', 'second line'),
    ).toBe('first line\n\nsecond line');
  });
});
