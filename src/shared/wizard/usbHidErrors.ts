const NO_MATCHING_HID_UPS_PATTERN = /no matching hid ups found/iu;

export function hasNoMatchingUsbHidUpsSignal(
  ...messages: Array<string | null | undefined>
): boolean {
  for (const message of messages) {
    if (!message) {
      continue;
    }

    if (NO_MATCHING_HID_UPS_PATTERN.test(message)) {
      return true;
    }
  }

  return false;
}

export function buildUsbHidTechnicalDetails(
  ...messages: Array<string | null | undefined>
): string | undefined {
  const merged = messages
    .filter((message): message is string => typeof message === 'string')
    .map((message) => message.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (!merged) {
    return undefined;
  }

  if (merged.length <= 8000) {
    return merged;
  }

  return `${merged.slice(0, 8000)}\n...[truncated]`;
}
