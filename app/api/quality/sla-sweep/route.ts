import {moduleAuthorization,QUALITY_INPUT_ROLES} from '@/lib/authorize';
import {NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';

// Sections W, X, Y: sample-overdue and result-overdue detection. There is
// no background job runner in this deployment, so overdue detection is
// computed on demand — this route is polled lightly by the Quality
// workspace (see components/NotificationBell.tsx and app/quality pages)
// the same way the notification bell already polls every 45s. Every write
// here is idempotent via the notifications.dedupe_key unique index, so
// repeated sweeps can never double-notify for the same overdue task.

export async function GET(){
  try{
    const az=await moduleAuthorization('quality_input',QUALITY_INPUT_ROLES);
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Quality input access not assigned'},{status:az.status});
    const db=supabaseAdmin(),now=new Date();

    const {data:pending,error:pe}=await db.from('quality_sample_tasks').select('id,shift_session_id,parameter_id,product_code,sample_due_at,status,parameter_master(name,parameter_sections(module))').is('sample_received_at',null).in('status',['pending']).lte('sample_due_at',now.toISOString());
    if(pe)throw pe;
    // A flat 30-minute buffer for every parameter, replacing the old
    // per-parameter sample_grace_minutes (which defaulted to 15 and was
    // inconsistent across the chart) — sample-overdue now means "more
    // than 30 minutes past due," full stop, for all Quality parameters.
    const SAMPLE_OVERDUE_BUFFER_MINUTES=30;
    const overdueSamples=((pending||[]) as any[]).filter((t:any)=>now.getTime()-new Date(t.sample_due_at).getTime()>SAMPLE_OVERDUE_BUFFER_MINUTES*60000);
    for(const t of overdueSamples){
      await db.from('quality_sample_tasks').update({status:'sample_overdue'}).eq('id',t.id);
      await notify(db,t,'sample_overdue',`SAMPLE OVERDUE • ${t.parameter_master?.name}`,`Sample was due ${new Date(t.sample_due_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} and has still not been marked received.`);
    }

    const {data:awaitingResult,error:re}=await db.from('quality_sample_tasks').select('id,shift_session_id,parameter_id,product_code,result_due_at,status,parameter_master(name,parameter_sections(module))').not('sample_received_at','is',null).is('result_submitted_at',null).in('status',['sample_received']).not('result_due_at','is',null).lte('result_due_at',now.toISOString());
    if(re)throw re;
    for(const t of (awaitingResult||[]) as any[]){
      await db.from('quality_sample_tasks').update({status:'result_overdue'}).eq('id',t.id);
      await notify(db,t,'result_overdue',`QC RESULT OVERDUE • ${t.parameter_master?.name}`,`Result was due ${new Date(t.result_due_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} and has still not been entered.`);
    }

    return NextResponse.json({sampleOverdue:overdueSamples.length,resultOverdue:(awaitingResult||[]).length});
  }catch(e){logServerError('quality/sla-sweep',e);return NextResponse.json({error:errorMessage(e,'SLA sweep failed')},{status:500})}
}

// Overdue-sample/result nudges are Quality's own operational housekeeping
// — Management/CEO/Admin/Super Admin don't need to see every late sample,
// and Solvent's Head was never relevant to a Quality overdue task in the
// first place. Only the Quality team itself gets these.
async function notify(db:ReturnType<typeof supabaseAdmin>,task:any,kind:'sample_overdue'|'result_overdue',title:string,body:string){
  const {data:roleRows}=await db.from('user_roles').select('user_id,role').in('role',['quality_head','quality_operator']);
  const recipientIds=Array.from(new Set((roleRows||[]).map((x:any)=>x.user_id).filter(Boolean)));
  if(!recipientIds.length)return;
  const payload=recipientIds.map(uid=>({user_id:uid,event_type:`quality_${kind}`,title,body,severity:'warning',entity_type:'quality_sample_task',entity_id:task.id,dedupe_key:`${kind}:${task.id}:${uid}`}));
  // Same ON CONFLICT DO NOTHING + RETURNING trick as app/api/entries/route.ts
  // — only genuinely-new rows come back, so a repeated sweep never sends the
  // same overdue push twice.
  const {data:justInserted}=await db.from('notifications').upsert(payload,{onConflict:'dedupe_key',ignoreDuplicates:true}).select('id,user_id,title,body,severity');
  if(justInserted?.length){
    await Promise.all(justInserted.map((n:any)=>sendPushToUser(db,n.user_id,{title:n.title,body:n.body||'',severity:n.severity,tag:'quality_sla',url:'/quality/tickets'}).catch(()=>{})));
    await db.from('notifications').update({push_sent_at:new Date().toISOString()}).in('id',justInserted.map((n:any)=>n.id));
  }
}
