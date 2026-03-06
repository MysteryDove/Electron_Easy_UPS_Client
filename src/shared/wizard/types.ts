export type SharedSnmpVersion = 'v1' | 'v2c' | 'v3';
export type SharedSecLevel = 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
export type SharedAuthProtocol = 'MD5' | 'SHA';
export type SharedPrivProtocol = 'DES' | 'AES';

export type SnmpV3ValidationInput = {
  snmpVersion: SharedSnmpVersion;
  secLevel: SharedSecLevel;
  secName: string;
  authProtocol: SharedAuthProtocol;
  authPassword: string;
  privProtocol: SharedPrivProtocol;
  privPassword: string;
};

