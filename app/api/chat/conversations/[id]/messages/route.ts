import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';

async function assertMember(db:ReturnType<typeof supabaseAdmin>,conversationId:string,userId:string){
 const {data}=await db.from('chat_conversation_members').select('user_id').eq('conversation_id',conversationId).eq('user_id',userId).maybeSingle();
 return !!data;
}

async function shape(db:ReturnType<typeof supabaseAdmin>,rows:any[],myId:string){
 const ids=rows.map((m:any)=>m.id);
 let reactionsByMessage=new Map<string,{emoji:string;count:number;reactedByMe:boolean;users:string[]}[]>();
 if(ids.length){
  const {data:allReactions}=await db.from('chat_message_reactions').select('message_id,emoji,user_id,profiles(full_name,email)').in('message_id',ids);
  const grouped=new Map<string,Map<string,{emoji:string;count:number;reactedByMe:boolean;users:string[]}>>();
  for(const r of allReactions||[]){
   const byEmoji=grouped.get(r.message_id)||new Map();
   const g=byEmoji.get(r.emoji)||{emoji:r.emoji,count:0,reactedByMe:false,users:[]};
   g.count++;if(r.user_id===myId)g.reactedByMe=true;g.users.push((r as any).profiles?.full_name||(r as any).profiles?.email||'Someone');
   byEmoji.set(r.emoji,g);grouped.set(r.message_id,byEmoji);
  }
  reactionsByMessage=new Map(Array.from(grouped.entries()).map(([k,v])=>[k,Array.from(v.values())]));
 }
 return Promise.all(rows.map(async(m:any)=>{
  let attachmentUrl:string|null=null;
  if(m.attachment_path){try{const {data}=await db.storage.from('svma-chat-files').createSignedUrl(m.attachment_path,3600);attachmentUrl=data?.signedUrl||null}catch{}}
  return{id:m.id,body:m.body,createdAt:m.created_at,senderId:m.sender_id,senderName:m.profiles?.full_name||m.profiles?.email||'Unknown',senderAvatarUrl:m.profiles?.avatar_url||null,isMe:m.sender_id===myId,attachmentUrl,attachmentName:m.attachment_name,attachmentMime:m.attachment_mime,attachmentSize:m.attachment_size,reactions:reactionsByMessage.get(m.id)||[]};
 }));
}

export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 if(!(await assertMember(db,id,user.id)))return NextResponse.json({error:'Not a member of this conversation'},{status:403});
 const after=req.nextUrl.searchParams.get('after');
 let q=db.from('chat_messages').select('id,body,created_at,sender_id,profiles!chat_messages_sender_id_fkey(full_name,email,avatar_url),attachment_path,attachment_name,attachment_mime,attachment_size').eq('conversation_id',id).order('created_at',{ascending:false}).limit(80);
 if(after)q=db.from('chat_messages').select('id,body,created_at,sender_id,profiles!chat_messages_sender_id_fkey(full_name,email,avatar_url),attachment_path,attachment_name,attachment_mime,attachment_size').eq('conversation_id',id).gt('created_at',after).order('created_at',{ascending:true}).limit(200);
 const {data,error}=await q;if(error)throw error;
 const rows=after?(data||[]):[...(data||[])].reverse();
 return NextResponse.json({messages:await shape(db,rows,user.id)});
}catch(e){logServerError('chat/messages',e);return NextResponse.json({error:errorMessage(e,'Unable to load messages')},{status:500})}}

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id}=await params,db=supabaseAdmin();
 if(!(await assertMember(db,id,user.id)))return NextResponse.json({error:'Not a member of this conversation'},{status:403});
 const fd=await req.formData(),body=String(fd.get('body')||'').trim(),file=fd.get('file');
 if(!body&&!(file instanceof File))return NextResponse.json({error:'Write a message or attach a file.'},{status:400});
 if(body.length>4000)return NextResponse.json({error:'Message is too long (4000 characters max).'},{status:400});
 let attachment_path:string|null=null,attachment_name:string|null=null,attachment_mime:string|null=null,attachment_size:number|null=null;
 if(file instanceof File){
  if(file.size>20*1024*1024)return NextResponse.json({error:'Attachment exceeds 20 MB.'},{status:400});
  const safe=file.name.replace(/[^A-Za-z0-9._-]/g,'_');attachment_path=`${id}/${Date.now()}-${safe}`;
  const {error:up}=await db.storage.from('svma-chat-files').upload(attachment_path,Buffer.from(await file.arrayBuffer()),{contentType:file.type||'application/octet-stream',upsert:false});if(up)throw up;
  attachment_name=file.name;attachment_mime=file.type||null;attachment_size=file.size;
 }
 const {data,error}=await db.from('chat_messages').insert({conversation_id:id,sender_id:user.id,body:body||null,attachment_path,attachment_name,attachment_mime,attachment_size}).select('id,created_at').single();if(error)throw error;
 await db.from('chat_conversation_members').update({last_read_at:data.created_at}).eq('conversation_id',id).eq('user_id',user.id);
 try{
  const {data:otherMembers}=await db.from('chat_conversation_members').select('user_id').eq('conversation_id',id).neq('user_id',user.id);
  const {data:sender}=await db.from('profiles').select('full_name,email').eq('id',user.id).maybeSingle();
  const senderName=sender?.full_name||sender?.email||'Someone';
  const preview=body?(body.length>80?`${body.slice(0,80)}…`:body):`Sent ${attachment_name||'an attachment'}`;
  if(otherMembers?.length){
   const {data:inserted}=await db.from('notifications').insert(otherMembers.map((m:any)=>({user_id:m.user_id,event_type:'chat_message',title:senderName,body:preview,severity:'info',entity_type:'chat_conversation',entity_id:id,push_sent_at:new Date().toISOString()}))).select('id,user_id,title,body,severity');
   if(inserted?.length)await Promise.all(inserted.map((n:any)=>sendPushToUser(db,n.user_id,{title:n.title,body:n.body||'',severity:n.severity,tag:'chat_message',url:'/chat'}).catch(()=>{})));
  }
 }catch{/* chat delivery must never fail because a bell notification couldn't be written */}
 return NextResponse.json({message:{id:data.id,createdAt:data.created_at}});
}catch(e){logServerError('chat/messages',e);return NextResponse.json({error:errorMessage(e,'Unable to send message')},{status:500})}}
