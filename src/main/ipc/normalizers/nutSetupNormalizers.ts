import type {
  NutSetupListSerialDriversPayload,
  NutSetupPrepareLocalDriverPayload,
  NutSetupPrepareLocalNutPayload,
  NutSetupPrepareUsbHidPayload,
  NutSetupValidateFolderPayload,
  SystemOpenExternalPayload,
} from '../ipcChannels';

export function normalizeNutSetupValidatePayload(
  payload: unknown,
): NutSetupValidateFolderPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup validate payload must be an object');
  }

  const candidate = payload as {
    folderPath?: unknown;
    requireUsbHidExperimentalSupport?: unknown;
  };
  if (typeof candidate.folderPath !== 'string' || !candidate.folderPath.trim()) {
    throw new Error('folderPath is required');
  }

  const normalizedPayload: NutSetupValidateFolderPayload = {
    folderPath: candidate.folderPath,
  };

  if (typeof candidate.requireUsbHidExperimentalSupport === 'boolean') {
    normalizedPayload.requireUsbHidExperimentalSupport =
      candidate.requireUsbHidExperimentalSupport;
  }

  return normalizedPayload;
}

export function normalizeNutSetupListSerialDriversPayload(
  payload: unknown,
): NutSetupListSerialDriversPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup list-serial-drivers payload must be an object');
  }

  const candidate = payload as { folderPath?: unknown };
  if (typeof candidate.folderPath !== 'string' || !candidate.folderPath.trim()) {
    throw new Error('folderPath is required');
  }

  return { folderPath: candidate.folderPath };
}

export function normalizeNutSetupPreparePayload(
  payload: unknown,
): NutSetupPrepareLocalNutPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup prepare payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;
  const requiredStringFields: Array<keyof NutSetupPrepareLocalNutPayload> = [
    'folderPath',
    'upsName',
    'port',
    'mibs',
    'community',
  ];

  for (const field of requiredStringFields) {
    if (typeof candidate[field] !== 'string' || !(candidate[field] as string).trim()) {
      throw new Error(`${field} is required`);
    }
  }

  if (
    candidate.snmpVersion !== 'v1' &&
    candidate.snmpVersion !== 'v2c' &&
    candidate.snmpVersion !== 'v3'
  ) {
    throw new Error('snmpVersion must be v1, v2c, or v3');
  }

  if (typeof candidate.pollfreq !== 'number') {
    throw new Error('pollfreq is required');
  }

  const result: NutSetupPrepareLocalNutPayload = {
    folderPath: candidate.folderPath as string,
    upsName: candidate.upsName as string,
    port: candidate.port as string,
    snmpVersion: candidate.snmpVersion,
    mibs: candidate.mibs as string,
    community: candidate.community as string,
    pollfreq: candidate.pollfreq,
  };

  if (
    candidate.secLevel === 'noAuthNoPriv' ||
    candidate.secLevel === 'authNoPriv' ||
    candidate.secLevel === 'authPriv'
  ) {
    result.secLevel = candidate.secLevel;
  }

  if (typeof candidate.secName === 'string') {
    result.secName = candidate.secName;
  }

  if (candidate.authProtocol === 'MD5' || candidate.authProtocol === 'SHA') {
    result.authProtocol = candidate.authProtocol;
  }

  if (typeof candidate.authPassword === 'string') {
    result.authPassword = candidate.authPassword;
  }

  if (candidate.privProtocol === 'DES' || candidate.privProtocol === 'AES') {
    result.privProtocol = candidate.privProtocol;
  }

  if (typeof candidate.privPassword === 'string') {
    result.privPassword = candidate.privPassword;
  }

  return result;
}

export function normalizeNutSetupPrepareDriverPayload(
  payload: unknown,
): NutSetupPrepareLocalDriverPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup prepare-driver payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;
  const requiredStringFields: Array<keyof NutSetupPrepareLocalDriverPayload> = [
    'folderPath',
    'upsName',
    'driver',
    'port',
  ];

  for (const field of requiredStringFields) {
    if (typeof candidate[field] !== 'string' || !(candidate[field] as string).trim()) {
      throw new Error(`${field} is required`);
    }
  }

  const result: NutSetupPrepareLocalDriverPayload = {
    folderPath: candidate.folderPath as string,
    upsName: candidate.upsName as string,
    driver: candidate.driver as string,
    port: candidate.port as string,
  };

  if (typeof candidate.ttymode === 'string' && candidate.ttymode.trim()) {
    result.ttymode = candidate.ttymode;
  }

  return result;
}

export function normalizeNutSetupPrepareUsbHidPayload(
  payload: unknown,
): NutSetupPrepareUsbHidPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('NUT setup prepare-usbhid payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;
  const requiredStringFields: Array<keyof NutSetupPrepareUsbHidPayload> = [
    'folderPath',
    'upsName',
    'port',
  ];

  for (const field of requiredStringFields) {
    if (typeof candidate[field] !== 'string' || !(candidate[field] as string).trim()) {
      throw new Error(`${field} is required`);
    }
  }

  const result: NutSetupPrepareUsbHidPayload = {
    folderPath: candidate.folderPath as string,
    upsName: candidate.upsName as string,
    port: candidate.port as string,
  };

  if (typeof candidate.vendorid === 'string' && candidate.vendorid.trim()) {
    result.vendorid = candidate.vendorid;
  }

  if (typeof candidate.productid === 'string' && candidate.productid.trim()) {
    result.productid = candidate.productid;
  }

  return result;
}

export function normalizeSystemOpenExternalPayload(
  payload: unknown,
): SystemOpenExternalPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('System open-external payload must be an object');
  }

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.url !== 'string' || !candidate.url.trim()) {
    throw new Error('url is required');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate.url);
  } catch {
    throw new Error('url must be a valid absolute URL');
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }

  return { url: parsedUrl.toString() };
}
