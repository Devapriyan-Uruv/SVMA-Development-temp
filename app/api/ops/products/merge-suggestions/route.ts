import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';

export async function GET(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin(),status=req.nextUrl.searchParams.get('status')||'pending';
 const {data,error}=await db.from('ops_product_merge_suggestions').select('id,confidence,status,created_at,keep:keep_product_id(id,display_name,product_code),merge:merge_product_id(id,display_name,product_code)').eq('status',status).order('confidence',{ascending:false}).limit(200);
 if(error)return NextResponse.json({error:'Unable to load merge suggestions.'},{status:500});
 return NextResponse.json({suggestions:data||[]});
}

// Merge is the one place this module ever combines two products — always a
// human action, never automatic (see lib/ops/productMatch.ts). It reassigns
// every row that pointed at the losing product across all ERP tables, then
// deactivates the losing product rather than deleting it, so historical
// exceptions/tickets referencing it by name stay meaningful.
export async function PATCH(req:NextRequest){
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Operations Intelligence access not assigned'},{status:az.status});
 const b=await req.json(),id=String(b.id||''),action=String(b.action||'');
 if(!id||!['merge','dismiss'].includes(action))return NextResponse.json({error:'A valid id and action are required.'},{status:400});
 const db=supabaseAdmin();
 const {data:suggestion,error:findErr}=await db.from('ops_product_merge_suggestions').select('id,keep_product_id,merge_product_id,status').eq('id',id).maybeSingle();
 if(findErr||!suggestion)return NextResponse.json({error:'Suggestion not found.'},{status:404});
 if((suggestion as any).status!=='pending')return NextResponse.json({error:'This suggestion was already resolved.'},{status:409});
 const {keep_product_id:keepId,merge_product_id:mergeId}=suggestion as any;

 if(action==='merge'){
  const tables=['ops_feeding_entries','ops_production_entries','ops_stock_snapshots','ops_exceptions','ops_product_aliases'];
  for(const t of tables){const {error}=await db.from(t).update({product_id:keepId}).eq('product_id',mergeId);if(error)return NextResponse.json({error:`Merge failed while updating ${t}: ${error.message}`},{status:500});}
  const {data:losing}=await db.from('ops_product_master').select('product_code').eq('id',mergeId).maybeSingle();
  await db.from('ops_product_master').update({active:false,product_code:`${(losing as any)?.product_code||'MERGED'}_MERGED_${Date.now()}`}).eq('id',mergeId);
 }

 const {error:updErr}=await db.from('ops_product_merge_suggestions').update({status:action==='merge'?'merged':'dismissed',resolved_by:az.user?.id||null,resolved_at:new Date().toISOString()}).eq('id',id);
 if(updErr)return NextResponse.json({error:'Unable to finalize the suggestion.'},{status:500});
 return NextResponse.json({ok:true});
}
