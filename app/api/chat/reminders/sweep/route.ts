import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';

// Client-poll-triggered delivery (called from app/chat/page.tsx alongside
// its existing conversation poll) — the same pattern already used for
// Quality's sample/result SLA sweep, since this app has no background
// worker. A due, undelivered reminder is posted into its conversation as a
// normal chat message (prefixed so it reads as a reminder in the thread)
// plus a notification per member, mirroring exactly what a real message
// send already does in app/api/chat/conversations/[id]/messages/route.ts.
export async function POST(){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 const {data:due,error}=await db.from('chat_reminders').select('id,conversation_id,message,created_by').is('delivered_at',null).lte('remind_at',new Date().toISOString()).limit(20);
 if(error)throw error;
 let delivered=0;
 for(const r of due||[]){
  try{
   const {data:msg,error:me}=await db.from('chat_messages').insert({conversation_id:r.conversation_id,sender_id:r.created_by,body:`⏰ Reminder: ${r.message}`}).select('id,created_at').single();
   if(me)throw me;
   const {data:members}=await db.from('chat_conversation_members').select('user_id').eq('conversation_id',r.conversation_id);
   if(members?.length){
    await db.from('notifications').insert(members.map((m:any)=>({user_id:m.user_id,event_type:'chat_reminder',title:'Reminder',body:r.message,severity:'info',entity_type:'chat_conversation',entity_id:r.conversation_id,push_sent_at:new Date().toISOString()})));
    await Promise.all(members.map((m:any)=>sendPushToUser(db,m.user_id,{title:'Reminder',body:r.message,severity:'info',tag:'chat_reminder',url:'/chat'}).catch(()=>{})));
   }
   await db.from('chat_reminders').update({delivered_at:msg.created_at}).eq('id',r.id);
   delivered++;
  }catch(inner){logServerError('chat/reminders/sweep-item',inner)}
 }
 return NextResponse.json({delivered});
}catch(e){logServerError('chat/reminders/sweep',e);return NextResponse.json({error:errorMessage(e,'Unable to sweep reminders')},{status:500})}}
