import type { SnmpV3ValidationInput } from './types';

export const UPS_NAME_PATTERN = /^[a-zA-Z0-9-]+$/;
export const IPV4_OCTET_PATTERN = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
export const SNMP_TARGET_PATTERN = new RegExp(
  `^${IPV4_OCTET_PATTERN}(?:\\.${IPV4_OCTET_PATTERN}){3}(?::([1-9]\\d{0,4}))?$`,
);
export const COM_PORT_PATTERN = /^COM\d+$/i;
export const USB_DEVICE_ID_PATTERN = /^[0-9a-f]{4}$/i;

export function isValidUpsName(value: string): boolean {
  return UPS_NAME_PATTERN.test(value);
}

export function isValidSnmpTarget(value: string): boolean {
  if (!value) {
    return false;
  }

  const match = value.trim().match(SNMP_TARGET_PATTERN);
  if (!match) {
    return false;
  }

  if (!match[1]) {
    return true;
  }

  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function normalizeComPort(value: string): string | null {
  const candidate = value.trim().toUpperCase();
  if (!COM_PORT_PATTERN.test(candidate)) {
    return null;
  }
  return candidate;
}

export function normalizeUsbDeviceId(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsbDeviceId(value: string): boolean {
  return USB_DEVICE_ID_PATTERN.test(value);
}

export function hasValidPairedUsbDeviceIds(
  vendorId: string,
  productId: string,
): boolean {
  const normalizedVendorId = normalizeUsbDeviceId(vendorId);
  const normalizedProductId = normalizeUsbDeviceId(productId);

  const hasVendorId = normalizedVendorId.length > 0;
  const hasProductId = normalizedProductId.length > 0;

  if (hasVendorId !== hasProductId) {
    return false;
  }

  if (!hasVendorId) {
    return true;
  }

  return (
    isValidUsbDeviceId(normalizedVendorId) &&
    isValidUsbDeviceId(normalizedProductId)
  );
}

export function isValidPollfreq(value: number): boolean {
  return Number.isInteger(value) && value >= 3 && value <= 15;
}

export function isValidSnmpV3Configuration(input: SnmpV3ValidationInput): boolean {
  if (input.snmpVersion !== 'v3') {
    return true;
  }

  const secNameValid = input.secName.trim().length > 0;
  if (!secNameValid) {
    return false;
  }

  const authRequired = input.secLevel === 'authNoPriv' || input.secLevel === 'authPriv';
  if (authRequired) {
    if (!input.authProtocol || input.authPassword.trim().length === 0) {
      return false;
    }
  }

  const privRequired = input.secLevel === 'authPriv';
  if (privRequired) {
    if (!input.privProtocol || input.privPassword.trim().length === 0) {
      return false;
    }
  }

  return true;
}

