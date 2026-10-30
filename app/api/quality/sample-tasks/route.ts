import {moduleAuthorization,QUALITY_INPUT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// Sections T, U, V, W, X, Y: the expected-sample schedule for the active
// Quality shift session, and the "Sample Received" action that starts the
// result SLA clock. Generation of these rows happens once, when the
// session opens (see app/api/shift/session/route.ts POST for scope=quality).

export async function GET(req:NextRequest){
  try{
    const az=await moduleAuthorization('quality_input',QUALITY_INPUT_ROLES);
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Quality input access not assigned'},{status:az.status});
    const shiftSessionId=req.nextUrl.searchParams.get('shiftSessionId');
    if(!shiftSessionId)return NextResponse.json({tasks:[]});
    const db=supabaseAdmin();
    const {data,error}=await db.from('quality_sample_tasks').select('*,parameter_master(name,source_group,source_serial,target_text,unit,sample_frequency,result_latency_minutes)').eq('shift_session_id',shiftSessionId).order('sample_due_at',{ascending:true});
    if(error)throw error;
    return NextResponse.json({tasks:data||[]});
  }catch(e){logServerError('quality/sample-tasks',e);return NextResponse.json({error:errorMessage(e,'Unable to load sample tasks')},{status:500})}
}

export async function PATCH(req:NextRequest){
  try{
    const az=await moduleAuthorization('quality_input',QUALITY_INPUT_ROLES);
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Quality input access not assigned'},{status:az.status});
    const b=await req.json();
    if(!b.taskId)return NextResponse.json({error:'taskId is required.'},{status:400});
    const db=supabaseAdmin();
    const {data:task,error:te}=await db.from('quality_sample_tasks').select('*').eq('id',b.taskId).single();
    if(te)throw te;
    if(task.sample_received_at)return NextResponse.json({task}); // idempotent — already marked
    const {data:param}=await db.from('parameter_master').select('result_latency_minutes').eq('id',task.parameter_id).single();
    const now=new Date();
    const resultDue=param?.result_latency_minutes!=null?new Date(now.getTime()+Number(param.result_latency_minutes)*60000).toISOString():task.result_due_at;
    const {data,error}=await db.from('quality_sample_tasks').update({sample_received_at:now.toISOString(),result_due_at:resultDue,status:'sample_received'}).eq('id',b.taskId).select('*').single();
    if(error)throw error;
    return NextResponse.json({task:data});
  }catch(e){logServerError('quality/sample-tasks',e);return NextResponse.json({error:errorMessage(e,'Unable to update sample task')},{status:500})}
}
