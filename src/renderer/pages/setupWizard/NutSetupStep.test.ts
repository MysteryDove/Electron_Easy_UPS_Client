import { describe, expect, it } from 'vitest';
import { localizeUsbHidValidationMessage } from './NutSetupStep';

describe('localizeUsbHidValidationMessage', () => {
  const t = (_key: string, fallback: string, values?: Record<string, string>) => {
    if (!values) {
      return fallback;
    }

    return Object.entries(values).reduce(
      (accumulator, [name, value]) => accumulator.replace(`{{${name}}}`, value),
      fallback,
    );
  };

  it('localizes missing binary message', () => {
    const localized = localizeUsbHidValidationMessage(
      'Missing required USB HID driver binary: bin/usbhid-ups.exe',
      t as never,
    );

    expect(localized).toContain('Missing required USB HID driver binary');
    expect(localized).toContain('bin/usbhid-ups.exe');
  });

  it('prefers incompatible-build wording when issue code says windows build is incompatible', () => {
    const localized = localizeUsbHidValidationMessage(
      'Missing required USB HID driver binary: bin/usbhid-ups.exe or sbin/usbhid-ups.exe',
      t as never,
      'INCOMPATIBLE_WINDOWS_BUILD',
    );

    expect(localized).toContain('not compatible with Windows USB HID setup');
    expect(localized).not.toContain('Missing required USB HID driver binary');
  });

  it('returns null for empty message', () => {
    expect(localizeUsbHidValidationMessage(null, t as never)).toBeNull();
  });
});
