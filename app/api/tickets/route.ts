
import {moduleAuthorization,SOLVENT_MANAGEMENT_ROLES,QUALITY_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';
import {loadRouting,peopleFor,rolesFor} from '@/lib/ticketRouting';
import {resolveParameterMetadata} from '@/lib/parameterMetadata';
import {fetchAllRows} from '@/lib/supabase/fetchAll';

const allowedStatuses=new Set([
 'open','acknowledged','in_progress','waiting','resolved','closed','overdue'
]);

function auth(scope:string){
 return scope==='quality'
  ?moduleAuthorization('quality_management',QUALITY_MANAGEMENT_ROLES)
  :moduleAuthorization('solvent_management',SOLVENT_MANAGEMENT_ROLES);
}

function modulesFor(scope:string){
 return scope==='quality'?['quality']:['solvent','boiler'];
}

function getDeviation(ticket:any){
 return Array.isArray(ticket.deviations)
  ?ticket.deviations[0]
  :ticket.deviations;
}

function attachParameterMetadata(ticket:any,metadata:Map<number,any>){
 const deviation=getDeviation(ticket);

 if(!deviation)return ticket;

 const parameter=metadata.get(Number(deviation.parameter_id))||null;

 return {
  ...ticket,
  deviations:{
   ...deviation,
   parameter_master:parameter
  }
 };
}

export async function GET(req:NextRequest){
 try{
  const scope=req.nextUrl.searchParams.get('scope')==='quality'
   ?'quality'
   :'solvent';

  const az=await auth(scope);

  if(!az.ok){
   return NextResponse.json(
    {error:'Management access not assigned'},
    {status:az.status}
   );
  }

  const db=supabaseAdmin();
  const modules=modulesFor(scope);

  // Count tickets using parameter IDs rather than a master-table FK join.
  const {data:countRows,error:countError}=await fetchAllRows<any>(
   (from,to)=>db
    .from('deviation_tickets')
    .select('id,status,deviations!inner(parameter_id)')
    .range(from,to)
  );

  if(countError)throw countError;

  const countMetadata=await resolveParameterMetadata(
   db,
   (countRows||[]).map((ticket:any)=>{
    const deviation=getDeviation(ticket);
    return deviation?.parameter_id;
   })
  );

  const relevantCountRows=(countRows||[]).filter((ticket:any)=>{
   const deviation=getDeviation(ticket);
   const parameter=countMetadata.get(Number(deviation?.parameter_id));
   return modules.includes(String(parameter?.parameter_sections?.module));
  });

  const totalCount=relevantCountRows.length;

  const closedCount=relevantCountRows.filter(
   (ticket:any)=>['closed','resolved'].includes(ticket.status)
  ).length;

  const counts={
   total:totalCount,
   closed:closedCount,
   open:totalCount-closedCount
  };

  if(req.nextUrl.searchParams.get('summary')==='1'){
   return NextResponse.json({counts});
  }

  // Keep compatibility with deployments where recurrence migration
  // columns are not yet available.
  const list=(withRecurrence:boolean)=>db
   .from('deviation_tickets')
   .select(
    `*,ticket_evidence(*),deviations!inner(
     id,parameter_id,severity,target_text,actual_text,created_at,
     ${withRecurrence?'occurrence_count,last_observed_at,':''}
     observed_facts
    )`
   )
   .order('created_at',{ascending:false})
   .limit(500);

  let {data,error}=await list(true);

  if(
   error&&
   /occurrence_count|last_observed_at/.test(error.message||'')
  ){
   ({data,error}=await list(false));
  }

  if(error)throw error;

  const metadata=await resolveParameterMetadata(
   db,
   (data||[]).map((ticket:any)=>{
    const deviation=getDeviation(ticket);
    return deviation?.parameter_id;
   })
  );

  const tickets=(data||[])
   .map((ticket:any)=>attachParameterMetadata(ticket,metadata))
   .filter((ticket:any)=>{
    const deviation=getDeviation(ticket);
    return modules.includes(
     String(deviation?.parameter_master?.parameter_sections?.module)
    );
   });

  return NextResponse.json({tickets,counts});

 }catch(e){
  logServerError('tickets:list',e);

  return NextResponse.json({
   error:errorMessage(e,'Unable to load tickets. Please try again.')
  },{status:500});
 }
}

export async function PATCH(req:NextRequest){
 try{
  const b=await req.json();

  const scope=b.scope==='quality'?'quality':'solvent';
  const az=await auth(scope);

  if(!az.ok){
   return NextResponse.json({
    error:az.status===401
     ?'Not authenticated'
     :'Management access not assigned'
   },{status:az.status});
  }

  const user=az.user!;

  if(!b.id||!allowedStatuses.has(String(b.status))){
   return NextResponse.json({
    error:'Ticket and valid status are required.'
   },{status:400});
  }

  const db=supabaseAdmin();

  const update:any={
   status:b.status,
   root_cause:b.rootCause||null,
   corrective_action:b.correctiveAction||null,
   closure_comments:b.closureComments||null
  };

  if(['closed','resolved'].includes(b.status)){
   update.closed_by=user.id;
   update.closed_at=new Date().toISOString();
  }else{
   update.closed_by=null;
   update.closed_at=null;
  }

  // Fetch the ticket and deviation without relying on parameter_master FK.
  const found=await db
   .from('deviation_tickets')
   .select('*,deviations(parameter_id)')
   .eq('id',b.id)
   .maybeSingle();

  if(found.error)throw found.error;

  const before=found.data;

  if(!before){
   return NextResponse.json({
    error:'Ticket not found.'
   },{status:404});
  }

  const deviation=getDeviation(before);

  if(!deviation){
   return NextResponse.json({
    error:'The deviation associated with this ticket could not be found.'
   },{status:409});
  }

  const metadata=await resolveParameterMetadata(
   db,
   [deviation.parameter_id]
  );

  const parameter=metadata.get(Number(deviation.parameter_id));

  if(!parameter){
   return NextResponse.json({
    error:'Parameter metadata could not be found. Ticket update cannot be processed safely.',
    code:'PARAMETER_METADATA_NOT_FOUND'
   },{status:409});
  }

  const ticketModule=parameter.parameter_sections?.module;
  const modules=modulesFor(scope);

  if(!modules.includes(String(ticketModule))){
   return NextResponse.json({
    error:'Ticket is not in this workspace.'
   },{status:403});
  }

  if(
   ['closed','resolved'].includes(b.status)&&
   !az.roles.includes('super_admin')
  ){
   const routing=await loadRouting(db);

   const sid=parameter.section_id;
   const areaId=routing.sectionArea.get(sid);
   const closers=peopleFor(routing,areaId,'closer');

   if(
    areaId&&
    closers.length&&
    !rolesFor(routing,user.id,areaId).has('closer')
   ){
    return NextResponse.json({
     error:`Only ${closers.map(c=>c.name).join(' / ')} can close tickets for ${routing.areas.get(areaId)?.area}. Open the Tickets module to follow them.`
    },{status:403});
   }
  }

  const {data,error}=await db
   .from('deviation_tickets')
   .update(update)
   .eq('id',b.id)
   .select('*')
   .single();

  if(error)throw error;

  await db.from('audit_logs').insert({
   user_id:user.id,
   module:scope==='quality'
    ?'quality_management'
    :'solvent_management',
   action:'UPDATE_ACTION_TICKET',
   entity_type:'deviation_ticket',
   entity_id:String(b.id),
   before_data:before,
   after_data:data
  });

  return NextResponse.json({ticket:data});

 }catch(e){
  logServerError('tickets',e);

  return NextResponse.json({
   error:errorMessage(e,'Unable to update ticket')
  },{status:500});
 }
}
