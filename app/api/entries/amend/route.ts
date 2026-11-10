
import {authorization,SOLVENT_MANAGEMENT_ROLES,QUALITY_MANAGEMENT_ROLES,SUPER_ADMIN_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {resolveParameterMetadata} from '@/lib/parameterMetadata';

const ALL_AUTHORISED=Array.from(
 new Set([
  ...SOLVENT_MANAGEMENT_ROLES,
  ...QUALITY_MANAGEMENT_ROLES,
  ...SUPER_ADMIN_ROLES
 ])
);

export async function GET(req:NextRequest){
 try{
  const az=await authorization(ALL_AUTHORISED);

  if(!az.ok){
   return NextResponse.json({
    error:az.status===401
     ?'Not authenticated'
     :'Amendment access is restricted to Solvent Head, Quality Head or Super Admin.'
   },{status:az.status});
  }

  const entryId=req.nextUrl.searchParams.get('entryId');
  const shiftSessionId=req.nextUrl.searchParams.get('shiftSessionId');
  const db=supabaseAdmin();

  let q=db
   .from('entry_amendments')
   .select('*')
   .order('requested_at',{ascending:false});

  if(entryId){
   q=q.eq('entry_id',entryId);
  }else if(shiftSessionId){
   const {data:ids,error}=await db
    .from('parameter_entries')
    .select('id')
    .eq('shift_session_id',shiftSessionId);

   if(error)throw error;

   q=q.in('entry_id',(ids||[]).map((x:any)=>x.id));
  }

  const {data,error}=await q.limit(200);

  if(error)throw error;

  return NextResponse.json({amendments:data||[]});

 }catch(e){
  logServerError('entries/amend',e);

  return NextResponse.json({
   error:errorMessage(e,'Unable to load amendments')
  },{status:500});
 }
}

export async function POST(req:NextRequest){
 try{
  const az=await authorization(ALL_AUTHORISED);

  if(!az.ok){
   return NextResponse.json({
    error:az.status===401
     ?'Not authenticated'
     :'Correcting a submitted entry is restricted to Solvent Head, Quality Head or Super Admin.'
   },{status:az.status});
  }

  const user=az.user!;
  const b=await req.json();

  if(
   !b.entryId||
   b.correctedValue===undefined||
   b.correctedValue===null||
   String(b.correctedValue).trim()===''
  ){
   return NextResponse.json({
    error:'entryId and correctedValue are required.'
   },{status:400});
  }

  if(!b.reason||!String(b.reason).trim()){
   return NextResponse.json({
    error:'A reason is required for every amendment — it becomes part of the permanent audit trail.'
   },{status:400});
  }

  const db=supabaseAdmin();

  // Fetch the original entry without relying on the parameter_master FK.
  const {data:entry,error:ee}=await db
   .from('parameter_entries')
   .select('*')
   .eq('id',b.entryId)
   .single();

  if(ee)throw ee;

  // Resolve metadata from active master or archive.
  const metadata=await resolveParameterMetadata(
   db,
   [entry.parameter_id]
  );

  const param=metadata.get(Number(entry.parameter_id));

  if(!param){
   return NextResponse.json({
    error:'Parameter metadata could not be found. Amendment cannot be processed safely.',
    code:'PARAMETER_METADATA_NOT_FOUND'
   },{status:409});
  }

  const module=param.parameter_sections?.module;

  if(!['solvent','boiler','quality'].includes(String(module))){
   return NextResponse.json({
    error:'The parameter module could not be identified. Amendment cannot be processed safely.'
   },{status:409});
  }

  const roleOk=module==='quality'
   ?az.roles.some((r:string)=>QUALITY_MANAGEMENT_ROLES.includes(r))
   :az.roles.some((r:string)=>SOLVENT_MANAGEMENT_ROLES.includes(r));

  if(!roleOk){
   return NextResponse.json({
    error:`Correcting this entry requires ${module==='quality'?'Quality Head':'Solvent Head'} or Super Admin.`
   },{status:403});
  }

  const isNumeric=param.input_type==='number';

  const correctedNumeric=isNumeric
   ?Number(b.correctedValue)
   :null;

  const correctedText=isNumeric
   ?null
   :String(b.correctedValue);

  if(isNumeric&&!Number.isFinite(correctedNumeric)){
   return NextResponse.json({
    error:'A valid numeric corrected value is required.'
   },{status:400});
  }

  const nowIso=new Date().toISOString();

  // Preserve the original captured values.
  // Record the correction separately in the append-only amendment table.
  const {data:amendment,error:ae}=await db
   .from('entry_amendments')
   .insert({
    entry_id:entry.id,
    original_value_numeric:entry.value_numeric,
    original_value_text:entry.value_text,
    corrected_value_numeric:correctedNumeric,
    corrected_value_text:correctedText,
    reason:String(b.reason).trim(),
    requested_by:user.id,
    approved_by:user.id,
    status:'approved',
    approved_at:nowIso,
   })
   .select('*')
   .single();

  if(ae)throw ae;

  const {error:ue}=await db
   .from('parameter_entries')
   .update({
    amended_value_numeric:correctedNumeric,
    amended_value_text:correctedText,
    amended_at:nowIso,
    amended_by:user.id,
    amendment_id:amendment.id
   })
   .eq('id',entry.id);

  if(ue)throw ue;

  await db.from('audit_logs').insert({
   user_id:user.id,
   module:module==='quality'
    ?'quality_management'
    :'solvent_management',
   action:'AMEND_ENTRY',
   entity_type:'parameter_entry',
   entity_id:entry.id,
   before_data:{
    value_numeric:entry.value_numeric,
    value_text:entry.value_text
   },
   after_data:{
    amended_value_numeric:correctedNumeric,
    amended_value_text:correctedText,
    reason:b.reason
   }
  });

  return NextResponse.json({amendment});

 }catch(e){
  logServerError('entries/amend',e);

  return NextResponse.json({
   error:errorMessage(e,'Unable to record amendment')
  },{status:500});
 }
}
