
import { createHash } from 'node:crypto';

type DuplicatePayloadInput = {
  fields?: Record<string, unknown>;
  materials?: Record<string, unknown>[];
  additionalDetails?: Record<string, unknown>;
};

const IGNORED_KEYS = new Set([
  'id',
  'created_at',
  'updated_at',
  'uploaded_at',
  'file_name',
  'original_file_name',
  'file_url',
  'document_url',
  'document_path',
  'storage_path',
  'created_by',
  'updated_by',
]);

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};

    Object.keys(value as Record<string, unknown>)
      .filter((key) => !IGNORED_KEYS.has(key.toLowerCase()))
      .sort()
      .forEach((key) => {
        result[key] = normalizeValue(
          (value as Record<string, unknown>)[key]
        );
      });

    return result;
  }

  return value;
}

/**
 * Creates the complete business-data payload.
 * Includes contract fields, material rows, invoice details
 * and BOE details when supplied in additionalDetails.
 */
export function buildContractDuplicatePayload(
  input: DuplicatePayloadInput
): Record<string, unknown> {
  return {
    fields: normalizeValue(input.fields ?? {}),
    materials: normalizeValue(input.materials ?? []),
    additionalDetails: normalizeValue(
      input.additionalDetails ?? {}
    ),
  };
}

/**
 * Creates a stable SHA-256 fingerprint for duplicate comparison.
 */
export function duplicatePayloadKey(payload: unknown): string {
  const normalized = normalizeValue(payload);

  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

/**
 * Convenience function for generating a contract fingerprint.
 */
export function createContractFingerprint(
  contract: Record<string, unknown>
): string {
  return duplicatePayloadKey(contract);
}
