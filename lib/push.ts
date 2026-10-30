import webpush from 'web-push';
import type {supabaseAdmin} from './supabase/admin';

let configured=false;
function ensureConfigured(){
 if(configured)return true;
 const pub=process.env.VAPID_PUBLIC_KEY,priv=process.env.VAPID_PRIVATE_KEY,subject=process.env.VAPID_SUBJECT;
 if(!pub||!priv||!subject)return false;
 webpush.setVapidDetails(subject,pub,priv);
 configured=true;
 return true;
}

export type PushPayload={title:string;body:string;url?:string;tag?:string;severity?:string};

// Sends a real OS-level push to every device the user has subscribed on
// (there can be more than one — phone + laptop) and prunes any
// subscription the push service reports as gone (410/404) so a stale
// device doesn't keep failing forever. Silently no-ops if VAPID keys
// aren't configured, so notification creation itself is never blocked by
// push delivery being unavailable — same "never fail the primary action"
// principle already used for the in-app bell notification inserts
// throughout this codebase.
export async function sendPushToUser(db:ReturnType<typeof supabaseAdmin>,userId:string,payload:PushPayload){
 if(!ensureConfigured())return;
 const {data:subs}=await db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id',userId);
 if(!subs?.length)return;
 // The service worker used to compute this itself with its own fetch to
 // /api/notifications — an extra round trip that depends on the SW's fetch
 // carrying the right session cookie, which is a fragile thing to rely on
 // in that context. Computing it here means the SW can just read it
 // straight off the push payload with no fetch of its own.
 let badge:number|undefined;
 try{const {count}=await db.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',userId).is('read_at',null);badge=count??undefined}catch{}
 const body=JSON.stringify({...payload,badge});
 await Promise.all(subs.map(async(s:any)=>{
  try{
   await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},body);
  }catch(e:any){
   if(e?.statusCode===404||e?.statusCode===410){try{await db.from('push_subscriptions').delete().eq('id',s.id)}catch{}}
  }
 }));
}
