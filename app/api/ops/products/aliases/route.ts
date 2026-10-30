import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
// AI may only ever SUGGEST a product mapping (status='pending', written by
// lib/ops/productMatch.ts during upload) — this route is the one place a
// human turns a suggestion into something reconciliation will actually use.
export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin(),status=req.nextUrl.searchParams.get('status')||'pending';
 const {data,error}=await db.from('ops_product_aliases').select('id,product_id,report_type,source_text,status,suggested_by,confidence,created_at,ops_product_master(display_name)').eq('status',status).order('created_at',{ascending:false}).limit(200);
 if(error)return NextResponse.json({error:'Unable to load product aliases.'},{status:500});
 return NextResponse.json({aliases:data||[]});
}
export async function PATCH(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const b=await req.json(),id=String(b.id||''),action=String(b.action||'');
 if(!id||!['approve','reject'].includes(action))return NextResponse.json({error:'A valid id and action are required.'},{status:400});
 const db=supabaseAdmin();
 const update:any={status:action==='approve'?'approved':'rejected',approved_by:az.user?.id||null,approved_at:new Date().toISOString()};
 if(action==='approve'&&b.productId)update.product_id=b.productId;
 const {error}=await db.from('ops_product_aliases').update(update).eq('id',id);
 if(error)return NextResponse.json({error:'Unable to update this alias.'},{status:500});
 return NextResponse.json({ok:true});
}
