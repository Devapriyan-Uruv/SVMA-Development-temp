import {NextRequest,NextResponse} from 'next/server';
import {anyModuleAuthorization,IMPORT_EDIT_ROLES,IMPORT_VIEW_ROLES,EXPORT_EDIT_ROLES,EXPORT_VIEW_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// One master, one form — the party is either a supplier or a customer
// (party_type), never two separate screens. Shared by Import and Export
// even though the two modules otherwise have separate permission
// boundaries, because the same counterparty often matters to both sides
// of the business.
const viewGate=()=>anyModuleAuthorization([{module:'import',fallbackRoles:IMPORT_VIEW_ROLES},{module:'export',fallbackRoles:EXPORT_VIEW_ROLES}]);
const editGate=()=>anyModuleAuthorization([{module:'import',fallbackRoles:IMPORT_EDIT_ROLES},{module:'export',fallbackRoles:EXPORT_EDIT_ROLES}]);

export async function GET(req:NextRequest){
 try{
  const az=await viewGate();if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export access is required'},{status:az.status});
  const db=supabaseAdmin();
  const type=req.nextUrl.searchParams.get('type');
  let q=db.from('trade_parties').select('*').order('name');
  if(type)q=q.eq('party_type',type);
  const activeOnly=req.nextUrl.searchParams.get('all')!=='1';
  if(activeOnly)q=q.eq('active',true);
  const {data,error}=await q;
  if(error)throw error;
  return NextResponse.json({parties:data||[]});
 }catch(e){logServerError('trade/parties',e);return NextResponse.json({error:errorMessage(e,'Unable to load parties')},{status:500})}
}

export async function POST(req:NextRequest){
 try{
  const az=await editGate();if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export edit access is required'},{status:az.status});
  const b=await req.json();
  const partyType=String(b.partyType||'');
  if(!['supplier','customer'].includes(partyType))return NextResponse.json({error:'Choose Supplier or Customer.'},{status:400});
  if(!String(b.name||'').trim())return NextResponse.json({error:'Party name is required.'},{status:400});
  const db=supabaseAdmin();
  const row={
   party_type:partyType,name:String(b.name).trim(),country:b.country||null,contact_person:b.contactPerson||null,
   phone:b.phone||null,email:b.email||null,bank_name:b.bankName||null,bank_account_no:b.bankAccountNo||null,
   bank_swift:b.bankSwift||null,tax_id:b.taxId||null,notes:b.notes||null,created_by:az.user!.id,
  };
  const {data,error}=await db.from('trade_parties').insert(row).select('*').single();
  if(error)throw error;
  return NextResponse.json({party:data});
 }catch(e){logServerError('trade/parties',e);return NextResponse.json({error:errorMessage(e,'Unable to save party')},{status:500})}
}

export async function PATCH(req:NextRequest){
 try{
  const az=await editGate();if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Import or Export edit access is required'},{status:az.status});
  const b=await req.json();
  if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
  const db=supabaseAdmin();
  const update:Record<string,unknown>={};
  for(const [k,col] of [['name','name'],['country','country'],['contactPerson','contact_person'],['phone','phone'],['email','email'],['bankName','bank_name'],['bankAccountNo','bank_account_no'],['bankSwift','bank_swift'],['taxId','tax_id'],['notes','notes']] as [string,string][])if(k in b)update[col]=b[k]||null;
  if('active' in b)update.active=!!b.active;
  update.updated_at=new Date().toISOString();
  const {data,error}=await db.from('trade_parties').update(update).eq('id',b.id).select('*').single();
  if(error)throw error;
  return NextResponse.json({party:data});
 }catch(e){logServerError('trade/parties',e);return NextResponse.json({error:errorMessage(e,'Unable to update party')},{status:500})}
}
