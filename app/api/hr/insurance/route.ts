import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}
async function shape(db:ReturnType<typeof supabaseAdmin>,rows:any[]){
 return Promise.all(rows.map(async(r:any)=>{
  let documentUrl:string|null=null;
  if(r.document_path){try{const {data}=await db.storage.from('svma-hr-documents').createSignedUrl(r.document_path,3600);documentUrl=data?.signedUrl||null}catch{}}
  return{...r,documentUrl};
 }));
}

// Same private-bucket + signed-URL pattern as chat/approval/ticket
// attachments (svma-chat-files, svma-approval-files, svma-ticket-evidence) —
// see app/api/chat/conversations/[id]/messages/route.ts for the reference
// implementation this mirrors.
export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const requested=req.nextUrl.searchParams.get('profileId');
 const profileId=hr&&requested?requested:user.id;
 const {data,error}=await db.from('employee_insurance').select('*').eq('profile_id',profileId).order('start_date',{ascending:false});
 if(error)throw error;
 return NextResponse.json({records:await shape(db,data||[])});
}catch(e){logServerError('hr/insurance',e);return NextResponse.json({error:errorMessage(e,'Unable to load insurance records')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const fd=await req.formData();
 const profileId=String(fd.get('profileId')||''),policyType=String(fd.get('policyType')||'').trim(),file=fd.get('file');
 if(!profileId||!policyType)return NextResponse.json({error:'Employee and policy type are required.'},{status:400});
 let document_path:string|null=null;
 if(file instanceof File&&file.size>0){
  if(file.size>15*1024*1024)return NextResponse.json({error:'Document exceeds 15 MB.'},{status:400});
  const safe=file.name.replace(/[^A-Za-z0-9._-]/g,'_');document_path=`${profileId}/${Date.now()}-${safe}`;
  const {error:up}=await db.storage.from('svma-hr-documents').upload(document_path,Buffer.from(await file.arrayBuffer()),{contentType:file.type||'application/octet-stream',upsert:false});
  if(up)throw up;
 }
 const {data,error}=await db.from('employee_insurance').insert({
  profile_id:profileId,policy_type:policyType,provider:String(fd.get('provider')||'')||null,policy_number:String(fd.get('policyNumber')||'')||null,
  coverage_amount:fd.get('coverageAmount')?Number(fd.get('coverageAmount')):null,premium:fd.get('premium')?Number(fd.get('premium')):null,
  start_date:String(fd.get('startDate')||'')||null,end_date:String(fd.get('endDate')||'')||null,
  dependents_covered:fd.get('dependentsCovered')?Number(fd.get('dependentsCovered')):0,
  document_path,notes:String(fd.get('notes')||'')||null,created_by:user.id,
 }).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:(await shape(db,[data]))[0]});
}catch(e){logServerError('hr/insurance',e);return NextResponse.json({error:errorMessage(e,'Unable to save insurance record')},{status:500})}}
