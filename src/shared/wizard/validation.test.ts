import { describe, expect, it } from 'vitest';
import {
  hasValidPairedUsbDeviceIds,
  isValidPollfreq,
  isValidSnmpTarget,
  isValidSnmpV3Configuration,
  isValidUpsName,
  isValidUsbDeviceId,
  normalizeComPort,
  normalizeUsbDeviceId,
} from './validation';

describe('wizard validation', () => {
  it('validates UPS names', () => {
    expect(isValidUpsName('ups-01')).toBe(true);
    expect(isValidUpsName('ups 01')).toBe(false);
  });

  it('validates SNMP targets', () => {
    expect(isValidSnmpTarget('192.168.1.10')).toBe(true);
    expect(isValidSnmpTarget('192.168.1.10:161')).toBe(true);
    expect(isValidSnmpTarget('192.168.1.10:99999')).toBe(false);
  });

  it('normalizes and validates COM ports', () => {
    expect(normalizeComPort('com3')).toBe('COM3');
    expect(normalizeComPort('ttyS0')).toBeNull();
  });

  it('normalizes and validates USB device IDs', () => {
    expect(normalizeUsbDeviceId(' 051D ')).toBe('051d');
    expect(isValidUsbDeviceId('051d')).toBe(true);
    expect(isValidUsbDeviceId('051')).toBe(false);
  });

  it('requires paired USB device IDs', () => {
    expect(hasValidPairedUsbDeviceIds('', '')).toBe(true);
    expect(hasValidPairedUsbDeviceIds('051d', '0002')).toBe(true);
    expect(hasValidPairedUsbDeviceIds('051d', '')).toBe(false);
  });

  it('validates pollfreq bounds', () => {
    expect(isValidPollfreq(3)).toBe(true);
    expect(isValidPollfreq(15)).toBe(true);
    expect(isValidPollfreq(2)).toBe(false);
  });

  it('validates SNMP v3 conditionals', () => {
    expect(isValidSnmpV3Configuration({
      snmpVersion: 'v3',
      secLevel: 'authPriv',
      secName: 'user',
      authProtocol: 'SHA',
      authPassword: 'authpass',
      privProtocol: 'AES',
      privPassword: 'privpass',
    })).toBe(true);

    expect(isValidSnmpV3Configuration({
      snmpVersion: 'v3',
      secLevel: 'authPriv',
      secName: 'user',
      authProtocol: 'SHA',
      authPassword: 'authpass',
      privProtocol: 'AES',
      privPassword: '',
    })).toBe(false);
  });
});
