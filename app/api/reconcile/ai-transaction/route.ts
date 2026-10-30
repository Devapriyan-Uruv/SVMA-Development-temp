import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { runReconciliation } from '@/lib/reconciliation/engine';
import { loadProfile } from '@/lib/reconciliation/profile';
import { persistRun } from '@/lib/reconciliation/persist';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function workbook(file: File) { return XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer', cellDates: true }); }

// Streams real backend-progress events (never a faked timer) as newline-
// delimited JSON: {"type":"stage","label":"..."} for each completed step,
// then one {"type":"result",...} or {"type":"error",...} at the end.
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
        if (!az.ok) { send({ type: 'error', error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }); controller.close(); return; }

        const form = await req.formData();
        const weighFile = form.get('weighment'), tallyFile = form.get('tally');
        const gateInFiles = form.getAll('gateIn').filter((f): f is File => f instanceof File && f.size > 0);
        const gateOutFiles = form.getAll('gateOut').filter((f): f is File => f instanceof File && f.size > 0);
        if (!(weighFile instanceof File) || !(tallyFile instanceof File) || !weighFile.size || !tallyFile.size || !gateInFiles.length || !gateOutFiles.length) {
          send({ type: 'error', error: 'Upload Weighment, Gate In, Gate Out and Tally Daybook.' }); controller.close(); return;
        }

        const [wbook, tbook, inBooks, outBooks, profile] = await Promise.all([
          workbook(weighFile), workbook(tallyFile),
          Promise.all(gateInFiles.map(workbook)), Promise.all(gateOutFiles.map(workbook)),
          loadProfile(),
        ]);

        const { result, familyObservations } = await runReconciliation({
          weighmentBook: wbook, weighmentFile: weighFile.name,
          gateInBooks: inBooks.map((book, i) => ({ book, file: gateInFiles[i].name })),
          gateOutBooks: outBooks.map((book, i) => ({ book, file: gateOutFiles[i].name })),
          tallyBook: tbook, tallyFile: tallyFile.name,
          reconciliationDate: String(form.get('reconciliationDate') || ''),
        }, profile, (label) => send({ type: 'stage', label }));

        const { runId, warning } = await persistRun(result, familyObservations, az.user?.id || null, profile.version);
        if (warning) result.warnings.push(warning);

        send({ type: 'result', payload: { ...result, runId, rulesVersion: 'ai_engine_1' } });
      } catch (error) {
        logServerError('reconcile/ai-transaction', error);
        send({ type: 'error', error: errorMessage(error, 'The uploaded reports could not be reconciled.') });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
