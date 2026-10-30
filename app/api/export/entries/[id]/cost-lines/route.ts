import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,EXPORT_EDIT_ROLES,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const az=await moduleAuthorization('export',EXPORT_VIEW_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Export access is required'},{status:az.status});
  const {id}=await params;
  const db=supabaseAdmin();
  const {data:entry,error:ee}=await db.from('export_entries').select('id,commodity_id').eq('id',id).maybeSingle();
  if(ee)throw ee;
  if(!entry)return NextResponse.json({error:'Export entry not found'},{status:404});
  const [{data:categories,error:ce},{data:lines,error:le}]=await Promise.all([
   db.from('trade_cost_categories').select('*').eq('module','export').eq('active',true).order('sort_order'),
   db.from('export_cost_lines').select('*').eq('export_entry_id',id),
  ]);
  if(ce)throw ce;if(le)throw le;
  const applicable=(categories||[]).filter((c:any)=>c.commodity_id==null||String(c.commodity_id)===String(entry.commodity_id));
  const byCategory=new Map((lines||[]).map((l:any)=>[String(l.cost_category_id),l]));
  const rows=applicable.map((c:any)=>{
   const line=byCategory.get(String(c.id));
   return {categoryId:c.id,categoryName:c.name,sortOrder:c.sort_order,value:Number(line?.value||0),gst:Number(line?.gst||0),note:line?.note||''};
  });
  return NextResponse.json({lines:rows});
 }catch(e){logServerError('export/entries/cost-lines',e);return NextResponse.json({error:errorMessage(e,'Unable to load cost lines')},{status:500})}
}

export async function PUT(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const az=await moduleAuthorization('export',EXPORT_EDIT_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Export edit access is required'},{status:az.status});
  const {id}=await params;
  const b=await req.json();
  const lines=Array.isArray(b.lines)?b.lines:[];
  if(!lines.length)return NextResponse.json({error:'No cost lines supplied'},{status:400});
  const db=supabaseAdmin();
  const payload=lines.map((l:any)=>({export_entry_id:id,cost_category_id:Number(l.categoryId),value:Number(l.value||0),gst:Number(l.gst||0),note:l.note||null,updated_at:new Date().toISOString()}));
  const {error}=await db.from('export_cost_lines').upsert(payload,{onConflict:'export_entry_id,cost_category_id'});
  if(error)throw error;
  return NextResponse.json({ok:true});
 }catch(e){logServerError('export/entries/cost-lines',e);return NextResponse.json({error:errorMessage(e,'Unable to save cost lines')},{status:500})}
}
