export type TestStatus = 'idle' | 'testing' | 'success' | 'error';
export type InstallStatus = 'idle' | 'installing' | 'success' | 'error';
export type WizardStep = 'choose' | 'nutSetup' | 'connect' | 'map' | 'line';
export type SetupMode = 'directNut' | 'snmpSetup' | 'serialSetup';
export type SnmpVersion = 'v1' | 'v2c' | 'v3';
export type SecLevel = 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
export type AuthProtocol = 'MD5' | 'SHA';
export type PrivProtocol = 'DES' | 'AES';
