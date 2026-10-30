import {supabaseAdmin} from './supabase/admin';
import {sendPushToUser} from './push';

// Shared by the background loop (instrumentation.ts, runs inside this same
// server process on Render) and the /api/push/sweep route (kept as a
// manual/secret-gated trigger for testing or a one-off catch-up run).
// Catches every notification this app's own request handlers could NOT
// push at the moment it was created — the deviation-alert trigger
// (svma_process_deviation_entry, sql/018) inserts straight into
// `notifications` from inside Postgres, with no HTTP request in flight to
// hang a push send off of.
export async function runPushSweep(limit=200){
 const db=supabaseAdmin();
 const {data:pending,error}=await db.from('notifications').select('id,user_id,title,body,event_type,entity_type,entity_id,severity').is('push_sent_at',null).order('created_at',{ascending:true}).limit(limit);
 if(error)throw error;
 let sent=0;
 for(const n of pending||[]){
  try{
   await sendPushToUser(db,n.user_id,{title:n.title,body:n.body||'',severity:n.severity||undefined,tag:n.entity_type||undefined,url:'/'});
   await db.from('notifications').update({push_sent_at:new Date().toISOString()}).eq('id',n.id);
   sent++;
  }catch{/* leave push_sent_at null so this row is retried next sweep */}
 }
 return {swept:pending?.length||0,sent};
}
