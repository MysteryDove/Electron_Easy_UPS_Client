export function selectCanPrepareLocalNut(input: {
  isFolderValid: boolean;
  upsNameValid: boolean;
  snmpTargetValid: boolean;
  pollfreqValid: boolean;
  v3Valid: boolean;
  validatingFolder: boolean;
  installStatus: 'idle' | 'installing' | 'success' | 'error';
}): boolean {
  return (
    input.isFolderValid &&
    input.upsNameValid &&
    input.snmpTargetValid &&
    input.pollfreqValid &&
    input.v3Valid &&
    !input.validatingFolder &&
    input.installStatus !== 'installing'
  );
}

export function selectCanPrepareLocalDriver(input: {
  isFolderValid: boolean;
  upsNameValid: boolean;
  driverNameValid: boolean;
  driverPortValid: boolean;
  ttymodeValid: boolean;
  validatingFolder: boolean;
  installStatus: 'idle' | 'installing' | 'success' | 'error';
}): boolean {
  return (
    input.isFolderValid &&
    input.upsNameValid &&
    input.driverNameValid &&
    input.driverPortValid &&
    input.ttymodeValid &&
    !input.validatingFolder &&
    input.installStatus !== 'installing'
  );
}

export function selectCanPrepareLocalUsbHid(input: {
  isFolderValid: boolean;
  upsNameValid: boolean;
  specifyVidPid: boolean;
  normalizedVendorId: string;
  normalizedProductId: string;
  vendorIdValid: boolean;
  productIdValid: boolean;
  validatingFolder: boolean;
  installStatus: 'idle' | 'installing' | 'success' | 'error';
}): boolean {
  const hasValidVidPid =
    !input.specifyVidPid || (
      input.normalizedVendorId.length > 0 &&
      input.normalizedProductId.length > 0 &&
      input.vendorIdValid &&
      input.productIdValid
    );

  return (
    input.isFolderValid &&
    input.upsNameValid &&
    hasValidVidPid &&
    !input.validatingFolder &&
    input.installStatus !== 'installing'
  );
}
