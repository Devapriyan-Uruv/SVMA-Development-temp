import { moduleAuthorization, FINANCE_ROLES } from '@/lib/authorize';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { errorMessage, logServerError } from '@/lib/errors';

export const runtime = 'nodejs';

const TYPE_BY_SHEET: Record<string, string> = { FG: 'finished_good', RM: 'raw_material', PM: 'packing_material' };
const typeFromText = (t: string, sheet: string) => {
  const x = t.toLowerCase();
  if (x.includes('finished')) return 'finished_good';
  if (x.includes('raw')) return 'raw_material';
  if (x.includes('packing')) return 'packing_material';
  return TYPE_BY_SHEET[sheet.toUpperCase()] || null;
};
const str = (v: unknown) => String(v ?? '').trim();

export async function GET() {
  const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
  if (!az.ok) return NextResponse.json({ error: 'Finance access not assigned' }, { status: az.status });
  const db = supabaseAdmin();
  const { data } = await db.from('ops_product_master').select('product_type').eq('active', true);
  const counts: Record<string, number> = {};
  for (const r of data || []) counts[(r as any).product_type || 'unclassified'] = (counts[(r as any).product_type || 'unclassified'] || 0) + 1;
  return NextResponse.json({ total: (data || []).length, counts });
}

/** Refreshes the shared Product Master from a ProductList_AGRO-shaped
 * workbook (any sheets with ProductCode / ProductName / CategoryName /
 * PrdType headers). Upserts by product_code; never deletes or deactivates a
 * product missing from the file. */
export async function POST(req: NextRequest) {
  try {
    const az = await moduleAuthorization('finance_transaction', FINANCE_ROLES);
    if (!az.ok) return NextResponse.json({ error: az.status === 401 ? 'Not authenticated' : 'Finance access not assigned' }, { status: az.status });
    const file = (await req.formData()).get('productMaster');
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Upload the Product Master workbook.' }, { status: 400 });
    const book = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
    const items = new Map<string, { product_code: string; display_name: string; category: string | null; product_type: string | null; uom: string; active: boolean }>();
    for (const sheet of book.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheet], { defval: '' });
      for (const r of rows) {
        const k = Object.fromEntries(Object.entries(r).map(([a, b]) => [a.toLowerCase().replace(/[^a-z]/g, ''), b]));
        const code = str(k.productcode), name = str(k.productname);
        if (!code || !name) continue;
        items.set(code, { product_code: code, display_name: name, category: str(k.categoryname) || null, product_type: typeFromText(str(k.prdtype), sheet), uom: str(k.baseunit) || 'MT', active: true });
      }
    }
    if (!items.size) return NextResponse.json({ error: 'No products recognised. Expected ProductCode and ProductName columns.' }, { status: 400 });
    const db = supabaseAdmin();
    const list = [...items.values()];
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await db.from('ops_product_master').upsert(list.slice(i, i + 200), { onConflict: 'product_code' });
      if (error) return NextResponse.json({ error: `Product Master could not be updated: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, processed: list.length });
  } catch (error) {
    logServerError('reconcile/one/product-master', error);
    return NextResponse.json({ error: errorMessage(error, 'Product Master could not be refreshed.') }, { status: 500 });
  }
}
