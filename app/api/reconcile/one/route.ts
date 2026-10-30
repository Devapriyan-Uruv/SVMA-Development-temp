import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { gunzipSync } from 'zlib';
import { runOneReconciliation } from '@/lib/oneReconciliation/engine';
import { persistOneRun } from '@/lib/oneReconciliation/persist';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function workbook(file: File) { return XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer', cellDates: true }); }

/** One Reconciliation System — the four core reports (Weighment, Gate In,
 * Gate Out, Tally Day Book) plus any number of additional ERP/Time Office/QC/
 * Settlement/CN-DN/Sales reports (`reports`), each auto-identified. Fully
 * separate from the existing Transaction Reconciliation. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });

    const form = await req.formData();
    const weighFile = form.get('weighment'), tallyFile = form.get('tally'), tallyParsedFile = form.get('tallyParsed');
    const gateInFiles = form.getAll('gateIn').filter((f): f is File => f instanceof File && f.size > 0);
    const gateOutFiles = form.getAll('gateOut').filter((f): f is File => f instanceof File && f.size > 0);
    const extraFiles = form.getAll('reports').filter((f): f is File => f instanceof File && f.size > 0);
    // A large Day Book is read in the browser and arrives already parsed (gzip JSON) — opening a 8 MB+ workbook here needs ~500 MB.
    const parsedOk = tallyParsedFile instanceof File && tallyParsedFile.size > 0;
    if (!(weighFile instanceof File) || !weighFile.size || !(parsedOk || (tallyFile instanceof File && tallyFile.size)) || !gateInFiles.length || !gateOutFiles.length) {
      return NextResponse.json({ error: 'Upload Weighment, Gate In, Gate Out and Tally Daybook.' }, { status: 400 });
    }

    let tallyParsed: { vouchers: any[]; ledger: any[]; sheet?: string; file?: string } | undefined;
    if (parsedOk) {
      try { tallyParsed = JSON.parse(gunzipSync(Buffer.from(await (tallyParsedFile as File).arrayBuffer())).toString('utf8')); }
      catch { return NextResponse.json({ error: 'The Tally Day Book data could not be read. Please upload the file again.' }, { status: 400 }); }
      if (!tallyParsed || !Array.isArray(tallyParsed.vouchers) || !Array.isArray(tallyParsed.ledger)) return NextResponse.json({ error: 'The Tally Day Book data is incomplete.' }, { status: 400 });
    }
    const tallyName = tallyParsed?.file || (tallyFile instanceof File ? tallyFile.name : 'Day Book');

    const [wbook, tbook, inBooks, outBooks, extraBooks] = await Promise.all([
      workbook(weighFile), tallyParsed ? Promise.resolve(undefined) : workbook(tallyFile as File),
      Promise.all(gateInFiles.map(workbook)), Promise.all(gateOutFiles.map(workbook)),
      Promise.all(extraFiles.map(async f => { try { return { file: f.name, book: await workbook(f) }; } catch (e) { return { file: f.name, error: e instanceof Error ? e.message : 'unreadable' }; } })),
    ]);

    const result = await runOneReconciliation({
      weighmentBook: wbook, weighmentFile: weighFile.name,
      gateInBooks: inBooks.map((book, i) => ({ book, file: gateInFiles[i].name })),
      gateOutBooks: outBooks.map((book, i) => ({ book, file: gateOutFiles[i].name })),
      tallyBook: tbook, tallyParsed, tallyFile: tallyName,
      extraReports: extraBooks.flatMap(x => (x.book ? [{ file: x.file, book: x.book }] : [])),
      extraUnreadable: extraBooks.flatMap(x => (!x.book ? [{ file: x.file, message: x.error || 'Unreadable file.' }] : [])),
      reconciliationDate: String(form.get('reconciliationDate') || ''),
    });

    const { savedRunId, error: persistError } = await persistOneRun(result, az.user?.id || null);
    if (persistError) result.warnings.push(persistError);

    return NextResponse.json({ ...result, savedRunId });
  } catch (error) {
    logServerError('reconcile/one', error);
    return NextResponse.json({ error: errorMessage(error, 'The uploaded reports could not be reconciled.') }, { status: 500 });
  }
}
