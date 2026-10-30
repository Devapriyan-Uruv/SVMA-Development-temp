import {NextRequest,NextResponse} from 'next/server';
import {authorization,HR_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// The central registry: a physical asset exists here exactly once,
// independent of who currently holds it. employee_assets (issued via
// /api/assets/assign) is the assignment/history log that points back here.
export async function GET(req:NextRequest){try{
 const az=await authorization(HR_ROLES);if(!az.ok)return NextResponse.json({error:'HR or Admin access is required'},{status:az.status});
 const db=supabaseAdmin();
 const id=req.nextUrl.searchParams.get('id');
 if(id){
  const {data:asset,error:ae}=await db.from('assets').select('*').eq('id',id).single();if(ae)throw ae;
  const {data:history,error:he}=await db.from('employee_assets').select('*,profiles(full_name,email)').eq('asset_id',id).order('issued_date',{ascending:false});if(he)throw he;
  return NextResponse.json({asset,history:history||[]});
 }
 const status=req.nextUrl.searchParams.get('status');
 let q=db.from('assets').select('*').order('created_at',{ascending:false});
 if(status)q=q.eq('status',status);
 const {data:records,error}=await q;if(error)throw error;
 // Attach the current holder for anything shown as assigned — bounded by
 // how many assets exist, same N+1 tolerance already accepted elsewhere in
 // this module (e.g. the roster/leave tabs).
 const assigned=(records||[]).filter(r=>r.status==='assigned');
 const holders=new Map<number,any>();
 await Promise.all(assigned.map(async a=>{
  const {data}=await db.from('employee_assets').select('profile_id,profiles(full_name,email)').eq('asset_id',a.id).is('return_date',null).order('issued_date',{ascending:false}).limit(1).maybeSingle();
  if(data)holders.set(a.id,data);
 }));
 const shaped=(records||[]).map(r=>({...r,currentHolder:holders.get(r.id)?.profiles||null}));
 return NextResponse.json({records:shaped});
}catch(e){logServerError('assets',e);return NextResponse.json({error:errorMessage(e,'Unable to load assets')},{status:500})}}

export async function POST(req:NextRequest){try{
 const az=await authorization(HR_ROLES);if(!az.ok)return NextResponse.json({error:'HR or Admin access is required'},{status:az.status});
 const db=supabaseAdmin();
 const b=await req.json(),assetTag=String(b.assetTag||'').trim(),name=String(b.name||'').trim(),type=String(b.type||'').trim();
 if(!assetTag||!name||!type)return NextResponse.json({error:'Asset tag, name and type are required.'},{status:400});
 const {data,error}=await db.from('assets').insert({
  asset_tag:assetTag,name,type,serial_number:b.serialNumber||null,purchase_date:b.purchaseDate||null,
  purchase_cost:b.purchaseCost!=null&&b.purchaseCost!==''?Number(b.purchaseCost):null,vendor:b.vendor||null,
  warranty_expiry:b.warrantyExpiry||null,notes:b.notes||null,created_by:az.user.id,
 }).select('*').single();
 if(error){if((error as any).code==='23505')return NextResponse.json({error:'An asset with this tag already exists.'},{status:400});throw error}
 return NextResponse.json({record:data});
}catch(e){logServerError('assets',e);return NextResponse.json({error:errorMessage(e,'Unable to register asset')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const az=await authorization(HR_ROLES);if(!az.ok)return NextResponse.json({error:'HR or Admin access is required'},{status:az.status});
 const db=supabaseAdmin();
 const b=await req.json();if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
 if(b.status==='assigned')return NextResponse.json({error:'Use Assign to mark an asset assigned.'},{status:400});
 const update:Record<string,any>={updated_at:new Date().toISOString()};
 if('name' in b)update.name=b.name;
 if('type' in b)update.type=b.type;
 if('serialNumber' in b)update.serial_number=b.serialNumber||null;
 if('purchaseDate' in b)update.purchase_date=b.purchaseDate||null;
 if('purchaseCost' in b)update.purchase_cost=b.purchaseCost!=null&&b.purchaseCost!==''?Number(b.purchaseCost):null;
 if('vendor' in b)update.vendor=b.vendor||null;
 if('warrantyExpiry' in b)update.warranty_expiry=b.warrantyExpiry||null;
 if('notes' in b)update.notes=b.notes||null;
 if('status' in b&&['available','maintenance','retired'].includes(String(b.status)))update.status=b.status;
 const {data,error}=await db.from('assets').update(update).eq('id',b.id).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:data});
}catch(e){logServerError('assets',e);return NextResponse.json({error:errorMessage(e,'Unable to update asset')},{status:500})}}
