import { listComPorts } from './nutSetupService';
import type {
  NutSetupPrepareLocalDriverPayload,
  NutSetupPrepareLocalDriverResult,
} from '../ipc/ipcChannels';

export async function classifySerialDriverFailure(
  payload: NutSetupPrepareLocalDriverPayload,
  error: unknown,
): Promise<NutSetupPrepareLocalDriverResult> {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const technicalDetails = buildTechnicalDetails(rawMessage);
  const selectedPort = normalizeComPortToken(payload.port);
  const normalizedMessage = rawMessage.toLowerCase();
  const mentionsSelectedPort = selectedPort
    ? normalizedMessage.includes(selectedPort.toLowerCase())
    : false;
  const hasPortOpenFailure = /(?:unable|failed)\s+to\s+open\s+com\d+/iu.test(rawMessage) ||
    /cannot\s+open\s+com\d+/iu.test(rawMessage);
  const hasAccessDeniedHint = /operation not permitted|access is denied|permission denied|device or resource busy|resource busy|port is busy|in use/iu.test(rawMessage);

  if (
    (hasPortOpenFailure && hasAccessDeniedHint) ||
    (mentionsSelectedPort && hasAccessDeniedHint)
  ) {
    return {
      success: false,
      errorCode: 'SERIAL_COM_PORT_ACCESS',
      error: selectedPort
        ? `Unable to open ${selectedPort}. The port is in use or access is denied. Close other serial applications and try again.`
        : 'Unable to open the selected COM port. The port is in use or access is denied. Close other serial applications and try again.',
      technicalDetails,
    };
  }

  if (/timed out waiting for serial driver initialization/iu.test(rawMessage)) {
    const portExists = selectedPort
      ? await detectComPortPresence(selectedPort)
      : null;

    if (selectedPort && portExists === false) {
      return {
        success: false,
        errorCode: 'SERIAL_COM_PORT_MISSING',
        error: `${selectedPort} is no longer available. Reconnect the UPS serial cable, verify the COM port, and try again.`,
        technicalDetails,
      };
    }

    return {
      success: false,
      errorCode: 'SERIAL_DRIVER_INIT_TIMEOUT',
      error: 'The serial driver started, but UPS status did not become ready in time. Verify the COM port, cable, and driver compatibility.',
      technicalDetails,
    };
  }

  if (selectedPort) {
    const portExists = await detectComPortPresence(selectedPort);
    if (portExists === false) {
      return {
        success: false,
        errorCode: 'SERIAL_COM_PORT_MISSING',
        error: `${selectedPort} is not currently available. Reconnect the UPS serial cable, refresh COM ports, and try again.`,
        technicalDetails,
      };
    }
  }

  if (hasPortOpenFailure) {
    return {
      success: false,
      errorCode: 'SERIAL_COM_PORT_ACCESS',
      error: selectedPort
        ? `Unable to open ${selectedPort}. Check whether the port is in use or blocked by permissions.`
        : 'Unable to open the selected COM port. Check whether the port is in use or blocked by permissions.',
      technicalDetails,
    };
  }

  return {
    success: false,
    errorCode: 'SERIAL_DRIVER_STARTUP_FAILED',
    error: rawMessage || 'Failed to configure and start local NUT serial driver',
    technicalDetails,
  };
}

export function buildTechnicalDetails(rawMessage: string): string | undefined {
  const message = rawMessage.trim();
  if (!message) {
    return undefined;
  }

  if (message.length <= 8000) {
    return message;
  }

  return `${message.slice(0, 8000)}\n...[truncated]`;
}

function normalizeComPortToken(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!/^COM\d+$/u.test(trimmed)) {
    return null;
  }
  return trimmed;
}

async function detectComPortPresence(port: string): Promise<boolean | null> {
  try {
    const ports = await listComPorts();
    return ports.ports.includes(port);
  } catch {
    return null;
  }
}
