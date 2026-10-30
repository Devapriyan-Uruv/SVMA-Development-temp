import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

async function assertMember(db:ReturnType<typeof supabaseAdmin>,conversationId:string,userId:string){
 const {data}=await db.from('chat_conversation_members').select('user_id').eq('conversation_id',conversationId).eq('user_id',userId).maybeSingle();
 return !!data;
}
const ONLINE_WINDOW_MS=45000;
function isOnline(lastSeenAt:string|null|undefined){return !!lastSeenAt&&Date.now()-new Date(lastSeenAt).getTime()<ONLINE_WINDOW_MS}

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 if(!(await assertMember(db,id,user.id)))return NextResponse.json({error:'Not a member of this conversation'},{status:403});
 const [{data:conv,error:ce},{data:members,error:me}]=await Promise.all([
  db.from('chat_conversations').select('id,type,name,created_by,created_at').eq('id',id).single(),
  db.from('chat_conversation_members').select('user_id,joined_at,last_read_at,profiles(full_name,email,avatar_url,last_seen_at)').eq('conversation_id',id),
 ]);if(ce)throw ce;if(me)throw me;
 // First role only per member (same convention the topbar user-chip already
 // uses for the signed-in user's own role subtitle) — a passive display,
 // not the click-through profile card (see /api/directory/[id]).
 const memberIds=(members||[]).map((m:any)=>m.user_id);
 const {data:roleRows}=await db.from('user_roles').select('user_id,role').in('user_id',memberIds);
 const roleMap=new Map<string,string>();
 for(const r of roleRows||[])if(!roleMap.has(r.user_id))roleMap.set(r.user_id,String(r.role));
 return NextResponse.json({
  id:conv.id,type:conv.type,name:conv.name,createdBy:conv.created_by,createdAt:conv.created_at,
  members:(members||[]).map((m:any)=>({userId:m.user_id,name:m.profiles?.full_name||m.profiles?.email||'Unknown',avatarUrl:m.profiles?.avatar_url,role:roleMap.get(m.user_id)||null,joinedAt:m.joined_at,lastReadAt:m.last_read_at,isMe:m.user_id===user.id,online:isOnline(m.profiles?.last_seen_at),lastSeenAt:m.profiles?.last_seen_at||null})),
 });
}catch(e){logServerError('chat/conversation',e);return NextResponse.json({error:errorMessage(e,'Unable to load conversation')},{status:500})}}

// Section: "any member can be added" — membership itself is the only gate
// (no owner/admin distinction), matching how a Teams/Slack group works for
// a small internal team.
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 if(!(await assertMember(db,id,user.id)))return NextResponse.json({error:'Not a member of this conversation'},{status:403});
 const {data:conv}=await db.from('chat_conversations').select('type').eq('id',id).single();
 if(conv?.type!=='group')return NextResponse.json({error:'Only group conversations can add members.'},{status:400});
 const b=await req.json(),addMemberIds:string[]=Array.isArray(b.addMemberIds)?b.addMemberIds.map(String):[];
 if(!addMemberIds.length)return NextResponse.json({error:'Choose at least one person to add.'},{status:400});
 const {data:existing}=await db.from('chat_conversation_members').select('user_id').eq('conversation_id',id);
 const already=new Set((existing||[]).map((m:any)=>m.user_id));
 const toAdd=addMemberIds.filter(uid=>!already.has(uid));
 if(toAdd.length)await db.from('chat_conversation_members').insert(toAdd.map(uid=>({conversation_id:id,user_id:uid})));
 return NextResponse.json({added:toAdd.length});
}catch(e){logServerError('chat/conversation',e);return NextResponse.json({error:errorMessage(e,'Unable to add members')},{status:500})}}
