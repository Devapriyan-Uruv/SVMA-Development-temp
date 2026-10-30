import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {authorization,ACCESS_APPROVAL_ROLES} from '@/lib/authorize';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {sendPushToUser} from '@/lib/push';
import {errorMessage,logServerError} from '@/lib/errors';

// GET: everyone can browse the history and see whether they've read each
// one; the client uses this same list to decide whether to pop the latest
// unread one up as a modal.
export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const [{data:items,error},{data:reads}]=await Promise.all([
  db.from('announcements').select('*,profiles!announcements_created_by_fkey(full_name,email)').eq('active',true).order('created_at',{ascending:false}).limit(100),
  db.from('announcement_reads').select('announcement_id').eq('user_id',user.id),
 ]);
 if(error)throw error;
 const readIds=new Set((reads||[]).map((r:any)=>r.announcement_id));
 const announcements=(items||[]).map((a:any)=>({id:a.id,title:a.title,body:a.body,createdAt:a.created_at,createdBy:a.profiles?.full_name||a.profiles?.email||'SVMA',read:readIds.has(a.id)}));
 return NextResponse.json({announcements,latestUnread:announcements.find(a=>!a.read)||null});
}catch(e){logServerError('announcements',e);return NextResponse.json({error:errorMessage(e,'Unable to load announcements')},{status:500})}}

// POST: publishing reaches every active user at once — a bell notification
// plus a real push, same delivery path chat messages already use, so
// nothing new has to be built for that part.
export async function POST(req:NextRequest){try{
 const az=await authorization(ACCESS_APPROVAL_ROLES);if(!az.ok)return NextResponse.json({error:'Management or Super Admin access is required'},{status:az.status});
 const b=await req.json(),title=String(b.title||'').trim(),body=String(b.body||'').trim();
 if(!title||!body)return NextResponse.json({error:'Title and message are required.'},{status:400});
 const db=supabaseAdmin();
 const {data:announcement,error}=await db.from('announcements').insert({title,body,created_by:az.user!.id}).select('*').single();
 if(error)throw error;
 try{
  const {data:allUsers}=await db.from('profiles').select('id');
  const recipientIds=(allUsers||[]).map((p:any)=>p.id).filter((id:string)=>id&&id!==az.user!.id);
  if(recipientIds.length){
   const preview=body.length>140?`${body.slice(0,140)}…`:body;
   await db.from('notifications').insert(recipientIds.map(uid=>({user_id:uid,event_type:'announcement',title,body:preview,severity:'info',entity_type:'announcement',entity_id:announcement.id,push_sent_at:new Date().toISOString()})));
   await Promise.all(recipientIds.map(uid=>sendPushToUser(db,uid,{title:`📢 ${title}`,body:preview,severity:'info',tag:'announcement',url:'/announcements'}).catch(()=>{})));
  }
 }catch{/* the announcement itself is already published either way */}
 return NextResponse.json({announcement});
}catch(e){logServerError('announcements',e);return NextResponse.json({error:errorMessage(e,'Unable to publish announcement')},{status:500})}}
