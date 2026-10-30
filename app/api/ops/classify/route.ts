import { NextRequest, NextResponse } from 'next/server';
import { moduleAuthorization, OPS_ROLES } from '@/lib/authorize';
import { readWorkbook } from '@/lib/reconcile';
import { errorMessage, logServerError } from '@/lib/errors';
import { classifyReport } from '@/lib/aix3/classify';

export const runtime = 'nodejs';

/** Classifies ONE uploaded file — AIX3 sees only lightweight metadata
 * (filename, sheet names, first ~12 rows), never the whole workbook. The
 * Operations Data Hub calls this once per dropped file before deciding
 * whether to auto-process it or ask the user to confirm the report type. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('operations_intelligence', OPS_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Operations Intelligence access not assigned' }, { status: az.status });
    const fd = await req.formData();
    const file = fd.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    let book;
    try { book = readWorkbook(buf); } catch (e) { return NextResponse.json({ error: errorMessage(e, 'Could not read this file as an Excel workbook.') }, { status: 400 }); }
    const result = await classifyReport(file.name, book);
    return NextResponse.json(result);
  } catch (e) {
    logServerError('ops/classify', e);
    return NextResponse.json({ error: errorMessage(e, 'Classification failed.') }, { status: 500 });
  }
}
