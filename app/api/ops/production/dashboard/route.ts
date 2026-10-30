import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {loadPackingUnits,isWeightPacking} from '@/lib/ops/packingUnits';
import {fetchAllRows} from '@/lib/supabase/fetchAll';
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin(),from=req.nextUrl.searchParams.get('from'),to=req.nextUrl.searchParams.get('to')||from;
 if(!from)return NextResponse.json({error:'A from date is required.'},{status:400});
 // A custom range can easily pass 1000 rows (~50-60/day) — page through
 // with .range() rather than a bare select(), which silently caps at 1000
 // and drops the tail of the range (see lib/supabase/fetchAll.ts).
 const {data,error}=await fetchAllRows<any>((rangeFrom,rangeTo)=>db.from('ops_production_entries').select('report_date,shift,time_slot,product_id,product_raw,packing,quantity,production_pct,ops_product_master(display_name)').gte('report_date',from).lte('report_date',to||from).order('report_date').order('time_slot').range(rangeFrom,rangeTo));
 if(error)return NextResponse.json({error:'Unable to load production data.'},{status:500});
 const rows=(data||[]).map((r:any)=>({...r,displayName:r.ops_product_master?.display_name||r.product_raw}));
 // Whether a packing is a genuine MT quantity or a bag/unit count is a real,
 // per-product fact (Rice Bran Oil's "P I"/"P II" tank stages are MT, DORB's
 // "Plastic" packing is a bag count) read from Stock Summary's packing_size
 // column — not something the packing label alone ("Bulk" vs not) can tell
 // you. See lib/ops/packingUnits.ts.
 const units=await loadPackingUnits([...new Set(rows.map((r:any)=>r.product_id).filter(Boolean))]);
 const isWeight=(r:any)=>isWeightPacking(units,r.product_id,r.packing);
 const byProduct=new Map<string,{name:string;weightQty:number;countQty:number}>();
 for(const r of rows){const key=r.product_id||r.product_raw;const weight=isWeight(r);const cur=byProduct.get(key)||{name:r.displayName,weightQty:0,countQty:0};if(weight)cur.weightQty+=Number(r.quantity||0);else cur.countQty+=Number(r.quantity||0);byProduct.set(key,cur);}
 const byShift=new Map<string,number>();
 const byShiftTotal=new Map<string,number>();
 for(const r of rows)if(isWeight(r)){const k=`${r.report_date}|${r.shift}`;byShift.set(k,(byShift.get(k)||0)+Number(r.quantity||0));byShiftTotal.set(r.shift,(byShiftTotal.get(r.shift)||0)+Number(r.quantity||0));}
 return NextResponse.json({
  rows,
  byProduct:[...byProduct.entries()].map(([key,v])=>({productKey:key,...v})).sort((a,b)=>b.weightQty-a.weightQty),
  byShift:[...byShift.entries()].map(([key,qty])=>{const [reportDate,shift]=key.split('|');return {reportDate,shift,weightQty:qty};}),
  byShiftTotal:[...byShiftTotal.entries()].map(([shift,weightQty])=>({shift,weightQty})).sort((a,b)=>b.weightQty-a.weightQty),
  totalWeightMt:rows.filter(isWeight).reduce((s,r)=>s+Number(r.quantity||0),0),
 });
}
