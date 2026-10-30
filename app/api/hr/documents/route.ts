import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {errorMessage,logServerError} from '@/lib/errors';

// Predefined categories so HR can see at a glance what's missing per
// employee; 'other' with a free label covers anything not on this list —
// same both/and approach employee_documents.category+label already models.
export const DOCUMENT_CATEGORIES=['aadhaar','pan','passport','address_proof','education_certificate','resume','offer_letter','experience_letter','relieving_letter','photo','other'];

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}
function targetProfileId(hr:boolean,requested:string|null,selfId:string){return hr&&requested?requested:selfId}
async function shape(db:ReturnType<typeof supabaseAdmin>,rows:any[]){
 return Promise.all(rows.map(async(r:any)=>{
  let documentUrl:string|null=null;
  if(r.document_path){try{const {data}=await db.storage.from('svma-hr-documents').createSignedUrl(r.document_path,3600);documentUrl=data?.signedUrl||null}catch{}}
  return{...r,documentUrl};
 }));
}

export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const profileId=targetProfileId(hr,req.nextUrl.searchParams.get('profileId'),user.id);
 const {data,error}=await db.from('employee_documents').select('*').eq('profile_id',profileId).order('uploaded_at',{ascending:false});
 if(error)throw error;
 return NextResponse.json({records:await shape(db,data||[]),categories:DOCUMENT_CATEGORIES});
}catch(e){logServerError('hr/documents',e);return NextResponse.json({error:errorMessage(e,'Unable to load documents')},{status:500})}}

// Self-service: an employee can upload their own documents (no HR
// approval gate, matching the same "saves directly" behaviour as personal
// details and education), and HR can upload for anyone.
export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const fd=await req.formData();
 const profileId=targetProfileId(hr,String(fd.get('profileId')||'')||null,user.id);
 const category=DOCUMENT_CATEGORIES.includes(String(fd.get('category')))?String(fd.get('category')):'other';
 const label=String(fd.get('label')||'').trim();
 const file=fd.get('file');
 if(!(file instanceof File)||file.size===0)return NextResponse.json({error:'Choose a file to upload.'},{status:400});
 if(file.size>15*1024*1024)return NextResponse.json({error:'Document exceeds 15 MB.'},{status:400});
 const safe=file.name.replace(/[^A-Za-z0-9._-]/g,'_'),document_path=`documents/${profileId}/${Date.now()}-${safe}`;
 const {error:up}=await db.storage.from('svma-hr-documents').upload(document_path,Buffer.from(await file.arrayBuffer()),{contentType:file.type||'application/octet-stream',upsert:false});
 if(up)throw up;
 const {data,error}=await db.from('employee_documents').insert({profile_id:profileId,category,label:label||null,document_path,file_name:file.name,uploaded_by:user.id}).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:(await shape(db,[data]))[0]});
}catch(e){logServerError('hr/documents',e);return NextResponse.json({error:errorMessage(e,'Unable to upload document')},{status:500})}}

export async function DELETE(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const id=req.nextUrl.searchParams.get('id');if(!id)return NextResponse.json({error:'id is required'},{status:400});
 const {data:row}=await db.from('employee_documents').select('profile_id,document_path').eq('id',id).maybeSingle();
 if(!row)return NextResponse.json({error:'Not found'},{status:404});
 if(!hr&&row.profile_id!==user.id)return NextResponse.json({error:'You can only remove your own documents.'},{status:403});
 const {error}=await db.from('employee_documents').delete().eq('id',id);
 if(error)throw error;
 try{if(row.document_path)await db.storage.from('svma-hr-documents').remove([row.document_path])}catch{}
 return NextResponse.json({ok:true});
}catch(e){logServerError('hr/documents',e);return NextResponse.json({error:errorMessage(e,'Unable to remove document')},{status:500})}}
