import {NextRequest,NextResponse} from 'next/server';
import {anyModuleAuthorization,IMPORT_EDIT_ROLES,IMPORT_VIEW_ROLES,EXPORT_EDIT_ROLES,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

const viewGate=()=>anyModuleAuthorization([{module:'import',fallbackRoles:IMPORT_VIEW_ROLES},{module:'export',fallbackRoles:EXPORT_VIEW_ROLES}]);
const editGate=()=>anyModuleAuthorization([{module:'import',fallbackRoles:IMPORT_EDIT_ROLES},{module:'export',fallbackRoles:EXPORT_EDIT_ROLES}]);

export async function GET(){
 try{
  const az=await viewGate();if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export access is required'},{status:az.status});
  const db=supabaseAdmin();
  const {data,error}=await db.from('trade_commodities').select('*').eq('active',true).order('name');
  if(error)throw error;
  return NextResponse.json({commodities:data||[]});
 }catch(e){logServerError('trade/commodities',e);return NextResponse.json({error:errorMessage(e,'Unable to load commodities')},{status:500})}
}

export async function POST(req:NextRequest){
 try{
  const az=await editGate();if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export edit access is required'},{status:az.status});
  const b=await req.json();
  const name=String(b.name||'').trim();
  if(!name)return NextResponse.json({error:'Commodity name is required.'},{status:400});
  const db=supabaseAdmin();
  const {data,error}=await db.from('trade_commodities').insert({name,unit:b.unit||'MT'}).select('*').single();
  if(error)throw error;
  return NextResponse.json({commodity:data});
 }catch(e){logServerError('trade/commodities',e);return NextResponse.json({error:errorMessage(e,'Unable to save commodity — it may already exist')},{status:500})}
}

/** PATCH — the commodity's HSN code (Import Master column 9). It belongs to the commodity, so it is filled once for every record of it. */
export async function PATCH(req:NextRequest){
 try{
  const az=await editGate();if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export edit access is required'},{status:az.status});
  const b=await req.json();
  const hsn=String(b.hsn||'').trim().slice(0,20);
  if(!b.id||!/^[0-9A-Za-z .-]{2,20}$/.test(hsn))return NextResponse.json({error:'Commodity and a valid HSN code are required.'},{status:400});
  const {error}=await supabaseAdmin().from('trade_commodities').update({hsn}).eq('id',b.id);
  if(error)throw error;
  return NextResponse.json({ok:true});
 }catch(e){logServerError('trade/commodities',e);return NextResponse.json({error:errorMessage(e,'Unable to save the HSN code (has sql/079 been run?)')},{status:500})}
}
