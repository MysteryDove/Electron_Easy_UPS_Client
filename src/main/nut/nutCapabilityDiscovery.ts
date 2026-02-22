import { KNOWN_DYNAMIC_NUT_FIELDS } from './nutValueMapper';
import type { NutClient } from './nutClient';

export type NutFieldMetadata = {
  name: string;
  description?: string;
};

export type NutCapabilityDiscoveryResult = {
  availableFields: Set<string>;
  fieldMetadata: Map<string, NutFieldMetadata>;
  staticFields: Set<string>;
  dynamicFields: Set<string>;
  staticSnapshot: Record<string, string>;
  initialDynamicSnapshot: Record<string, string>;
};

export type DiscoverCapabilitiesOptions = {
  initSampleDelayMs?: number;
};

const STATIC_FIELD_HINTS = [
  /^device\./,
  /^driver\./,
  /^ups\.firmware/,
  /^ups\.model$/,
  /^ups\.mfr$/,
  /^ups\.serial$/,
  /^ups\.type$/,
  /\.nominal$/,
  /^battery\.mfr\./,
  /^battery\.type$/,
];

const DYNAMIC_FIELD_HINTS = [
  /^battery\.(?!mfr)/,
  /^input\./,
  /^output\./,
  /^ups\.(load|power|realpower|status|temperature|timer)/,
  /^ambient\./,
];

export async function discoverNutCapabilities(
  client: NutClient,
  upsName: string,
  options?: DiscoverCapabilitiesOptions,
): Promise<NutCapabilityDiscoveryResult> {
  const firstSnapshot = await client.listVariables(upsName);
  const sampleDelayMs = options?.initSampleDelayMs ?? 700;
  let secondSnapshot = firstSnapshot;

  if (sampleDelayMs > 0) {
    await delay(sampleDelayMs);
    secondSnapshot = await client.listVariables(upsName);
  }

  const availableFields = new Set<string>(Object.keys(firstSnapshot));
  const staticFields = new Set<string>();
  const dynamicFields = new Set<string>();

  for (const fieldName of availableFields) {
    if (isStaticField(fieldName)) {
      staticFields.add(fieldName);
      continue;
    }

    if (isDynamicField(fieldName)) {
      dynamicFields.add(fieldName);
      continue;
    }

    if (firstSnapshot[fieldName] !== secondSnapshot[fieldName]) {
      dynamicFields.add(fieldName);
      continue;
    }

    staticFields.add(fieldName);
  }

  const staticSnapshot = pickSnapshotByFields(firstSnapshot, staticFields);
  const initialDynamicSnapshot = pickSnapshotByFields(
    secondSnapshot,
    dynamicFields,
  );
  const fieldMetadata = new Map<string, NutFieldMetadata>();

  for (const fieldName of availableFields) {
    fieldMetadata.set(fieldName, { name: fieldName });
  }

  return {
    availableFields,
    fieldMetadata,
    staticFields,
    dynamicFields,
    staticSnapshot,
    initialDynamicSnapshot,
  };
}

function pickSnapshotByFields(
  source: Record<string, string>,
  fields: Set<string>,
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const fieldName of fields) {
    if (typeof source[fieldName] === 'string') {
      snapshot[fieldName] = source[fieldName];
    }
  }
  return snapshot;
}

function isStaticField(fieldName: string): boolean {
  return STATIC_FIELD_HINTS.some((pattern) => pattern.test(fieldName));
}

function isDynamicField(fieldName: string): boolean {
  if (KNOWN_DYNAMIC_NUT_FIELDS.has(fieldName)) {
    return true;
  }

  return DYNAMIC_FIELD_HINTS.some((pattern) => pattern.test(fieldName));
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
