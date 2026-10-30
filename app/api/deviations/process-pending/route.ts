import {anyModuleAuthorization,SOLVENT_MANAGEMENT_ROLES,QUALITY_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// Visibility + retry for the durable follow-up queue (sql/018_v8_6_1_
// reliability_and_repair.sql: deviation_processing_failures). A deviation's
// ticket/notification creation happens atomically with the save via a
// database trigger and can never roll back the reading — but if that
// follow-up work itself fails (a bad role cast, a transient RLS issue), the
// failure is filed here instead of silently lost. GET reports counts for
// authorised staff (management/solvent head/quality head/admin); POST
// re-attempts every pending/retrying row, same pattern as the existing
// Quality SLA sweep (client-polled, no background worker in this
// deployment — see components/NotificationBell.tsx).
function auth(){
  return anyModuleAuthorization([
    {module:'solvent_management',fallbackRoles:SOLVENT_MANAGEMENT_ROLES},
    {module:'quality_management',fallbackRoles:QUALITY_MANAGEMENT_ROLES},
  ]);
}

export async function GET(){
  try{
    const az=await auth();
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Management access not assigned'},{status:az.status});
    const db=supabaseAdmin();
    const {data,error}=await db.from('deviation_processing_failures').select('id,entry_id,validation_status,error_detail,status,attempts,created_at,last_attempt_at').in('status',['pending','retrying','failed_permanent']).order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    const rows=data||[];
    return NextResponse.json({
      pending:rows.filter(r=>r.status==='pending'||r.status==='retrying').length,
      failedPermanent:rows.filter(r=>r.status==='failed_permanent').length,
      items:rows,
    });
  }catch(e){logServerError('deviations/process-pending.GET',e);return NextResponse.json({error:errorMessage(e,'Unable to load pending safety processing')},{status:500})}
}

export async function POST(){
  try{
    const az=await auth();
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Management access not assigned'},{status:az.status});
    const db=supabaseAdmin();
    const {data,error}=await db.rpc('svma_retry_pending_deviation_processing');
    if(error)throw error;
    return NextResponse.json({resolved:data??0});
  }catch(e){logServerError('deviations/process-pending.POST',e);return NextResponse.json({error:errorMessage(e,'Retry failed')},{status:500})}
}
