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
  if(r.document_path){try{const {data}=await db.storage.from('svma-company-documents').createSignedUrl(r.document_path,3600);documentUrl=data?.signedUrl||null}catch{}}
  return{...r,documentUrl};
 }));
}

// Readable by every authenticated user — company policy applies org-wide,
// unlike the rest of HR data which is role/relationship-scoped.
export async function GET(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin(),hr=await isHr(db,user.id);
 const includeInactive=hr&&req.nextUrl.searchParams.get('all')==='1';
 let q=db.from('company_documents').select('id,title,category,content,document_path,active,created_at,updated_at').order('created_at',{ascending:false});
 if(!includeInactive)q=q.eq('active',true);
 const {data,error}=await q;if(error)throw error;
 return NextResponse.json({records:await shape(db,data||[])});
}catch(e){logServerError('hr/company-documents',e);return NextResponse.json({error:errorMessage(e,'Unable to load company documents')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const fd=await req.formData();
 const title=String(fd.get('title')||'').trim(),content=String(fd.get('content')||'').trim(),category=String(fd.get('category')||'').trim();
 if(!title||!content)return NextResponse.json({error:'Title and content are required.'},{status:400});
 const file=fd.get('file');
 let document_path:string|null=null;
 if(file instanceof File&&file.size>0){
  if(file.size>15*1024*1024)return NextResponse.json({error:'File exceeds 15 MB.'},{status:400});
  const safe=file.name.replace(/[^A-Za-z0-9._-]/g,'_');document_path=`company-documents/${Date.now()}-${safe}`;
  const {error:up}=await db.storage.from('svma-company-documents').upload(document_path,Buffer.from(await file.arrayBuffer()),{contentType:file.type||'application/octet-stream',upsert:false});
  if(up)throw up;
 }
 const {data,error}=await db.from('company_documents').insert({title,category:category||null,content,document_path,created_by:user.id}).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:(await shape(db,[data]))[0]});
}catch(e){logServerError('hr/company-documents',e);return NextResponse.json({error:errorMessage(e,'Unable to add document')},{status:500})}}

export async function PATCH(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json();if(!b.id)return NextResponse.json({error:'id is required'},{status:400});
 const update:Record<string,any>={updated_at:new Date().toISOString()};
 if('title' in b)update.title=String(b.title||'').trim();
 if('category' in b)update.category=b.category||null;
 if('content' in b)update.content=String(b.content||'').trim();
 if('active' in b)update.active=!!b.active;
 const {data,error}=await db.from('company_documents').update(update).eq('id',b.id).select('*').single();
 if(error)throw error;
 return NextResponse.json({record:(await shape(db,[data]))[0]});
}catch(e){logServerError('hr/company-documents',e);return NextResponse.json({error:errorMessage(e,'Unable to update document')},{status:500})}}

export async function DELETE(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const id=req.nextUrl.searchParams.get('id');if(!id)return NextResponse.json({error:'id is required'},{status:400});
 const {data:row}=await db.from('company_documents').select('document_path').eq('id',id).maybeSingle();
 const {error}=await db.from('company_documents').delete().eq('id',id);
 if(error)throw error;
 try{if(row?.document_path)await db.storage.from('svma-company-documents').remove([row.document_path])}catch{}
 return NextResponse.json({ok:true});
}catch(e){logServerError('hr/company-documents',e);return NextResponse.json({error:errorMessage(e,'Unable to remove document')},{status:500})}}
