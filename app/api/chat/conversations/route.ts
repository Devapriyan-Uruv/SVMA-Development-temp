import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

const ONLINE_WINDOW_MS=45000;
function isOnline(lastSeenAt:string|null|undefined){return !!lastSeenAt&&Date.now()-new Date(lastSeenAt).getTime()<ONLINE_WINDOW_MS}

async function conversationIdentity(db:ReturnType<typeof supabaseAdmin>,conv:any,myId:string){
 if(conv.type==='group')return {label:conv.name||'Group chat',avatarUrl:null as string|null,online:false,lastSeenAt:null as string|null};
 const {data:members}=await db.from('chat_conversation_members').select('user_id,profiles(full_name,email,avatar_url,last_seen_at)').eq('conversation_id',conv.id).neq('user_id',myId).limit(1);
 const other=members?.[0] as any;
 return {label:other?.profiles?.full_name||other?.profiles?.email||'Direct message',avatarUrl:other?.profiles?.avatar_url||null,online:isOnline(other?.profiles?.last_seen_at),lastSeenAt:other?.profiles?.last_seen_at||null};
}

export async function GET(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data:memberships,error:me}=await db.from('chat_conversation_members').select('conversation_id,last_read_at').eq('user_id',user.id);if(me)throw me;
 const ids=(memberships||[]).map((m:any)=>m.conversation_id);
 if(!ids.length)return NextResponse.json({conversations:[]});
 const readMap=new Map((memberships||[]).map((m:any)=>[m.conversation_id,m.last_read_at]));
 const [{data:convs,error:ce},{data:allMembers}]=await Promise.all([
  db.from('chat_conversations').select('id,type,name,created_at').in('id',ids),
  db.from('chat_conversation_members').select('conversation_id,user_id').in('conversation_id',ids),
 ]);if(ce)throw ce;
 const memberCounts=new Map<string,number>();for(const m of allMembers||[])memberCounts.set(m.conversation_id,(memberCounts.get(m.conversation_id)||0)+1);
 const results=await Promise.all((convs||[]).map(async(c:any)=>{
  const {label,avatarUrl,online,lastSeenAt}=await conversationIdentity(db,c,user.id);
  const lastReadAt=readMap.get(c.id);
  const [{data:lastMsg},{count:unread}]=await Promise.all([
   db.from('chat_messages').select('body,created_at,sender_id,profiles!chat_messages_sender_id_fkey(full_name,email),attachment_name').eq('conversation_id',c.id).order('created_at',{ascending:false}).limit(1).maybeSingle(),
   lastReadAt?db.from('chat_messages').select('id',{count:'exact',head:true}).eq('conversation_id',c.id).gt('created_at',lastReadAt).neq('sender_id',user.id):db.from('chat_messages').select('id',{count:'exact',head:true}).eq('conversation_id',c.id).neq('sender_id',user.id),
  ]);
  return{
   id:c.id,type:c.type,name:label,avatarUrl,online,lastSeenAt,memberCount:memberCounts.get(c.id)||0,createdAt:c.created_at,
   lastMessage:lastMsg?{body:lastMsg.body,createdAt:lastMsg.created_at,senderName:(lastMsg as any).profiles?.full_name||(lastMsg as any).profiles?.email||'Unknown',attachmentName:lastMsg.attachment_name}:null,
   unreadCount:unread||0,
  };
 }));
 results.sort((a,b)=>new Date(b.lastMessage?.createdAt||b.createdAt).getTime()-new Date(a.lastMessage?.createdAt||a.createdAt).getTime());
 return NextResponse.json({conversations:results});
}catch(e){logServerError('chat/conversations',e);return NextResponse.json({error:errorMessage(e,'Unable to load conversations')},{status:500})}}

export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const b=await req.json(),type=b.type==='group'?'group':'direct',memberIds:string[]=Array.isArray(b.memberIds)?b.memberIds.map(String).filter((id:string)=>id&&id!==user.id):[];
 if(!memberIds.length)return NextResponse.json({error:'Choose at least one other person.'},{status:400});
 const db=supabaseAdmin();
 if(type==='direct'){
  const otherId=memberIds[0];
  const [{data:mine},{data:theirs}]=await Promise.all([
   db.from('chat_conversation_members').select('conversation_id').eq('user_id',user.id),
   db.from('chat_conversation_members').select('conversation_id').eq('user_id',otherId),
  ]);
  const mineIds=new Set((mine||[]).map((m:any)=>m.conversation_id));
  const sharedIds=(theirs||[]).map((m:any)=>m.conversation_id).filter((id:string)=>mineIds.has(id));
  if(sharedIds.length){
   const {data:existingDirect}=await db.from('chat_conversations').select('id').in('id',sharedIds).eq('type','direct').limit(1).maybeSingle();
   if(existingDirect)return NextResponse.json({conversationId:existingDirect.id,existed:true});
  }
  const {data:conv,error:ce}=await db.from('chat_conversations').insert({type:'direct',created_by:user.id}).select('id').single();if(ce)throw ce;
  await db.from('chat_conversation_members').insert([{conversation_id:conv.id,user_id:user.id},{conversation_id:conv.id,user_id:otherId}]);
  return NextResponse.json({conversationId:conv.id});
 }
 const name=String(b.name||'').trim();if(!name)return NextResponse.json({error:'Group name is required.'},{status:400});
 const {data:conv,error:ce}=await db.from('chat_conversations').insert({type:'group',name,created_by:user.id}).select('id').single();if(ce)throw ce;
 const uniqueMembers=Array.from(new Set([user.id,...memberIds]));
 await db.from('chat_conversation_members').insert(uniqueMembers.map(uid=>({conversation_id:conv.id,user_id:uid})));
 return NextResponse.json({conversationId:conv.id});
}catch(e){logServerError('chat/conversations',e);return NextResponse.json({error:errorMessage(e,'Unable to start conversation')},{status:500})}}
