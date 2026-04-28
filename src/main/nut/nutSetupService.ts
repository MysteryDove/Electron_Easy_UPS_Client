import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  NutSetupListComPortsResult,
  NutSetupListSerialDriversResult,
  NutSetupPrepareLocalDriverPayload,
  NutSetupPrepareLocalDriverResult,
  NutSetupPrepareLocalNutPayload,
  NutSetupPrepareLocalNutResult,
  NutSetupPrepareUsbHidPayload,
  NutSetupPrepareUsbHidResult,
  NutSetupUsbHidExperimentalIssueCode,
  NutSetupValidateFolderResult,
} from '../ipc/ipcChannels';
import {
  isValidSnmpTarget,
  isValidUpsName,
  isValidUsbDeviceId,
  normalizeComPort,
} from '../../shared/wizard/validation';
import { getNutPlatformAdapter } from './platform/NutPlatformAdapter';

const execFileAsync = promisify(execFile);
const platformAdapter = getNutPlatformAdapter();

const REQUIRED_DIRS = ['etc', 'lib', 'include', 'bin', 'sbin'];
const REQUIRED_FILES = ['sbin/upsd.exe', 'bin/nut.exe'];
const SNMP_DRIVER_RELATIVE_PATH_CANDIDATES = [
  'bin/snmp-ups.exe',
  'sbin/snmp-ups.exe',
];
const USB_HID_DRIVER_RELATIVE_PATH_CANDIDATES = [
  'bin/usbhid-ups.exe',
  'sbin/usbhid-ups.exe',
];
const UPSC_RELATIVE_PATH_CANDIDATES = ['bin/upsc.exe', 'sbin/upsc.exe'];
const SERIAL_DRIVERS = [
  'apcsmart',
  'bcmxcp',
  'belkin',
  'belkinunv',
  'bestfcom',
  'bestfortress',
  'bestuferrups',
  'bestups',
  'bicker_ser',
  'blazer_ser',
  'etapro',
  'everups',
  'gamatronic',
  'genericups',
  'huawei-ups2000',
  'isbmex',
  'ivtscd',
  'liebert',
  'liebert-esp2',
  'liebert-gxe',
  'masterguard',
  'meanwell_ntu',
  'metasys',
  'mge-shut',
  'mge-utalk',
  'microdowell',
  'must_ep2000pro',
  'nhs_ser',
  'nutdrv_hashx',
  'nutdrv_qx',
  'nutdrv_siemens-sitop',
  'oneac',
  'optiups',
  'powercom',
  'powerpanel',
  'powervar_cx_ser',
  'rhino',
  'riello_ser',
  'safenet',
  'solis',
  'tripplite',
  'tripplitesu',
  'upscode2',
  'victronups',
] as const;

const SERIAL_DRIVER_SET = new Set<string>(SERIAL_DRIVERS);
const SERIAL_DRIVER_READY_TIMEOUT_MS = 45 * 1000;
const SERIAL_DRIVER_READY_POLL_INTERVAL_MS = 1000;
const UPSC_QUERY_TIMEOUT_MS = 5 * 1000;
const USB_HID_HELP_TIMEOUT_MS = 10 * 1000;
const UPSC_TARGET_HOST = '127.0.0.1:3493';
const UPS_STATUS_WAIT_TOKEN = 'WAIT';

