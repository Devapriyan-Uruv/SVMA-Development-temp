import {moduleAuthorization,OPS_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
const allowedStatuses=new Set(['open','acknowledged','in_progress','waiting','resolved','closed','overdue']);
// ops_exception_id is not null is what scopes these to ERP-origin tickets —
// every existing Solvent/Quality ticket query does an INNER join through
// deviation_id instead, so this filter is naturally disjoint from theirs
// with zero changes to their queries (see sql/042_operations_intelligence_reconciliation.sql).
export async function GET(req:NextRequest){try{
 const az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:'Operations Intelligence access not assigned'},{status:az.status});
 const db=supabaseAdmin();
 const {data,error}=await db.from('deviation_tickets').select('*,ticket_evidence(*),ops_exceptions(exception_type,severity,report_date,module,description,ai_narrative,expected_value,actual_value,variance,variance_pct,tolerance_used,reference_ids,ops_product_master(display_name))').not('ops_exception_id','is',null).order('created_at',{ascending:false}).limit(300);
 if(error)throw error;
 const total=data?.length||0,closed=(data||[]).filter((t:any)=>['closed','resolved'].includes(t.status)).length;
 return NextResponse.json({tickets:data||[],counts:{total,closed,open:total-closed}});
 }catch{return NextResponse.json({error:'Unable to load tickets. Please try again.'},{status:500})}}
export async function PATCH(req:NextRequest){try{
 const b=await req.json(),az=await moduleAuthorization('operations_intelligence',OPS_ROLES);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Operations Intelligence access not assigned'},{status:az.status});
 const user=az.user!;
 if(!b.id||!allowedStatuses.has(String(b.status)))return NextResponse.json({error:'Ticket and valid status are required.'},{status:400});
 const db=supabaseAdmin();
 const found=await db.from('deviation_tickets').select('id,ops_exception_id').eq('id',b.id).maybeSingle();
 if(found.error||!found.data||!(found.data as any).ops_exception_id)return NextResponse.json({error:'Ticket is not an operations ticket.'},{status:403});
 const update:any={status:b.status,root_cause:b.rootCause||null,corrective_action:b.correctiveAction||null,closure_comments:b.closureComments||null};
 if(['closed','resolved'].includes(b.status)){update.closed_by=user.id;update.closed_at=new Date().toISOString()}else{update.closed_by=null;update.closed_at=null}
 const {data,error}=await db.from('deviation_tickets').update(update).eq('id',b.id).select('*').single();
 if(error)throw error;
 return NextResponse.json({ticket:data});
 }catch(e){logServerError('erp/tickets',e);return NextResponse.json({error:errorMessage(e,'Unable to update ticket')},{status:500})}}
