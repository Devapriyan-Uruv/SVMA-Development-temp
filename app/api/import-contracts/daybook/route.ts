import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'zlib';

import {
  moduleAuthorization,
  moduleEditAuthorization,
  IMPORT_VIEW_ROLES,
  IMPORT_EDIT_ROLES
} from '@/lib/authorize';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';
import type { DayBookVoucher } from '@/lib/outstanding/engine';

export const runtime = 'nodejs';
export const maxDuration = 120;

const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const str = (v: unknown, n = 200) =>
  String(v ?? '').slice(0, n);

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** GET — Day Book upload status. */
export async function GET() {
  try {
    const az = await moduleAuthorization('import', IMPORT_VIEW_ROLES);

    if (!az.ok) {
      return NextResponse.json(
        {
          error:
            az.status === 401
              ? 'Authentication required.'
              : 'Import access is required.'
        },
        { status: az.status }
      );
    }

    const db = supabaseAdmin();

    const [lo, hi, cnt] = await Promise.all([
      db
        .from('daybook_day_vouchers')
        .select('vch_date')
        .order('vch_date')
        .limit(1),

      db
        .from('daybook_day_vouchers')
        .select('vch_date')
        .order('vch_date', { ascending: false })
        .limit(1),

      db
        .from('daybook_day_vouchers')
        .select('vkey', { count: 'exact', head: true })
    ]);

    if (cnt.error) {
      return NextResponse.json(
        {
          error:
            'The Day Book store is not set up yet — run sql/074_day_summary.sql in Supabase.',
          code: 'not_set_up'
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      from: lo.data?.[0]?.vch_date ?? null,
      to: hi.data?.[0]?.vch_date ?? null,
      vouchers: cnt.count ?? 0
    });
  } catch (e) {
    logServerError('import-contracts/daybook:get', e);

    return NextResponse.json(
      { error: errorMessage(e, 'Unable to read the Day Book status.') },
      { status: 500 }
    );
  }
}

/** POST — save uploaded Day Book vouchers by date. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleEditAuthorization('import', IMPORT_EDIT_ROLES);

    if (!az.ok) {
      return NextResponse.json(
        {
          error:
            az.status === 401
              ? 'Authentication required.'
              : 'Import edit access is required.'
        },
        { status: az.status }
      );
    }

    const raw = Buffer.from(await req.arrayBuffer());

    let body: any;

    try {
      body = JSON.parse(
        (
          req.headers.get('x-body-encoding') === 'gzip'
            ? gunzipSync(raw)
            : raw
        ).toString('utf8')
      );
    } catch {
      return NextResponse.json(
        {
          error:
            'The Day Book data could not be read. Please upload the file again.'
        },
        { status: 400 }
      );
    }

    if (!body || !Array.isArray(body.vouchers)) {
      return NextResponse.json(
        { error: 'The Day Book data is incomplete.' },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();
    const me = az.user?.id ?? null;

    const byDate = new Map<
      string,
      {
        vkey: string;
        vch_date: string;
        vch_type: string;
        vch_no: string;
        payload: DayBookVoucher;
        uploaded_by: string | null;
      }[]
    >();

    let seq = 0;

    for (const x of body.vouchers) {
      if (!x || !isDate(x.date) || !Array.isArray(x.lines)) {
        continue;
      }

      const lines = x.lines
        .slice(0, 40)
        .map((l: any) => ({
          name: str(l?.name),
          dr: num(l?.dr),
          cr: num(l?.cr),
          refs: (
            Array.isArray(l?.refs) ? l.refs : []
          )
            .slice(0, 30)
            .map((r: any) => ({
              kind: str(r?.kind, 20),
              ref: str(r?.ref, 120),
              amount: num(r?.amount) ?? 0,
              drcr: r?.drcr === 'Cr' ? 'Cr' : 'Dr'
            }))
        }))
        .filter((l: any) => l.name);

      if (!lines.length) continue;

      const v: DayBookVoucher = {
        date: x.date,
        vchType: str(x.vchType, 80),
        vchNo: str(x.vchNo, 60),
        lines,
        narration: (
          Array.isArray(x.narration) ? x.narration : []
        )
          .slice(0, 4)
          .map((n: any) => str(n, 200)),

        // Import Contract metadata
        contractNo: str(x.contractNo, 120).trim() || undefined,
        boeNo: str(x.boeNo, 120).trim() || undefined,
        invoiceNo: str(x.invoiceNo, 120).trim() || undefined
      };

      (
        byDate.get(v.date) ||
        byDate.set(v.date, []).get(v.date)!
      ).push({
        vkey: `${v.date}|${v.vchType.toUpperCase()}|${v.vchNo}|${++seq}`,
        vch_date: v.date,
        vch_type: v.vchType,
        vch_no: v.vchNo,
        payload: v,
        uploaded_by: me
      });
    }

    const result: {
      date: string;
      vouchers: number;
      replaced: boolean;
      kept?: string;
    }[] = [];

    for (const [date, rows] of [...byDate.entries()].sort()) {
      const { count, error: ce } = await db
        .from('daybook_day_vouchers')
        .select('vkey', { count: 'exact', head: true })
        .eq('vch_date', date);

      if (ce) {
        return NextResponse.json(
          {
            error:
              'The Day Book store is not set up yet — run sql/074_day_summary.sql in Supabase.',
            code: 'not_set_up'
          },
          { status: 503 }
        );
      }

      // Preserve the existing 80% safeguard.
      // Do not replace a full saved day with a filtered export.
      if ((count || 0) > 0 && rows.length < 0.8 * (count || 0)) {
        result.push({
          date,
          vouchers: count || 0,
          replaced: false,
          kept: `The file has ${rows.length} vouchers for this date but ${count} are saved — it looks like a filtered export, so the saved day was kept.`
        });

        continue;
      }

      const { error: de } = await db
        .from('daybook_day_vouchers')
        .delete()
        .eq('vch_date', date);

      if (de) throw de;

      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db
          .from('daybook_day_vouchers')
          .insert(rows.slice(i, i + 500));

        if (error) throw error;
      }

      result.push({
        date,
        vouchers: rows.length,
        replaced: (count || 0) > 0
      });
    }

    return NextResponse.json({ dates: result });
  } catch (e) {
    logServerError('import-contracts/daybook:save', e);

    return NextResponse.json(
      { error: errorMessage(e, 'Unable to save the Day Book.') },
      { status: 500 }
    );
  }
}