export async function validateNutFolder(
  folderPath: string,
  options?: {
    requireUsbHidExperimentalSupport?: boolean;
  },
): Promise<NutSetupValidateFolderResult> {
  const requireUsbHidExperimentalSupport =
    options?.requireUsbHidExperimentalSupport === true;
  const missing: string[] = [];
  const normalizedFolder = folderPath.trim();
  let usbHidExperimentalSupport: boolean | undefined;
  let usbHidExperimentalMessage: string | undefined;
  let usbHidExperimentalIssueCode:
    | NutSetupUsbHidExperimentalIssueCode
    | undefined;

  if (!normalizedFolder) {
    const expectedEntries = [
      ...REQUIRED_DIRS.map((entry) => `${entry}/`),
      ...REQUIRED_FILES,
    ];
    if (requireUsbHidExperimentalSupport) {
      expectedEntries.push(
        `${USB_HID_DRIVER_RELATIVE_PATH_CANDIDATES.join(' or ')} (with winhid support)`,
      );
    }
    console.warn(
      '[nutSetupService] validateNutFolder failed: folderPath is empty',
      { expectedEntries },
    );

    if (requireUsbHidExperimentalSupport) {
      usbHidExperimentalSupport = false;
      usbHidExperimentalIssueCode = 'FOLDER_EMPTY';
      usbHidExperimentalMessage =
        'Folder path is empty. Select the extracted official NUT 2.8.5 or newer folder.';
    }

    return {
      valid: false,
      missing: expectedEntries,
      writable: false,
      ...(requireUsbHidExperimentalSupport
        ? {
          usbHidExperimentalSupport,
          usbHidExperimentalMessage,
          usbHidExperimentalIssueCode,
        }
        : {}),
    };
  }

  for (const relativeDir of REQUIRED_DIRS) {
    const exists = await pathExistsAsDirectory(
      path.join(normalizedFolder, relativeDir),
    );
    if (!exists) {
      console.warn(
        `[nutSetupService] validateNutFolder missing required directory: ${relativeDir}/`,
        { folderPath: normalizedFolder },
      );
      missing.push(`${relativeDir}/`);
    }
  }

  for (const relativeFile of REQUIRED_FILES) {
    const exists = await pathExistsAsFile(path.join(normalizedFolder, relativeFile));
    if (!exists) {
      console.warn(
        `[nutSetupService] validateNutFolder missing required file: ${relativeFile}`,
        { folderPath: normalizedFolder },
      );
      missing.push(relativeFile);
    }
  }

  if (missing.length > 0) {
    console.warn(
      '[nutSetupService] validateNutFolder failed: required entries are missing',
      { folderPath: normalizedFolder, missing },
    );

    if (requireUsbHidExperimentalSupport) {
      usbHidExperimentalSupport = false;
      usbHidExperimentalIssueCode = 'FOLDER_INCOMPLETE';
      usbHidExperimentalMessage =
        'NUT folder structure is incomplete. Make sure the extracted folder contains the required files.';
    }

    return {
      valid: false,
      missing,
      writable: false,
      ...(requireUsbHidExperimentalSupport
        ? {
          usbHidExperimentalSupport,
          usbHidExperimentalMessage,
          usbHidExperimentalIssueCode,
        }
        : {}),
    };
  }

  if (requireUsbHidExperimentalSupport) {
    const checkResult = await verifyUsbHidExperimentalSupport(normalizedFolder);
    usbHidExperimentalSupport = checkResult.supported;
    usbHidExperimentalMessage = checkResult.message;
    usbHidExperimentalIssueCode = checkResult.issueCode;

    if (!checkResult.supported) {
      missing.push(
        `${USB_HID_DRIVER_RELATIVE_PATH_CANDIDATES.join(' or ')} with -h output containing "winhid"`,
      );
      console.warn(
        '[nutSetupService] validateNutFolder failed: missing winhid usbhid-ups support',
        {
          folderPath: normalizedFolder,
          message: checkResult.message,
        },
      );
      return {
        valid: false,
        missing,
        writable: false,
        usbHidExperimentalSupport,
        usbHidExperimentalMessage,
        usbHidExperimentalIssueCode,
      };
    }
  }

  const writable = await platformAdapter.isNutFolderWritable(normalizedFolder);
  if (!writable) {
    console.warn(
      '[nutSetupService] validateNutFolder failed: folder is not writable',
      { folderPath: normalizedFolder },
    );
  }

  return {
    valid: true,
    missing,
    writable,
    ...(requireUsbHidExperimentalSupport
      ? {
        usbHidExperimentalSupport,
        usbHidExperimentalMessage,
        usbHidExperimentalIssueCode,
      }
      : {}),
  };
}

