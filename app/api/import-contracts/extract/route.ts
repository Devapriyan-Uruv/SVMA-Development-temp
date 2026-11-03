import { NextRequest, NextResponse } from 'next/server';
import { getOpenAI, OPENAI_MODEL } from '@/lib/openai';
import {
  ALLOWED_TYPES,
  EXTRACTION_PROMPT,
  parseExtraction,
  validFileSignature,
  safeFileName,
} from '@/lib/importContracts/extraction';
import {
  moduleEditAuthorization,
  IMPORT_EDIT_ROLES,
} from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  errorMessage,
  logServerError,
} from '@/lib/errors';
import {
  buildContractDuplicatePayload,
  duplicatePayloadKey,
} from '@/lib/importContracts/duplicate';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MODULE_KEY = 'import';
const BUCKET = 'mport-contract-documents';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 5;

export async function POST(req: NextRequest) {
  let uploadedPaths: string[] = [];

  try {
    const az = await moduleEditAuthorization(
      MODULE_KEY,
      IMPORT_EDIT_ROLES,
    );

    if (!az.ok) {
      return NextResponse.json(
        {
          error:
            az.status === 401
              ? 'Authentication required.'
              : 'Import Contract Portal edit access is required.',
        },
        { status: az.status },
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI is not configured on the server.' },
        { status: 500 },
      );
    }

    const form = await req.formData();
    const submitted = form.getAll('files');

    if (
      submitted.length === 0 ||
      submitted.some((item) => !(item instanceof File))
    ) {
      return NextResponse.json(
        {
          error: 'Upload at least one PDF or image in the files field.',
        },
        { status: 400 },
      );
    }

    if (submitted.length > MAX_FILES) {
      return NextResponse.json(
        {
          error: `Upload no more than ${MAX_FILES} files at a time.`,
        },
        { status: 400 },
      );
    }

    const files = submitted as File[];
    const db = supabaseAdmin();
    const openai = getOpenAI('import_contract_extract');

    const contracts: Record<string, unknown>[] = [];

    // Fetch existing contract fingerprints from Supabase.
const { data: existingContracts, error: existingError } = await db
  .from('import_contracts')
  .select(
    'id, import_id, contract_number, supplier_name, duplicate_fingerprint'
  );

if (existingError) {
  throw existingError;
}

// Store existing fingerprints for quick duplicate lookup.
const existingByFingerprint = new Map<string, any>();

for (const row of existingContracts ?? []) {
  if (row.duplicate_fingerprint) {
    existingByFingerprint.set(
      row.duplicate_fingerprint,
      row
    );
  }
}
    // Detect duplicates within the current upload batch.
    const batchByPayload = new Map<string, string>();

    for (const file of files) {
      if (file.size === 0 || file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: `${file.name}: the file must be between 1 byte and 10 MB.`,
          },
          { status: 400 }
        );
      }

      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            error: `${file.name}: only PDF, JPG, and PNG files are supported.`,
          },
          { status: 400 }
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());

      if (!validFileSignature(bytes, file.type)) {
        return NextResponse.json(
          {
            error: `${file.name}: the file content does not match its declared type.`,
          },
          { status: 400 }
        );
      }

      const originalFileName = safeFileName(file.name);

      const storagePath =
        `${az.user.id}/${crypto.randomUUID()}-${originalFileName}`;

      const { error: uploadError } = await db.storage
        .from(BUCKET)
        .upload(storagePath, bytes, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      uploadedPaths.push(storagePath);

      const dataUrl =
        `data:${file.type};base64,${bytes.toString('base64')}`;

      const content =
        file.type === 'application/pdf'
          ? [
              {
                type: 'input_text' as const,
                text: EXTRACTION_PROMPT,
              },
              {
                type: 'input_file' as const,
                filename: originalFileName,
                file_data: dataUrl,
              },
            ]
          : [
              {
                type: 'input_text' as const,
                text: EXTRACTION_PROMPT,
              },
              {
                type: 'input_image' as const,
                image_url: dataUrl,
                detail: 'high' as const,
              },
            ];

      const response = await openai.responses.create({
        model: OPENAI_MODEL,
        input: [
          {
            role: 'user',
            content,
          },
        ],
        text: {
          format: { type: 'json_object' },
        },
      });

      const extraction = parseExtraction(response.output_text);

      const duplicatePayload = buildContractDuplicatePayload({
        fields: extraction.fields,
        materials: extraction.materials,
        additionalDetails: extraction.additionalDetails,
      });

      // Generate fingerprint for the extracted contract.
      const payloadKey = duplicatePayloadKey(duplicatePayload);

      // Check against previously saved contracts.
      const duplicate = existingByFingerprint.get(payloadKey);

      // Check against other PDFs uploaded in this batch.
      const duplicateInBatch = batchByPayload.get(payloadKey); 

      batchByPayload.set(payloadKey, file.name);

      contracts.push({
        duplicateOf: duplicate
          ? {
              id: duplicate.id,
              importId: duplicate.import_id,
              contractNumber: duplicate.contract_number,
              supplierName: duplicate.supplier_name,
            }
          : null,

        duplicateInBatch: duplicateInBatch ?? null,

        fileName: file.name,
        originalFileName: file.name,
        documentPath: storagePath,
        documentUrl: null,

        fields: extraction.fields,
        materials: extraction.materials,
        additionalDetails: extraction.additionalDetails,

        missingFields: extraction.missingFields,
        uncertainFields: extraction.uncertainFields,
        warnings: extraction.warnings,
      });
    }

    return NextResponse.json({ contracts });

  } catch (e) {
    // Remove uploaded documents if extraction fails.
    try {
      if (uploadedPaths.length > 0) {
        const db = supabaseAdmin();

        await db.storage
          .from(BUCKET)
          .remove(uploadedPaths);
      }
    } catch {
      // Preserve the original error.
    }

    logServerError('import-contracts/extract', e);

    return NextResponse.json(
      {
        error: errorMessage(
          e,
          'Contract extraction failed. Check server logs for details.'
        ),
      },
      { status: 500 }
    );
  }
}