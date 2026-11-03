
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
const BUCKET = 'mport-contract-documents';
const URL_EXPIRY_SECONDS = 300;

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const storagePath =
      typeof body?.storagePath === 'string'
        ? body.storagePath.trim()
        : '';

        console.log('[Preview storage details]', {
  bucket: BUCKET,
  storagePath,
});
        console.log('[Preview path check]', {
  hasStoragePath: Boolean(storagePath),
  folderMatchesUser: storagePath.startsWith(`${az.user.id}/`),
  pathHasFileName: storagePath.split('/').length === 2,
});
    // Only allow files stored under the signed-in user's own folder.
    if (
      !storagePath ||
      storagePath.startsWith('/') ||
      storagePath.includes('..') ||
      storagePath.includes('\\') ||
      !storagePath.startsWith(`${az.user.id}/`)
    ) {
      return NextResponse.json(
        { error: 'Invalid document path.' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, URL_EXPIRY_SECONDS, {
        download: false,
      });

    if (error) {
  console.error('[Preview signed URL error]', {
    message: error.message,
    name: error.name,
    statusCode: error.statusCode,
  });
  throw error;
}

console.log('[Preview signed URL created]', {
  success: Boolean(data?.signedUrl),
});
    return NextResponse.json(
      {
        url: data.signedUrl,
        expiresIn: URL_EXPIRY_SECONDS,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    logServerError('import-contracts/preview-upload', error);

    return NextResponse.json(
      {
        error: errorMessage(
          error,
          'Unable to preview the uploaded document.',
        ),
      },
      { status: 500 },
    );
  }
}
