import {NextRequest,NextResponse} from 'next/server';
import {moduleAuthorization,IMPORT_EDIT_ROLES,IMPORT_VIEW_ROLES,EXPORT_EDIT_ROLES,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// The configurable line-item list this whole module was built around —
// Finance can add "Fumigation" scoped to just Soya Bean here, live,
// without anyone touching code. Each side only ever manages its own
// module's list (an import_manager can't quietly add an export cost
// line, and vice versa); admin/super_admin can do either.
function gate(tradeModule:string){
 if(tradeModule==='export')return moduleAuthorization('export',EXPORT_EDIT_ROLES);
 return moduleAuthorization('import',IMPORT_EDIT_ROLES);
}
function viewGate(tradeModule:string){
 if(tradeModule==='export')return moduleAuthorization('export',EXPORT_VIEW_ROLES);
 return moduleAuthorization('import',IMPORT_VIEW_ROLES);
}

export async function GET(req:NextRequest){
 try{
  const tradeModule=req.nextUrl.searchParams.get('module')==='export'?'export':'import';
  const az=await viewGate(tradeModule);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':`${tradeModule==='export'?'Export':'Import'} access is required`},{status:az.status});
  const db=supabaseAdmin();
  const commodityId=req.nextUrl.searchParams.get('commodityId');
  let q=db.from('trade_cost_categories').select('*').eq('module',tradeModule).eq('active',true).order('sort_order');
  const {data,error}=await q;
  if(error)throw error;
  // No commodityId means "show me everything for this module" — the admin
  // list needs every commodity-specific row visible to manage it, not just
  // the generic ones. A commodityId narrows to what one entry's costing
  // tab should actually render: generic rows plus that commodity's own.
  const rows=commodityId?(data||[]).filter((r:any)=>r.commodity_id==null||String(r.commodity_id)===String(commodityId)):(data||[]);
  return NextResponse.json({categories:rows});
 }catch(e){logServerError('trade/cost-categories',e);return NextResponse.json({error:errorMessage(e,'Unable to load cost categories')},{status:500})}
}

export async function POST(req:NextRequest){
 try{
  const b=await req.json();
  const tradeModule=b.module==='export'?'export':'import';
  const az=await gate(tradeModule);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':`${tradeModule==='export'?'Export':'Import'} manager access is required`},{status:az.status});
  const name=String(b.name||'').trim();
  if(!name)return NextResponse.json({error:'Cost category name is required.'},{status:400});
  const db=supabaseAdmin();
  const {data:existing}=await db.from('trade_cost_categories').select('sort_order').eq('module',tradeModule).order('sort_order',{ascending:false}).limit(1);
  const nextSort=((existing?.[0]?.sort_order)||0)+10;
  const {data,error}=await db.from('trade_cost_categories').insert({module:tradeModule,commodity_id:b.commodityId?Number(b.commodityId):null,name,sort_order:nextSort}).select('*').single();
  if(error)throw error;
  return NextResponse.json({category:data});
 }catch(e){logServerError('trade/cost-categories',e);return NextResponse.json({error:errorMessage(e,'Unable to save cost category — it may already exist for this commodity')},{status:500})}
}

export async function PATCH(req:NextRequest){
 try{
  const b=await req.json();
  if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
  const db=supabaseAdmin();
  const {data:row}=await db.from('trade_cost_categories').select('module').eq('id',b.id).maybeSingle();
  const tradeModule=row?.module==='export'?'export':'import';
  const az=await gate(tradeModule);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':`${tradeModule==='export'?'Export':'Import'} manager access is required`},{status:az.status});
  const update:Record<string,unknown>={};
  if('name' in b)update.name=String(b.name).trim();
  if('active' in b)update.active=!!b.active;
  if('sortOrder' in b)update.sort_order=Number(b.sortOrder);
  const {data,error}=await db.from('trade_cost_categories').update(update).eq('id',b.id).select('*').single();
  if(error)throw error;
  return NextResponse.json({category:data});
 }catch(e){logServerError('trade/cost-categories',e);return NextResponse.json({error:errorMessage(e,'Unable to update cost category')},{status:500})}
}
