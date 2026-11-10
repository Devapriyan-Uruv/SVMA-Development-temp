import {moduleAuthorization,INPUT_ROLES,QUALITY_INPUT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {productName} from '@/lib/products';
import {numericDeviatesFromTarget,categoricalDeviatesFromTarget} from '@/lib/targetParser';
import {errorMessage,logServerError} from '@/lib/errors';
import {sendPushToUser} from '@/lib/push';
import {fetchAllRows} from '@/lib/supabase/fetchAll';

// ---------------------------------------------------------------------
// Deterministic validation (Sections F, G, I). This is the SAME rule set
// that shipped before (numeric warning/critical bounds when configured,
// falling back to source-target-text parsing, plus categorical check/select
// rules) — it now also recognises the plain-English "BELOW/MAX/ABOVE/MIN"
// wording the new Quality workbook uses (see lib/targetParser.ts) and
// distinguishes an unconfigured target from a normal reading instead of
// silently collapsing both into "normal".
// ---------------------------------------------------------------------
function validation(param:any,value:any){
  if(value===null||value===undefined||String(value).trim()==='')return {validationStatus:'missing',severity:null};
  const target=String(param.target_text||'').trim();
  // Business rule: every deviation must be anchored to a target that is
  // visible on the data-entry screen. Hidden numeric limits alone are not
  // sufficient evidence for a deviation. The POST handler rejects a
  // target-less submission before this validator runs; this fallback remains
  // defensive so a missing target can never become a deviation.
  if(!target)return {validationStatus:'unconfigured',severity:null}; // TARGET NOT CONFIGURED
  // A parameter's own configured deviation_severity (set for the whole
  // Solvent/Boiler safety checklist — see sql/052) is the authoritative label
  // for ANY deviation raised on it, overriding the magnitude/keyword-based
  // guess below. It is null for every other parameter (all of Quality, plus
  // any Solvent/Boiler row this checklist doesn't cover), so their behavior
  // is byte-for-byte unchanged.
  const sev=(s:'warning'|'critical')=>param.deviation_severity||s;
  if(param.input_type==='number'){
    const n=Number(value);
    if(!Number.isFinite(n))return {validationStatus:'critical',severity:'critical'};
    if((param.critical_low!=null&&n<Number(param.critical_low))||(param.critical_high!=null&&n>Number(param.critical_high))){const s=sev('critical');return {validationStatus:s,severity:s};}
    if((param.warning_low!=null&&n<Number(param.warning_low))||(param.warning_high!=null&&n>Number(param.warning_high))){const s=sev('warning');return {validationStatus:s,severity:s};}
    if(param.warning_low==null&&param.warning_high==null&&param.critical_low==null&&param.critical_high==null&&numericDeviatesFromTarget(target,n)){const s=sev('warning');return {validationStatus:s,severity:s};}
    return {validationStatus:'normal',severity:null};
  }
  const actual=String(value).trim().toUpperCase();
  if(['check','select'].includes(param.input_type)){
    if(categoricalDeviatesFromTarget(target,actual)){const s=sev('critical');return {validationStatus:s,severity:s};}
    if(actual==='OTHER'&&target.toUpperCase().includes('RED & YELLOW')){const s=sev('warning');return {validationStatus:s,severity:s};}
  }
  return {validationStatus:'normal',severity:null};
}
function dbStatus(validationStatus:string){
  if(validationStatus==='critical')return 'critical';
  if(validationStatus==='warning')return 'warning';
  if(validationStatus==='unconfigured')return 'target_missing';
  if(validationStatus==='missing')return 'missing';
  return 'normal';
}
function authFor(scope:string){return scope==='quality'?moduleAuthorization('quality_input',QUALITY_INPUT_ROLES):moduleAuthorization('input',INPUT_ROLES)}
// Quality's own "target not configured" alert is Quality's problem to fix
// — scoped to the Quality team alone (not Solvent's Head, Management, CEO,
// Admin or Super Admin). Solvent's list is unchanged.
function notifyRolesFor(scope:string){return scope==='quality'?['quality_head','quality_operator']:['solvent_head','management','ceo','admin','super_admin']}

async function notifyRecipients(db:ReturnType<typeof supabaseAdmin>,roles:string[],selfId:string,rows:{eventType:string;title:string;body:string;severity:string;entityType:string;entityId:string|null;dedupeSuffix:string}[]){
  if(!rows.length)return;
  const {data:roleRows}=await db.from('user_roles').select('user_id,role').in('role',roles);
  const recipientIds=Array.from(new Set([selfId,...(roleRows||[]).map((x:any)=>x.user_id).filter(Boolean)]));
  if(!recipientIds.length)return;
  const payload=recipientIds.flatMap(uid=>rows.map(r=>({user_id:uid,event_type:r.eventType,title:r.title,body:r.body,severity:r.severity,entity_type:r.entityType,entity_id:r.entityId,dedupe_key:`${r.dedupeSuffix}:${uid}`})));
  // De-duplicated, idempotent insert (Section L): a retried/offline-queued
  // submission can never spam the same recipient with the same event twice.
  // ON CONFLICT DO NOTHING + RETURNING only ever hands back the rows that
  // were genuinely just inserted (Postgres never returns a skipped
  // conflict row), which is exactly what push delivery needs to avoid
  // sending the same push twice on a retry.
  const {data:justInserted}=await db.from('notifications').upsert(payload,{onConflict:'dedupe_key',ignoreDuplicates:true}).select('id,user_id,title,body,severity,entity_type');
  if(justInserted?.length){
    await Promise.all(justInserted.map((n:any)=>sendPushToUser(db,n.user_id,{title:n.title,body:n.body||'',severity:n.severity,tag:n.entity_type,url:'/'}).catch(()=>{})));
    await db.from('notifications').update({push_sent_at:new Date().toISOString()}).in('id',justInserted.map((n:any)=>n.id));
  }
}

// A long/multi-product shift can genuinely pass 1000 parameter_entries
// (many parameters x many hourly slots x several active products) — a bare
// select() silently caps at 1000 (see lib/supabase/fetchAll.ts), which was
// hiding already-submitted entries past that point from the entry screen.
// The operator would then re-enter one of those "missing" readings, and the
// immutability guard in POST below (which reads the real, untruncated
// table) correctly rejected it as already-locked — surfacing as "unable to
// save" even though nothing was actually broken about saving itself.
export async function GET(req:NextRequest){try{const scope=req.nextUrl.searchParams.get('scope')==='quality'?'quality':'solvent',az=await authFor(scope);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Input access not assigned'},{status:az.status});const shift=req.nextUrl.searchParams.get('shiftSessionId');if(!shift)return NextResponse.json({entries:[]});const db=supabaseAdmin();const {data,error}=await fetchAllRows<any>((f,t)=>db.from('parameter_entries').select('*').eq('shift_session_id',shift).range(f,t));if(error)throw error;return NextResponse.json({entries:data||[]})}catch(e){logServerError('entries.GET',e);return NextResponse.json({error:errorMessage(e,'Unable to load entries')},{status:500})}}

export async function POST(req:NextRequest){
  try{
    const b=await req.json(),scope=b.scope==='quality'?'quality':'solvent',az=await authFor(scope);
    if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Input access not assigned'},{status:az.status});
    const user=az.user!,db=supabaseAdmin(),productCode=String(b.productCode||'PLANT');
    // These IDs are retired from new entry flow. Historical rows remain valid
    // and readable through the archive-backed report metadata resolver.
    if([302,303].includes(Number(b.parameterId))){
      return NextResponse.json({error:'This parameter has been retired and cannot receive new readings.',code:'PARAMETER_RETIRED'},{status:409});
    }
    const [{data:param,error:pe},{data:session,error:se}]=await Promise.all([
      db.from('parameter_master').select('*,parameter_sections(id,name,module)').eq('id',b.parameterId).single(),
      db.from('shift_sessions').select('id,scope,active_products,status,operator_id').eq('id',b.shiftSessionId).single(),
    ]);
    if(pe)throw new Error(errorMessage(pe,'Unable to load the parameter for this entry.'));
    if(se)throw new Error(errorMessage(se,'Unable to load the shift session for this entry.'));
    const activeProducts=Array.isArray(session.active_products)?session.active_products.map(String):[];
    if(scope==='quality'&&productCode==='PLANT')return NextResponse.json({error:'Select a Quality product before saving.'},{status:400});
    if(productCode!=='PLANT'&&!activeProducts.includes(productCode))return NextResponse.json({error:'This product is not active in the current shift.'},{status:400});
    const allowed=scope==='quality'?param.parameter_sections?.module==='quality':['solvent','boiler'].includes(String(param.parameter_sections?.module));
    if(!allowed)return NextResponse.json({error:'Parameter does not belong to this input workspace.'},{status:400});
    if(scope==='quality'&&param.product_code&&String(param.product_code)!==productCode)return NextResponse.json({error:'The selected Quality parameter belongs to a different product template.'},{status:400});
    // Final V5 control: an operator cannot record a data-entry result against
    // a parameter that has no visible, approved target. This prevents a
    // target-less reading from ever being labelled Normal/Warning/Critical.
    // The source row stays visible so Admin can configure the missing target.
    if(scope==='quality'&&!String(param.target_text||'').trim())return NextResponse.json({error:`Target configuration is required for ${param.name} before data entry can be submitted. Configure the target in Admin → Parameters & Targets.`,code:'TARGET_REQUIRED'},{status:422});
    // Prevent new readings for sections marked as Not Operating.
    // Validate shift scope.
if(session.scope!==scope){return NextResponse.json({error:'Shift belongs to a different workspace.'},{status:400});}

// Validate shift status.
if(session.status!=='active'){return NextResponse.json({error:'This shift has ended. Start an active shift to enter readings.'},{status:409});}

// Validate operator ownership.
if(session.operator_id!==user.id&&!az.roles.some((r:string)=>['super_admin','admin','solvent_head','quality_head'].includes(r))){return NextResponse.json({error:'You can only enter readings for your own shift.'},{status:403});}

// Prevent readings for sections marked as Not Operating.
const sectionId=param.parameter_sections?.id;if(!sectionId){return NextResponse.json({error:'Unable to identify the parameter section.'},{status:400});}const{data:activeSectionStatus,error:sectionStatusError}=await db.from('section_operating_status').select('id').eq('shift_session_id',b.shiftSessionId).eq('section_id',sectionId).eq('scope',scope).eq('product_code',productCode).eq('status','not_operating').maybeSingle();if(sectionStatusError){throw new Error('Unable to verify section operating status.')}if(activeSectionStatus){return NextResponse.json({error:'This section is marked as Not Operating. New readings cannot be submitted.',code:'SECTION_NOT_OPERATING'},{status:409});}
    if(!b.isNA&&(b.value===null||b.value===undefined||String(b.value).trim()===''||(param.input_type==='number'&&!Number.isFinite(Number(b.value)))))return NextResponse.json({error:'Enter a valid reading.'},{status:400});
    const isNA=Boolean(b.isNA);
    if(isNA&&!String(b.naReason||'').trim())return NextResponse.json({error:'NA reason is required.'},{status:400});
    if(isNA&&String(b.naReason||'')==='Other'&&!String(b.naNote||'').trim())return NextResponse.json({error:'A note is required when NA reason is Other.'},{status:400});
    const v=isNA?{validationStatus:'na',severity:null}:validation(param,b.value),due=b.dueAt?new Date(b.dueAt):null,now=new Date();
    const delay=due?Math.max(0,Math.round((now.getTime()-due.getTime())/60000)):0,timeliness=delay>Number(b.graceMinutes??10)?'late':'on_time';
    const payload:any={
      shift_session_id:b.shiftSessionId,parameter_id:b.parameterId,product_code:productCode,
      slot_start:b.slotStart||null,slot_end:b.slotEnd||null,due_at:b.dueAt||null,
      value_numeric:!isNA&&param.input_type==='number'&&b.value!==''?Number(b.value):null,
      value_text:isNA?'NA':param.input_type==='number'?null:String(b.value??''),
      expected_target:param.target_text,status:dbStatus(v.validationStatus),
      timeliness_status:timeliness,validation_status:v.validationStatus,delay_minutes:delay,
      comments:b.comments||null,result_state:isNA?'na':'result',na_reason:isNA?String(b.naReason):null,na_note:isNA?String(b.naNote||'')||null:null,entered_by:user.id,locked:true,
      client_timestamp:b.clientTimestamp||new Date().toISOString(),sync_timestamp:new Date().toISOString(),
    };

    // ---------------------------------------------------------------
    // Section C / AH: server-side entry immutability. This is an INSERT
    // that does nothing on conflict (ON CONFLICT DO NOTHING via the same
    // unique key the app already relied on) — it can never silently
    // overwrite a previously-submitted reading the way the old upsert did.
    // A resubmit of an already-submitted slot returns 409 ENTRY_LOCKED.
    // ---------------------------------------------------------------
    const ins=await db.from('parameter_entries').upsert(payload,{onConflict:'shift_session_id,parameter_id,slot_start,product_code',ignoreDuplicates:true}).select('*');
    if(ins.error)throw new Error(errorMessage(ins.error,'Unable to save entry'));
    let entry=ins.data&&ins.data[0];
    if(!entry){
      const existing=await db.from('parameter_entries').select('*').eq('shift_session_id',b.shiftSessionId).eq('parameter_id',b.parameterId).eq('slot_start',b.slotStart||null).eq('product_code',productCode).maybeSingle();
      return NextResponse.json({error:'This reading was already submitted and is locked. Use the amendment workflow for a genuine correction.',code:'ENTRY_LOCKED',entry:existing.data||null},{status:409});
    }

    let deviation:{id:string}|null=null;const warnings:string[]=[];
    try {
    const roles=notifyRolesFor(scope),locationLabel=`${productCode==='PLANT'?'Plant-wide':productName(productCode)} • ${param.parameter_sections?.name||scope}`;

    if(v.validationStatus==='unconfigured'){
      // Section G: still saved, still allowed, but flagged distinctly and
      // notified immediately — never silently defaulted to Normal.
      await notifyRecipients(db,roles,user.id,[{
        eventType:`${scope}_target_missing`,title:`TARGET NOT CONFIGURED • ${param.name}`,
        body:`${locationLabel} • Actual ${b.value} • No visible target is configured for this parameter. Deviation detection is disabled until a target is configured in Admin → Parameters & Targets.`,
        severity:'warning',entityType:'parameter_entry',entityId:entry.id,dedupeSuffix:`target_missing:${entry.id}`,
      }]);
    }else if(v.severity){
      // Section B (sql/018_v8_6_1_reliability_and_repair.sql): the database
      // trigger svma_saved_reading_alert already created the deviation +
      // (gated) ticket + (gated) notifications in the SAME transaction as
      // the insert above — atomically, so a bug in that follow-up work can
      // never roll back the reading itself, and honours the parameter's own
      // alert_enabled / ticket_severity_threshold exactly once. This block
      // only reads back what the trigger produced, for the immediate UI
      // response; it must never re-create it, or the two independent
      // "ticket worthy" decisions could disagree.
      const existingDev=await db.from('deviations').select('id').eq('entry_id',entry.id).maybeSingle();
      deviation=existingDev.data||null;
    }

    }catch{warnings.push('The reading is saved, but an alert could not be delivered. Please contact your supervisor.')}
    // Section T/U/V/W/X/Y: link this result to its Quality sample task (if
    // one exists) so SLA tracking closes out instead of firing a stale
    // overdue alert for a reading that has, in fact, just been submitted.
    // Best-effort — never blocks or fails the save itself.
    if(scope==='quality'){
      try{
        const task=await db.from('quality_sample_tasks').select('id,sample_received_at').eq('shift_session_id',b.shiftSessionId).eq('parameter_id',b.parameterId).eq('product_code',productCode).is('result_submitted_at',null).order('sample_due_at',{ascending:true}).limit(1).maybeSingle();
        if(task.data)await db.from('quality_sample_tasks').update({sample_received_at:task.data.sample_received_at||now.toISOString(),result_submitted_at:now.toISOString(),entry_id:entry.id,status:'result_submitted'}).eq('id',task.data.id);
      }catch{/* SLA linkage is best-effort and must never block a save */}
    }

    return NextResponse.json({entry,deviation,validation:v.validationStatus,timeliness,warnings});
  }catch(e){logServerError('entries.POST',e);return NextResponse.json({error:errorMessage(e,'Unable to save entry')},{status:500})}
}