export async function prepareLocalNut(
  payload: NutSetupPrepareLocalNutPayload,
): Promise<NutSetupPrepareLocalNutResult> {
  try {
    const normalized = normalizePrepareLocalNutPayload(payload);
    const validationResult = await validateNutFolder(normalized.folderPath);
    if (!validationResult.valid) {
      return {
        success: false,
        error: `Invalid NUT folder structure. Missing: ${validationResult.missing.join(', ')}`,
      };
    }

    const snmpDriverPath = await findFirstExistingRelativeFile(
      normalized.folderPath,
      SNMP_DRIVER_RELATIVE_PATH_CANDIDATES,
    );
    if (!snmpDriverPath) {
      return {
        success: false,
        error: `Missing required driver binary: ${SNMP_DRIVER_RELATIVE_PATH_CANDIDATES.join(' or ')}`,
      };
    }

    await writeNutConfigFilesFromContent({
      folderPath: normalized.folderPath,
      upsConf: buildSnmpUpsConf(normalized),
      requireElevation: !validationResult.writable,
    });
    return { success: true };
  } catch (error) {
    console.error('[nutSetupService] prepareLocalNut failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listSerialDrivers(
  folderPath: string,
): Promise<NutSetupListSerialDriversResult> {
  const normalizedFolder = folderPath.trim();
  if (!normalizedFolder) {
    return { drivers: [] };
  }

  const discoveredDrivers = await Promise.all(
    SERIAL_DRIVERS.map(async (driverName) => {
      const exists = await doesSerialDriverExist(normalizedFolder, driverName);
      return exists ? driverName : null;
    }),
  );

  return {
    drivers: discoveredDrivers
      .filter(
        (
          driverName,
        ): driverName is (typeof SERIAL_DRIVERS)[number] => driverName !== null,
      ),
  };
}

export async function listComPorts(): Promise<NutSetupListComPortsResult> {
  return {
    ports: await platformAdapter.listComPorts(),
  };
}

export async function prepareLocalDriver(
  payload: NutSetupPrepareLocalDriverPayload,
): Promise<NutSetupPrepareLocalDriverResult> {
  try {
    const normalized = normalizePrepareDriverPayload(payload);
    const validationResult = await validateNutFolder(normalized.folderPath);
    if (!validationResult.valid) {
      return {
        success: false,
        error: `Invalid NUT folder structure. Missing: ${validationResult.missing.join(', ')}`,
      };
    }

    const exists = await doesSerialDriverExist(
      normalized.folderPath,
      normalized.driver,
    );
    if (!exists) {
      return {
        success: false,
        error: `Missing required driver binary: bin/${normalized.driver}.exe or sbin/${normalized.driver}.exe`,
      };
    }

    await writeNutConfigFilesFromContent({
      folderPath: normalized.folderPath,
      upsConf: buildDriverUpsConf(normalized),
      requireElevation: !validationResult.writable,
    });
    return { success: true };
  } catch (error) {
    console.error('[nutSetupService] prepareLocalDriver failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function prepareUsbHid(
  payload: NutSetupPrepareUsbHidPayload,
): Promise<NutSetupPrepareUsbHidResult> {
  try {
    const normalized = normalizePrepareUsbHidPayload(payload);
    const validationResult = await validateNutFolder(normalized.folderPath, {
      requireUsbHidExperimentalSupport: true,
    });
    if (!validationResult.valid) {
      return {
        success: false,
        error: validationResult.usbHidExperimentalMessage
          ? `Invalid NUT folder for USB HID setup. ${validationResult.usbHidExperimentalMessage}`
          : `Invalid NUT folder structure. Missing: ${validationResult.missing.join(', ')}`,
      };
    }

    await writeNutConfigFilesFromContent({
      folderPath: normalized.folderPath,
      upsConf: buildUsbHidUpsConf(normalized),
      requireElevation: !validationResult.writable,
    });
    return { success: true };
  } catch (error) {
    console.error('[nutSetupService] prepareUsbHid failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function waitForSerialDriverReady(options: {
  folderPath: string;
  upsName: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const folderPath = options.folderPath?.trim();
  if (!folderPath) {
    throw new Error('folderPath is required to wait for serial driver readiness');
  }

  const upsName = options.upsName?.trim();
  if (!upsName || !isValidUpsName(upsName)) {
    throw new Error('upsName must use letters, numbers, or hyphens');
  }

  const upscPath = await findFirstExistingRelativeFile(
    folderPath,
    UPSC_RELATIVE_PATH_CANDIDATES,
  );
  if (!upscPath) {
    throw new Error(
      `Missing required utility binary: ${UPSC_RELATIVE_PATH_CANDIDATES.join(' or ')}`,
    );
  }

  const timeoutMs =
    Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
      ? Math.floor(Number(options.timeoutMs))
      : SERIAL_DRIVER_READY_TIMEOUT_MS;
  const pollIntervalMs =
    Number.isFinite(options.pollIntervalMs) && Number(options.pollIntervalMs) > 0
      ? Math.floor(Number(options.pollIntervalMs))
      : SERIAL_DRIVER_READY_POLL_INTERVAL_MS;

  const deadline = Date.now() + timeoutMs;
  let lastReason = 'ups.status is not available yet';

  while (Date.now() <= deadline) {
    const probeResult = await probeUpsStatusViaUpsc(upscPath, upsName);
    if (probeResult.status) {
      if (probeResult.status.toUpperCase() !== UPS_STATUS_WAIT_TOKEN) {
        return;
      }
      lastReason = `ups.status is ${UPS_STATUS_WAIT_TOKEN}`;
    } else if (probeResult.reason) {
      lastReason = probeResult.reason;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }

  throw new Error(
    `Timed out waiting for serial driver initialization. Last check: ${lastReason}`,
  );
}

type NormalizedPrepareLocalNutPayload = NutSetupPrepareLocalNutPayload & {
  folderPath: string;
  upsName: string;
  port: string;
  mibs: string;
  community: string;
};

type NormalizedPrepareLocalDriverPayload = NutSetupPrepareLocalDriverPayload & {
  folderPath: string;
  upsName: string;
  driver: string;
  port: string;
  ttymode: string;
};

type NormalizedPrepareUsbHidPayload = NutSetupPrepareUsbHidPayload & {
  folderPath: string;
  upsName: string;
  port: string;
  vendorid?: string;
  productid?: string;
};

function normalizePrepareLocalNutPayload(
  payload: NutSetupPrepareLocalNutPayload,
): NormalizedPrepareLocalNutPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid prepare payload');
  }

  const folderPath = payload.folderPath?.trim();
  if (!folderPath) {
    throw new Error('folderPath is required');
  }

  const upsName = payload.upsName?.trim();
  if (!upsName || !isValidUpsName(upsName)) {
    throw new Error('upsName must use letters, numbers, or hyphens');
  }

  const snmpTarget = payload.port?.trim();
  if (!isValidSnmpTarget(snmpTarget)) {
    throw new Error('port must be a valid IP or IP:port SNMP target');
  }

  const snmpVersion = payload.snmpVersion;
  if (!['v1', 'v2c', 'v3'].includes(snmpVersion)) {
    throw new Error('snmpVersion must be v1, v2c, or v3');
  }

  const pollfreq = Number(payload.pollfreq);
  if (!Number.isInteger(pollfreq) || pollfreq < 3 || pollfreq > 15) {
    throw new Error('pollfreq must be an integer from 3 to 15');
  }

  const mibs = payload.mibs?.trim() || 'auto';
  const community = payload.community?.trim() || 'public';

  if (snmpVersion === 'v3') {
    if (
      !payload.secLevel ||
      !['noAuthNoPriv', 'authNoPriv', 'authPriv'].includes(payload.secLevel)
    ) {
      throw new Error('secLevel is required when snmpVersion is v3');
    }

    if (!payload.secName?.trim()) {
      throw new Error('secName is required when snmpVersion is v3');
    }

    if (payload.secLevel === 'authNoPriv' || payload.secLevel === 'authPriv') {
      if (
        !payload.authProtocol ||
        !['MD5', 'SHA'].includes(payload.authProtocol)
      ) {
        throw new Error('authProtocol is required for authNoPriv/authPriv');
      }
      if (!payload.authPassword?.trim()) {
        throw new Error('authPassword is required for authNoPriv/authPriv');
      }
    }

    if (payload.secLevel === 'authPriv') {
      if (
        !payload.privProtocol ||
        !['DES', 'AES'].includes(payload.privProtocol)
      ) {
        throw new Error('privProtocol is required for authPriv');
      }
      if (!payload.privPassword?.trim()) {
        throw new Error('privPassword is required for authPriv');
      }
    }
  }

  return {
    ...payload,
    folderPath,
    upsName,
    port: snmpTarget,
    mibs,
    community,
    pollfreq,
  };
}

function normalizePrepareDriverPayload(
  payload: NutSetupPrepareLocalDriverPayload,
): NormalizedPrepareLocalDriverPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid driver prepare payload');
  }

  const folderPath = payload.folderPath?.trim();
  if (!folderPath) {
    throw new Error('folderPath is required');
  }

  const upsName = payload.upsName?.trim();
  if (!upsName || !isValidUpsName(upsName)) {
    throw new Error('upsName must use letters, numbers, or hyphens');
  }

  const normalizedDriver = payload.driver?.trim().toLowerCase();
  if (!normalizedDriver || !SERIAL_DRIVER_SET.has(normalizedDriver)) {
    throw new Error('driver is not in the supported serial driver list');
  }

  const port =
    typeof payload.port === 'string' ? normalizeComPort(payload.port) : null;
  if (!port) {
    throw new Error('port must be a COM port value like COM3');
  }

  const ttymode = payload.ttymode?.trim() || 'raw';

  return {
    ...payload,
    folderPath,
    upsName,
    driver: normalizedDriver,
    port,
    ttymode,
  };
}

function normalizePrepareUsbHidPayload(
  payload: NutSetupPrepareUsbHidPayload,
): NormalizedPrepareUsbHidPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid USB HID prepare payload');
  }

  const folderPath = payload.folderPath?.trim();
  if (!folderPath) {
    throw new Error('folderPath is required');
  }

  const upsName = payload.upsName?.trim();
  if (!upsName || !isValidUpsName(upsName)) {
    throw new Error('upsName must use letters, numbers, or hyphens');
  }

  const port = payload.port?.trim().toLowerCase() || 'auto';
  if (port !== 'auto') {
    throw new Error('port must be auto');
  }

  const normalizedVendorId = payload.vendorid?.trim().toLowerCase();
  const normalizedProductId = payload.productid?.trim().toLowerCase();
  const hasVendorId = Boolean(normalizedVendorId);
  const hasProductId = Boolean(normalizedProductId);

  if (hasVendorId !== hasProductId) {
    throw new Error('vendorid and productid must be provided together');
  }

  if (hasVendorId && (!normalizedVendorId || !isValidUsbDeviceId(normalizedVendorId))) {
    throw new Error('vendorid must be 4 hexadecimal characters');
  }

  if (hasProductId && (!normalizedProductId || !isValidUsbDeviceId(normalizedProductId))) {
    throw new Error('productid must be 4 hexadecimal characters');
  }

  return {
    ...payload,
    folderPath,
    upsName,
    port,
    ...(hasVendorId ? { vendorid: normalizedVendorId } : {}),
    ...(hasProductId ? { productid: normalizedProductId } : {}),
  };
}

async function writeNutConfigFilesFromContent(
  options: {
    folderPath: string;
    upsConf: string;
    requireElevation: boolean;
  },
): Promise<void> {
  const upsdConfPath = path.join(options.folderPath, 'etc', 'upsd.conf');
  const upsConfPath = path.join(options.folderPath, 'etc', 'ups.conf');
  const upsdConf = buildUpsdConf();
  const upsConf = options.upsConf;

  if (!options.requireElevation) {
    try {
      await fs.writeFile(upsdConfPath, upsdConf, 'ascii');
      await fs.writeFile(upsConfPath, upsConf, 'ascii');
      return;
    } catch (error) {
      if (!isPermissionError(error)) {
        throw error;
      }
      // Writable checks can be optimistic on some Windows ACL setups.
      // Retry via elevated path so UAC can grant write access.
    }
  }

  const upsdConfBase64 = Buffer.from(upsdConf, 'utf8').toString('base64');
  const upsConfBase64 = Buffer.from(upsConf, 'utf8').toString('base64');

  const elevatedScript = [
    '$ErrorActionPreference = "Stop"',
    `$upsdConf = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${upsdConfBase64}'))`,
    `$upsConf = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${upsConfBase64}'))`,
    `Set-Content -Path '${escapeForSingleQuotedPowerShell(upsdConfPath)}' -Value $upsdConf -Encoding Ascii -Force`,
    `Set-Content -Path '${escapeForSingleQuotedPowerShell(upsConfPath)}' -Value $upsConf -Encoding Ascii -Force`,
  ].join('; ');

  await platformAdapter.runElevatedPowerShell(elevatedScript);
}

function buildUpsdConf(): string {
  return ['LISTEN 127.0.0.1 3493', ''].join('\r\n');
}

function buildSnmpUpsConf(payload: NormalizedPrepareLocalNutPayload): string {
  const lines = [
    `[${payload.upsName}]`,
    '    driver = snmp-ups',
    `    port = ${payload.port}`,
    `    mibs = ${sanitizeConfigValue(payload.mibs)}`,
    `    community = ${sanitizeConfigValue(payload.community)}`,
    `    snmp_version = ${payload.snmpVersion}`,
    `    pollfreq = ${payload.pollfreq}`,
  ];

  if (payload.snmpVersion === 'v3') {
    lines.push(`    secLevel = ${payload.secLevel}`);
    if (payload.secName) {
      lines.push(`    secName = ${sanitizeConfigValue(payload.secName)}`);
    }
    if (payload.authProtocol) {
      lines.push(`    authProtocol = ${payload.authProtocol}`);
    }
    if (payload.authPassword) {
      lines.push(`    authPassword = ${sanitizeConfigValue(payload.authPassword)}`);
    }
    if (payload.privProtocol) {
      lines.push(`    privProtocol = ${payload.privProtocol}`);
    }
    if (payload.privPassword) {
      lines.push(`    privPassword = ${sanitizeConfigValue(payload.privPassword)}`);
    }
  }

  return `${lines.join('\r\n')}\r\n`;
}

function buildDriverUpsConf(payload: NormalizedPrepareLocalDriverPayload): string {
  const lines = [
    `[${payload.upsName}]`,
    `    driver = ${payload.driver}`,
    `    port = ${payload.port}`,
  ];

  if (payload.ttymode) {
    lines.push(`    ttymode = ${sanitizeConfigValue(payload.ttymode)}`);
  }

  return `${lines.join('\r\n')}\r\n`;
}

function buildUsbHidUpsConf(payload: NormalizedPrepareUsbHidPayload): string {
  const lines = [
    `[${payload.upsName}]`,
    '    winhid',
    '    pollonly',
    '    driver = usbhid-ups',
    `    port = ${payload.port}`,
  ];

  if (payload.vendorid && payload.productid) {
    lines.push(`    vendorid = ${payload.vendorid}`);
    lines.push(`    productid = ${payload.productid}`);
  }

  return `${lines.join('\r\n')}\r\n`;
}

async function doesSerialDriverExist(
  folderPath: string,
  driver: string,
): Promise<boolean> {
  return Boolean(
    await findFirstExistingRelativeFile(folderPath, [
      `bin/${driver}.exe`,
      `sbin/${driver}.exe`,
    ]),
  );
}

async function verifyUsbHidExperimentalSupport(folderPath: string): Promise<{
  supported: boolean;
  message: string;
  issueCode?: NutSetupUsbHidExperimentalIssueCode;
}> {
  const usbhidPath = await findFirstExistingRelativeFile(
    folderPath,
    USB_HID_DRIVER_RELATIVE_PATH_CANDIDATES,
  );

  if (!usbhidPath) {
    return {
      supported: false,
      issueCode: 'MISSING_DRIVER_BINARY',
      message: `Missing required USB HID driver binary: ${USB_HID_DRIVER_RELATIVE_PATH_CANDIDATES.join(' or ')}`,
    };
  }

  let output = '';
  try {
    const { stdout, stderr } = await execFileAsync(
      usbhidPath,
      ['-h'],
      {
        windowsHide: true,
        timeout: USB_HID_HELP_TIMEOUT_MS,
      },
    );
    output = `${stdout}\n${stderr}`.trim();
  } catch (error) {
    const execError = error as Error & { stdout?: string; stderr?: string };
    output = `${execError.stdout ?? ''}\n${execError.stderr ?? ''}`.trim();
    if (!output) {
      return {
        supported: false,
        issueCode: 'RUN_HELP_FAILED',
        message: `Found usbhid-ups.exe, but failed to verify Windows HID compatibility via usbhid-ups.exe -h (${summarizeExecFailure(error)})`,
      };
    }
  }

  if (!output.toLowerCase().includes('winhid')) {
    return {
      supported: false,
      issueCode: 'INCOMPATIBLE_WINDOWS_BUILD',
      message:
        'usbhid-ups.exe is present, but this build is not compatible with Windows USB HID setup (missing required "winhid" support).',
    };
  }

  return {
    supported: true,
    message: 'usbhid-ups.exe reports winhid support.',
  };
}

async function probeUpsStatusViaUpsc(
  upscPath: string,
  upsName: string,
): Promise<{ status: string | null; reason?: string }> {
  const target = `${upsName}@${UPSC_TARGET_HOST}`;

  try {
    const { stdout, stderr } = await execFileAsync(
      upscPath,
      [target, 'ups.status'],
      {
        windowsHide: true,
        timeout: UPSC_QUERY_TIMEOUT_MS,
      },
    );

    const status =
      parseUpsStatusFromUpscOutput(stdout) ??
      parseUpsStatusFromUpscOutput(stderr);
    if (status) {
      return { status };
    }

    const mergedOutput = `${stdout}\n${stderr}`.trim();
    return {
      status: null,
      reason: mergedOutput
        ? `ups.status unavailable (${compactSingleLine(mergedOutput)})`
        : 'ups.status unavailable',
    };
  } catch (error) {
    return {
      status: null,
      reason: `upsc query failed (${summarizeExecFailure(error)})`,
    };
  }
}

function parseUpsStatusFromUpscOutput(output: string): string | null {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  for (const line of lines) {
    const match = line.match(/^ups\.status\s*:\s*(.+)$/iu);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }

  for (const line of lines) {
    if (/^error:/iu.test(line)) {
      continue;
    }
    if (!line.includes(':')) {
      return line;
    }
  }

  return null;
}

function summarizeExecFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const execError = error as Error & {
    code?: number | string;
    stdout?: string;
    stderr?: string;
  };
  const details: string[] = [];

  if (execError.code !== undefined) {
    details.push(`code ${String(execError.code)}`);
  }
  if (typeof execError.stderr === 'string' && execError.stderr.trim()) {
    details.push(`stderr ${compactSingleLine(execError.stderr)}`);
  }
  if (typeof execError.stdout === 'string' && execError.stdout.trim()) {
    details.push(`stdout ${compactSingleLine(execError.stdout)}`);
  }

  if (details.length > 0) {
    return details.join('; ');
  }

  return compactSingleLine(execError.message);
}

function compactSingleLine(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 180) {
    return collapsed;
  }
  return `${collapsed.slice(0, 180)}...`;
}

function escapeForSingleQuotedPowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function sanitizeConfigValue(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as NodeJS.ErrnoException;
  return candidate.code === 'EACCES' || candidate.code === 'EPERM';
}

async function pathExistsAsDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function pathExistsAsFile(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findFirstExistingRelativeFile(
  rootFolder: string,
  relativePaths: string[],
): Promise<string | null> {
  for (const relativePath of relativePaths) {
    const fullPath = path.join(rootFolder, relativePath);
    if (await pathExistsAsFile(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}



