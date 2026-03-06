import { describe, expect, it } from 'vitest';
import {
  selectCanPrepareLocalDriver,
  selectCanPrepareLocalNut,
  selectCanPrepareLocalUsbHid,
} from './wizardSelectors';

describe('wizard selectors', () => {
  it('gates local NUT prepare', () => {
    expect(selectCanPrepareLocalNut({
      isFolderValid: true,
      upsNameValid: true,
      snmpTargetValid: true,
      pollfreqValid: true,
      v3Valid: true,
      validatingFolder: false,
      installStatus: 'idle',
    })).toBe(true);

    expect(selectCanPrepareLocalNut({
      isFolderValid: true,
      upsNameValid: true,
      snmpTargetValid: true,
      pollfreqValid: true,
      v3Valid: true,
      validatingFolder: false,
      installStatus: 'installing',
    })).toBe(false);
  });

  it('gates serial prepare', () => {
    expect(selectCanPrepareLocalDriver({
      isFolderValid: true,
      upsNameValid: true,
      driverNameValid: true,
      driverPortValid: true,
      ttymodeValid: true,
      validatingFolder: false,
      installStatus: 'idle',
    })).toBe(true);

    expect(selectCanPrepareLocalDriver({
      isFolderValid: true,
      upsNameValid: true,
      driverNameValid: false,
      driverPortValid: true,
      ttymodeValid: true,
      validatingFolder: false,
      installStatus: 'idle',
    })).toBe(false);
  });

  it('requires valid paired VID/PID when enabled', () => {
    expect(selectCanPrepareLocalUsbHid({
      isFolderValid: true,
      upsNameValid: true,
      specifyVidPid: true,
      normalizedVendorId: '051d',
      normalizedProductId: '0002',
      vendorIdValid: true,
      productIdValid: true,
      validatingFolder: false,
      installStatus: 'idle',
    })).toBe(true);

    expect(selectCanPrepareLocalUsbHid({
      isFolderValid: true,
      upsNameValid: true,
      specifyVidPid: true,
      normalizedVendorId: '051d',
      normalizedProductId: '',
      vendorIdValid: true,
      productIdValid: false,
      validatingFolder: false,
      installStatus: 'idle',
    })).toBe(false);
  });
});
