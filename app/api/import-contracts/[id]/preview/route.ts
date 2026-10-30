
import { NextRequest, NextResponse } from 'next/server';
import {
  moduleAuthorization,
  IMPORT_VIEW_ROLES,
} from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  errorMessage,
  logServerError,
} from '@/lib/errors';

export const runtime = 'nodejs';

// Contracts live under the existing Import module (same access, same roles) — no separate module key.
const MODULE_KEY = 'import';
const BUCKET = 'import-contract-documents';
const URL_EXPIRY_SECONDS = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const az = await moduleAuthorization(
      MODULE_KEY,
      IMPORT_VIEW_ROLES,
    );

    if (!az.ok) {
      return NextResponse.json(
        {
          error:
            az.status === 401
              ? 'Authentication required.'
              : 'Import Contract Portal access is required.',
        },
        { status: az.status },
      );
    }

    const { id } = await context.params;

    // Validate the contract UUID before querying the database.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
      return NextResponse.json(
        { error: 'Invalid contract ID.' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    const { data: contract, error: contractError } = await db
      .from('import_contracts')
      .select('id, original_file_name, storage_path')
      .eq('id', id)
      .maybeSingle();

    if (contractError) throw contractError;

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found.' },
        { status: 404 },
      );
    }

    if (!contract.storage_path) {
      return NextResponse.json(
        { error: 'No original document is linked to this contract.' },
        { status: 404 },
      );
    }

    const { data, error: storageError } = await db.storage
      .from(BUCKET)
      .createSignedUrl(
        contract.storage_path,
        URL_EXPIRY_SECONDS,
        { download: false },
      );

    if (storageError) throw storageError;

    return NextResponse.json(
      {
        url: data.signedUrl,
        fileName: contract.original_file_name,
        expiresIn: URL_EXPIRY_SECONDS,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          Vary: 'Cookie',
        },
      },
    );
  } catch (error) {
    logServerError('import-contracts/preview', error);

    return NextResponse.json(
      {
        error: errorMessage(
          error,
          'Unable to open the original contract.',
        ),
      },
      { status: 500 },
    );
  }
}
