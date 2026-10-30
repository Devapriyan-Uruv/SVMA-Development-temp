import {moduleAuthorization,INPUT_ROLES,QUALITY_INPUT_ROLES} from '@/lib/authorize';
import {canOperate} from '@/lib/shiftEligibility';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {isProductCode,type ProductCode} from '@/lib/products';
import {parseSampleFrequency,generateSlotStarts} from '@/lib/slaParser';
import {errorMessage,logServerError} from '@/lib/errors';
import {istToUtc,istTodayDate} from '@/lib/time';
import {sendPushToUser} from '@/lib/push';

// Sections T, U, V: opening a Quality shift session generates the expected
// sample-task schedule for every applicable parameter × active product,
// from the workbook's own sampling-frequency text — never outside the
// shift window. Best-effort: a failure here must never block shift start.
async function generateQualitySampleTasks(db:ReturnType<typeof supabaseAdmin>,sessionId:string,activeProducts:string[],start:Date,end:Date){
  try{
    const {data:params}=await db.from('parameter_master').select('id,product_code,sample_frequency,frequency,parameter_sections!inner(module)').eq('active',true).eq('parameter_sections.module','quality');
    const rows:any[]=[];
    for(const p of params||[]){
      const pc=String((p as any).product_code||'');
      if(pc&&!activeProducts.includes(pc))continue;
      const freq=parseSampleFrequency((p as any).sample_frequency);
      const slots=generateSlotStarts(freq,start,end);
      slots.forEach((slot,idx)=>rows.push({shift_session_id:sessionId,parameter_id:(p as any).id,product_code:pc||'PLANT',slot_index:idx,sample_due_at:slot.toISOString(),status:'pending'}));
    }
    if(rows.length)await db.from('quality_sample_tasks').upsert(rows,{onConflict:'shift_session_id,parameter_id,product_code,slot_index',ignoreDuplicates:true});
  }catch{/* SLA scheduling is best-effort and must never block shift start */}
}
function scopeOf(v:any){return v==='quality'?'quality':'solvent'}
function authFor(scope:string){return scope==='quality'?moduleAuthorization('quality_input',QUALITY_INPUT_ROLES):moduleAuthorization('input',INPUT_ROLES)}
function lockFor(scope:string,roles:string[]){const op=scope==='quality'?roles.includes('quality_operator'):roles.some(r=>['solvent_operator','safety_user'].includes(r));const privileged=roles.some(r=>['super_admin','admin','ceo','management','solvent_head','quality_head'].includes(r));return op&&!privileged}
function products(v:any):ProductCode[]{return Array.from(new Set((Array.isArray(v)?v:[]).map(String).filter(isProductCode)))}
export async function GET(req:NextRequest){try{const scope=scopeOf(req.nextUrl.searchParams.get('scope')),az=await authFor(scope);if(!az.ok)return NextResponse.json({session:null,sessions:[],roles:[],lockApplies:false},{status:az.status});const user=az.user!,db=supabaseAdmin();
 const requestedId=req.nextUrl.searchParams.get('shiftSessionId');
 const {data:rows,error}=await db.from('shift_sessions').select('*,shift_master(*)').eq('operator_id',user.id).eq('scope',scope).in('status',['active','paused']).order('actual_start',{ascending:false});
 if(error)throw error;
 // An operator can legitimately hold more than one concurrent session now
 // (a shift handed to them, still open, plus one they started fresh for
 // the current slot) — every session carries its own hand-off trail so the
 // UI can label each one "started by you" vs "handed to you by X", instead
 // of collapsing to a single ambiguous "session".
 const ids=(rows||[]).map((r:any)=>r.id);
 const {data:handoffRows}=ids.length?await db.from('shift_session_handoffs').select('shift_session_id,from_operator_id,to_operator_id,handed_off_at,from:profiles!shift_session_handoffs_from_operator_id_fkey(full_name,email),to:profiles!shift_session_handoffs_to_operator_id_fkey(full_name,email)').in('shift_session_id',ids).order('handed_off_at',{ascending:false}):{data:[] as any[]};
 const latestHandoffBySession=new Map<string,any>();
 for(const h of handoffRows||[])if(!latestHandoffBySession.has(h.shift_session_id))latestHandoffBySession.set(h.shift_session_id,h);
 const sessions=(rows||[]).map((r:any)=>{
  const h=latestHandoffBySession.get(r.id);
  const handoff=h?{fromName:h.from?.full_name||h.from?.email||'Unknown',toName:h.to?.full_name||h.to?.email||'Unknown',handedOffAt:h.handed_off_at}:null;
  return {...r,handoff,receivedViaHandoff:!!h&&h.to_operator_id===user.id};
 });
 const primary=(requestedId?sessions.find((s:any)=>s.id===requestedId):sessions[0])||null;
 return NextResponse.json({session:primary,sessions,roles:az.roles,lockApplies:!!primary&&lockFor(scope,az.roles),scope,lastHandoff:primary?.handoff||null})}catch(e){logServerError('shift/session',e);return NextResponse.json({error:errorMessage(e,'Unable to load shift')},{status:500})}}
export async function POST(req:NextRequest){try{const b=await req.json(),scope=scopeOf(b.scope),az=await authFor(scope);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Input access not assigned'},{status:az.status});const user=az.user!,db=supabaseAdmin(),activeProducts=products(b.activeProducts);if(!activeProducts.length)return NextResponse.json({error:'Select at least one product running in this shift.'},{status:400});
 // The person entering data is always whoever is actually logged in —
 // never a free-text name the caller can type independently of their own
 // identity. That field used to let a login and the name shown on the
 // dashboard drift apart (one operator started a shift under their own
 // account but typed a colleague's name into it, so the live dashboard
 // showed the wrong person as holding it, and only the real login could
 // actually manage it). entry_person_name is now derived server-side from
 // the caller's own profile, so it can never be anyone but them.
 const {data:profile}=await db.from('profiles').select('full_name,email').eq('id',user.id).maybeSingle();
 const entryPersonName=profile?.full_name||profile?.email||user.email||'Operator';
 // An operator may already hold a DIFFERENT shift (typically one just
 // handed to them) without that blocking them from starting this one —
 // real shift changeovers don't land exactly on the scheduled boundary, so
 // someone can legitimately be holding the outgoing shift (still needs
 // closing) while also being the one who starts the incoming one. Starting
 // the SAME shift slot twice is still blocked, both here (their own prior
 // session) and by the slot-wide check below (anyone else's).
 const existing=await db.from('shift_sessions').select('*,shift_master(*)').eq('operator_id',user.id).eq('scope',scope).eq('shift_id',b.shiftId).in('status',['active','paused']).limit(1).maybeSingle();if(existing.data)return NextResponse.json({session:existing.data,alreadyActive:true});
 const opDateForConflict=b.operationalDate||istTodayDate();
 // The real recurring failure wasn't the entry-preservation mechanics of
 // Hand off (those always worked) — it was that NOTHING stopped a second
 // person from starting a brand-new, disconnected session for a shift slot
 // someone else was already running, most often right after handing that
 // exact slot off to someone else (the sender's own page resets to "Start
 // Shift", and a reflexive click creates a duplicate instead of leaving
 // the handed-off session alone). The `existing` check above only ever
 // caught "you already have one of your own" — it said nothing about
 // whether this shift+date+scope was already someone else's. This closes
 // that gap outright rather than just nudging the UI harder.
 const slotConflict=await db.from('shift_sessions').select('id,entry_person_name').eq('scope',scope).eq('shift_id',b.shiftId).eq('operational_date',opDateForConflict).in('status',['active','paused']).maybeSingle();
 if(slotConflict.data)return NextResponse.json({error:`This shift is already running — started by ${slotConflict.data.entry_person_name||'another operator'}. Ask them to hand it off to you (Hand off Shift) instead of starting a new one.`,code:'SHIFT_ALREADY_RUNNING'},{status:409});
 const {data:shift,error:se}=await db.from('shift_master').select('*').eq('id',b.shiftId).single();if(se)throw se;const opDate=opDateForConflict,[y,m,d]=opDate.split('-').map(Number),[sh,sm]=String(shift.start_time).split(':').map(Number),[eh,em]=String(shift.end_time).split(':').map(Number);let start=istToUtc(y,m,d,sh,sm),end=istToUtc(y,m,d+(shift.crosses_midnight?1:0),eh,em);
 // The fixed clock grid (06:00-14:00, 14:00-22:00, 22:00-06:00) never
 // moves — `end` is left exactly as computed above, always. The only
 // thing carryover ever adjusts is `start`: if the previous shift (any
 // operator, this scope) was extended past this shift's nominal start,
 // this shift's start slides later by exactly that many whole hours, so
 // it's THIS shift that gets shortened to absorb the delay rather than
 // the whole day drifting forward. e.g. a 4h extend() on the 14:00-22:00
 // shift pushes its close to 02:00 — the 22:00-06:00 shift then starts at
 // 02:00 but still ends at 06:00 (4h, not a full 8h), and every shift
 // after that is back on the untouched 6/2/10 grid.
 // Delta is rounded to the nearest whole hour and only trusted when the
 // previous scheduled_end is genuinely close to that clean mark — this
 // also self-heals older rows where scheduled_end itself had inherited an
 // odd-minute actual_end (a since-fixed bug), instead of propagating that
 // drift forward. Guards: only a positive delta within 12h, and never a
 // delta that would collapse this shift to zero/negative length.
 try{
  // A shift that finished clearly EARLY (more than 30 min before its scheduled end) ended when it actually ended: one that was
  // extended and then closed within minutes (a test, or a mis-click) must not push the next shift's start out to the extended time.
  const {data:prevRows}=await db.from('shift_sessions').select('scheduled_end,actual_end').eq('scope',scope).eq('status','completed').not('scheduled_end','is',null).order('scheduled_end',{ascending:false}).limit(12);
  const effectiveEnd=(r:any)=>{const sched=new Date(r.scheduled_end).getTime(),act=r.actual_end?new Date(r.actual_end).getTime():NaN;return Number.isFinite(act)&&act<sched-30*60000?act:sched};
  const prev=(prevRows||[]).reduce((best:any,r:any)=>!best||effectiveEnd(r)>effectiveEnd(best)?r:best,null);
  if(prev?.scheduled_end){
   const prevEnd=new Date(effectiveEnd(prev));
   const rawDeltaMs=prevEnd.getTime()-start.getTime();
   const deltaHours=Math.round(rawDeltaMs/3600000);
   if(deltaHours>0&&deltaHours<=12){
    const snappedStart=new Date(start.getTime()+deltaHours*3600000);
    if(Math.abs(prevEnd.getTime()-snappedStart.getTime())<=5*60000&&snappedStart.getTime()<end.getTime()){start=snappedStart}
   }
  }
 }catch{/* carryover is a best-effort convenience — the nominal schedule still works if this fails */}
 const {data,error}=await db.from('shift_sessions').insert({operational_date:opDate,shift_id:shift.id,operator_id:user.id,scheduled_start:start.toISOString(),scheduled_end:end.toISOString(),actual_start:new Date().toISOString(),status:'active',device_info:b.deviceInfo||{},scope,active_products:activeProducts,entry_person_name:entryPersonName,entry_person_photo_url:b.entryPersonPhotoUrl||null}).select('*,shift_master(*)').single();if(error)throw error;if(scope==='quality')await generateQualitySampleTasks(db,data.id,activeProducts,start,end);return NextResponse.json({session:data})}catch(e){logServerError('shift/session',e);return NextResponse.json({error:errorMessage(e,'Unable to start shift')},{status:500})}}
export async function PATCH(req:NextRequest){try{const b=await req.json(),scope=scopeOf(b.scope),az=await authFor(scope);if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Input access not assigned'},{status:az.status});const user=az.user!,db=supabaseAdmin();
 // Extending is the Head/Super Admin's call, not the operator's own — so,
 // unlike every other action here, it is NOT restricted to a session the
 // calling user themselves owns (operator_id=user.id). It's still gated
 // to the same authorised-override role check the early-close override
 // already uses, just looked up against whichever active session the
 // caller names, since that caller is typically a different person from
 // the operator running the shift.
 if(b.action==='extend'){
  const canOverride=az.roles.includes('super_admin')||(scope==='quality'?az.roles.includes('quality_head'):az.roles.includes('solvent_head'));
  if(!canOverride)return NextResponse.json({error:`Extending a shift requires Super Admin or ${scope==='quality'?'Quality':'Solvent'} Head.`},{status:403});
  const extendHours=Number(b.extendHours);
  if(!Number.isFinite(extendHours)||extendHours<=0||extendHours>12)return NextResponse.json({error:'Enter a valid number of hours to extend (1-12).'},{status:400});
  const {data:target,error:tse}=await db.from('shift_sessions').select('*,shift_master(*)').eq('id',b.shiftSessionId).eq('scope',scope).eq('status','active').single();if(tse)throw tse;
  const newEnd=new Date(new Date(target.scheduled_end).getTime()+extendHours*3600000);
  const {data,error}=await db.from('shift_sessions').update({scheduled_end:newEnd.toISOString()}).eq('id',target.id).select('*,shift_master(*)').single();if(error)throw error;
  await db.from('audit_logs').insert({user_id:user.id,module:scope==='quality'?'quality_input':'input',action:'SHIFT_EXTEND',entity_type:'shift_session',entity_id:target.id,metadata:{extendHours,previousScheduledEnd:target.scheduled_end,newScheduledEnd:newEnd.toISOString()}});
  if(scope==='quality')await generateQualitySampleTasks(db,target.id,products(target.active_products),new Date(target.scheduled_start),newEnd);
  try{
   const title='Shift extended',endLabel=newEnd.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}),body=`Your ${scope==='quality'?'Quality':'Solvent'} shift was extended by ${extendHours}h — now runs until ${endLabel}.`;
   await db.from('notifications').insert({user_id:target.operator_id,event_type:'shift_extended',title,body,severity:'info',entity_type:'shift_session',entity_id:target.id});
   await sendPushToUser(db,target.operator_id,{title,body,severity:'info',tag:'shift_extended',url:scope==='quality'?'/quality-input':'/input'});
  }catch{/* the extension itself already succeeded either way */}
  return NextResponse.json({session:data});
 }
 // Hand off is looked up like extend — the caller may be a Head/Super
 // Admin acting on someone else's session (the exact case that matters
 // most: the original operator already logged out and can't hand off
 // themselves) — so it can't be restricted to eq('operator_id',user.id)
 // the way every other action below is.
 if(b.action==='handoff'){
  const canOverride=az.roles.includes('super_admin')||(scope==='quality'?az.roles.includes('quality_head'):az.roles.includes('solvent_head'));
  const own=await db.from('shift_sessions').select('*,shift_master(*)').eq('id',b.shiftSessionId).eq('operator_id',user.id).eq('scope',scope).in('status',['active','paused']).maybeSingle();
  let target=own.data;
  // Reopen is override-only and opt-in (b.reopen), never reachable through
  // an operator's own session above: it exists for exactly one situation —
  // the real, filled-in session for a shift was already closed (correctly
  // or not) and now needs to be handed to someone else anyway, e.g. a
  // reflexive re-click right after closing started a second, empty session
  // for the same slot and *that* one got handed off instead of the real
  // one. Reopening never rewrites the entries already saved on it or who
  // recorded them — it only flips status back to active and clears
  // actual_end so the SAME session (same entries, same history) can keep
  // being worked on, by whoever it's handed to below.
  if(!target&&b.reopen&&canOverride){
   const reopenable=await db.from('shift_sessions').select('*,shift_master(*)').eq('id',b.shiftSessionId).eq('scope',scope).eq('status','completed').maybeSingle();if(reopenable.error)throw reopenable.error;target=reopenable.data;
  }
  if(!target){
   if(!canOverride)return NextResponse.json({error:`Hand-off requires Super Admin or ${scope==='quality'?'Quality':'Solvent'} Head to act on someone else's shift.`},{status:403});
   const other=await db.from('shift_sessions').select('*,shift_master(*)').eq('id',b.shiftSessionId).eq('scope',scope).in('status',['active','paused']).maybeSingle();if(other.error)throw other.error;target=other.data;
  }
  if(!target)return NextResponse.json({error:'No open shift found to hand off.'},{status:404});
  const wasCompleted=target.status==='completed';
  if(wasCompleted&&!b.reopen)return NextResponse.json({error:'This shift is already closed. Pass reopen to hand off a closed shift.'},{status:409});
  const toOperatorId=String(b.toOperatorId||'');if(!toOperatorId)return NextResponse.json({error:'Choose who to hand the shift off to.'},{status:400});
  if(!(await canOperate(db,toOperatorId,scope)))return NextResponse.json({error:'That person does not have entry access for this scope.'},{status:400});
  const fromOperatorId=target.operator_id;
  // entry_person_name/photo record who ACTUALLY STARTED the shift — that
  // is a historical fact and a hand-off must never overwrite it, however
  // long the shift keeps running or however many times it's handed off
  // again after this. (A previous version of this code updated these
  // fields to the new operator, which was wrong — it made a shift started
  // by one person permanently read as "started by" whoever most recently
  // received it.) Who currently holds it (operator_id) changes below as
  // normal; who's held it over time is the separate, append-only trail in
  // shift_session_handoffs (see lastHandoff in GET above and the
  // dashboard chips) — the two facts are shown side by side, never merged
  // into one.
  const [{data:fromP},{data:toP}]=await Promise.all([db.from('profiles').select('full_name,email').eq('id',fromOperatorId).maybeSingle(),db.from('profiles').select('full_name,email').eq('id',toOperatorId).maybeSingle()]);
  const updatePayload:any={operator_id:toOperatorId};
  if(wasCompleted){updatePayload.status='active';updatePayload.actual_end=null}
  const {data,error}=await db.from('shift_sessions').update(updatePayload).eq('id',target.id).select('*,shift_master(*)').single();if(error)throw error;
  await db.from('shift_session_handoffs').insert({shift_session_id:target.id,from_operator_id:fromOperatorId,to_operator_id:toOperatorId,reason:b.reason||null});
  await db.from('audit_logs').insert({user_id:user.id,module:scope==='quality'?'quality_input':'input',action:wasCompleted?'SHIFT_REOPEN_HANDOFF':'SHIFT_HANDOFF',entity_type:'shift_session',entity_id:target.id,metadata:{fromOperatorId,toOperatorId,reason:b.reason||null,reopened:wasCompleted}});
  // The exact class of bug this reopen path exists to clean up after: a
  // second, empty session for the SAME shift slot (scope+shift_id+date)
  // that only exists because of a reflexive re-click around the original
  // close. It's safe to force-close automatically ONLY when it truly has
  // zero entries — anything with real data is left alone and surfaced
  // instead of silently touched.
  let closedDuplicates:string[]=[];
  if(wasCompleted){
   try{
    const dupes=await db.from('shift_sessions').select('id,entry_person_name').eq('scope',scope).eq('shift_id',target.shift_id).eq('operational_date',target.operational_date).neq('id',target.id).in('status',['active','paused']);
    for(const dup of dupes.data||[]){
     const {count}=await db.from('parameter_entries').select('id',{count:'exact',head:true}).eq('shift_session_id',dup.id);
     if(!count){
      await db.from('shift_sessions').update({status:'completed',actual_end:new Date().toISOString()}).eq('id',dup.id);
      await db.from('audit_logs').insert({user_id:user.id,module:scope==='quality'?'quality_input':'input',action:'SHIFT_AUTO_CLOSE_EMPTY_DUPLICATE',entity_type:'shift_session',entity_id:dup.id,metadata:{reason:`Closed automatically: empty duplicate of reopened shift ${target.id}`}});
      closedDuplicates.push(dup.id);
     }
    }
   }catch{/* duplicate cleanup is best-effort — the reopen+handoff above already succeeded either way */}
  }
  try{
   const fromName=fromP?.full_name||fromP?.email||'A colleague',toName=toP?.full_name||toP?.email||'a colleague',url=scope==='quality'?'/quality-input':'/input';
   const newOpTitle=`${scope==='quality'?'Quality':'Solvent'} shift handed to you`,newOpBody=`${fromName} handed you their ${target.shift_master?.name||'shift'}.${b.reason?` ${b.reason}`:''}`;
   await db.from('notifications').insert({user_id:toOperatorId,event_type:'shift_handoff',title:newOpTitle,body:newOpBody,severity:'info',entity_type:'shift_session',entity_id:target.id,push_sent_at:new Date().toISOString()});
   await sendPushToUser(db,toOperatorId,{title:newOpTitle,body:newOpBody,severity:'info',tag:'shift_handoff',url});
   const headTitle=`${scope==='quality'?'Quality':'Solvent'} shift handed off`,headBody=`${fromName} handed ${target.shift_master?.name||'their shift'} to ${toName}.${b.reason?` ${b.reason}`:''}`;
   const {data:recipients}=await db.from('user_roles').select('user_id').in('role',['super_admin','management',scope==='quality'?'quality_head':'solvent_head']);
   const recipientIds=Array.from(new Set((recipients||[]).map((r:any)=>r.user_id).filter((id:string)=>id&&id!==user.id&&id!==toOperatorId)));
   if(recipientIds.length){
    await db.from('notifications').insert(recipientIds.map(uid=>({user_id:uid,event_type:'shift_handoff',title:headTitle,body:headBody,severity:'info',entity_type:'shift_session',entity_id:target.id,push_sent_at:new Date().toISOString()})));
    await Promise.all(recipientIds.map(uid=>sendPushToUser(db,uid,{title:headTitle,body:headBody,severity:'info',tag:'shift_handoff',url:scope==='quality'?'/quality':'/solvent'}).catch(()=>{})));
   }
  }catch{/* the hand-off itself already succeeded either way */}
  return NextResponse.json({session:data,reopened:wasCompleted,closedDuplicates});
 }
 // Two distinct permissions were tangled together here before: (1) acting
 // on a shift that ISN'T yours at all (pause/resume/products always stay
 // operator-only; only close can bypass this, and deliberately Super Admin
 // only — not this scope's Head), and (2) force-closing your OWN shift
 // early/incomplete, which was already Super-Admin-or-Head before any of
 // this and stays that way. 'extend' and 'handoff' each have their own
 // separate, already-existing Head permission below and are untouched.
 const canActOnOthers=az.roles.includes('super_admin');
 const canForceEarly=az.roles.includes('super_admin')||(scope==='quality'?az.roles.includes('quality_head'):az.roles.includes('solvent_head'));
 const {data:session,error:se}=await db.from('shift_sessions').select('*,shift_master(*)').eq('id',b.shiftSessionId).eq('scope',scope).single();if(se)throw se;
 if(session.operator_id!==user.id&&!canActOnOthers)return NextResponse.json({error:'You can only manage your own shift.'},{status:403});
 if(['pause','resume','products'].includes(b.action)&&session.operator_id!==user.id)return NextResponse.json({error:'Only the operator running this shift can do that.'},{status:403});
 if(b.action==='pause'){
  if(session.status!=='active')return NextResponse.json({error:'Only an active shift can be paused.'},{status:409});
  const reason=String(b.reason||'').trim();if(!reason)return NextResponse.json({error:'A reason is required to pause entry.'},{status:400});
  const {data,error}=await db.from('shift_sessions').update({status:'paused'}).eq('id',session.id).select('*,shift_master(*)').single();if(error)throw error;
  await db.from('shift_session_pauses').insert({shift_session_id:session.id,reason,paused_by:user.id});
  try{
   const {data:target}=await db.from('profiles').select('full_name,email').eq('id',user.id).maybeSingle();
   const who=target?.full_name||target?.email||'An operator';
   const title=`${scope==='quality'?'Quality':'Solvent'} entry paused`,body=`${who} paused ${session.shift_master?.name||'their shift'}: ${reason}`;
   const {data:recipients}=await db.from('user_roles').select('user_id').in('role',['super_admin','management',scope==='quality'?'quality_head':'solvent_head']);
   const recipientIds=Array.from(new Set((recipients||[]).map((r:any)=>r.user_id).filter((id:string)=>id&&id!==user.id)));
   if(recipientIds.length){
    await db.from('notifications').insert(recipientIds.map(uid=>({user_id:uid,event_type:'shift_paused',title,body,severity:'warning',entity_type:'shift_session',entity_id:session.id,push_sent_at:new Date().toISOString()})));
    await Promise.all(recipientIds.map(uid=>sendPushToUser(db,uid,{title,body,severity:'warning',tag:'shift_paused',url:scope==='quality'?'/quality':'/solvent'}).catch(()=>{})));
   }
  }catch{/* the pause itself already succeeded either way */}
  return NextResponse.json({session:data});
 }
 if(b.action==='resume'){
  if(session.status!=='paused')return NextResponse.json({error:'This shift is not paused.'},{status:409});
  const {data,error}=await db.from('shift_sessions').update({status:'active'}).eq('id',session.id).select('*,shift_master(*)').single();if(error)throw error;
  const {data:openPause}=await db.from('shift_session_pauses').select('id').eq('shift_session_id',session.id).is('resumed_at',null).order('paused_at',{ascending:false}).limit(1).maybeSingle();
  if(openPause)await db.from('shift_session_pauses').update({resumed_at:new Date().toISOString()}).eq('id',openPause.id);
  return NextResponse.json({session:data});
 }
 if(b.action==='products'){const activeProducts=products(b.activeProducts);if(!activeProducts.length)return NextResponse.json({error:'Keep at least one product active.'},{status:400});const {data,error}=await db.from('shift_sessions').update({active_products:activeProducts}).eq('id',session.id).select('*,shift_master(*)').single();if(error)throw error;if(scope==='quality')await generateQualitySampleTasks(db,session.id,activeProducts,new Date(session.scheduled_start),new Date(session.scheduled_end));return NextResponse.json({session:data})}
 // Closing on someone else's behalf is itself an override, force or not —
 // require it explicitly rather than letting a Super Admin silently
 // finalise a colleague's still-open shift with a plain "end" (we already
 // know they're Super Admin if we got this far with a foreign session).
 if(session.operator_id!==user.id&&!b.force)return NextResponse.json({error:'Stopping someone else\'s shift requires an authorised override — pass force.'},{status:400});
 if(b.force&&!canForceEarly)return NextResponse.json({error:`Authorised override is restricted to Super Admin or ${scope==='quality'?'Quality':'Solvent'} Head.`},{status:403});const scheduledEnd=session.scheduled_end?new Date(session.scheduled_end):null;if(!b.force&&scheduledEnd&&Date.now()<scheduledEnd.getTime())return NextResponse.json({error:`Shift remains active until ${scheduledEnd.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}. Data can be submitted throughout the shift. Authorised override is required for early closure.`},{status:409});
 // Target completeness is a hard control, not a deviation override. A shift
 // cannot be finalised while an applicable data-entry parameter has no target,
 // because no valid deviation decision can be made for that row.
 {const activeProducts=products(session.active_products);let tq=db.from('parameter_master').select('id,name,target_text,product_code,shift_applicability,parameter_sections!inner(module)').eq('active',true).eq('mandatory',true);tq=scope==='quality'?tq.eq('parameter_sections.module','quality'):tq.in('parameter_sections.module',['solvent','boiler']);const {data:tparams}=await tq;const shiftId=Number(session.shift_id),targetGaps=(tparams||[]).filter((p:any)=>(!Array.isArray(p.shift_applicability)||!p.shift_applicability.length||p.shift_applicability.includes(shiftId))&&(scope!=='quality'||!p.product_code||(isProductCode(p.product_code)&&activeProducts.includes(p.product_code)))&&!String(p.target_text||'').trim());if(targetGaps.length)return NextResponse.json({error:`${targetGaps.length} active mandatory parameter${targetGaps.length===1?' has':'s have'} no configured target. Configure all targets in Admin → Parameters & Targets before closing the shift.`,code:'TARGET_CONFIGURATION_REQUIRED',parameters:targetGaps.map((p:any)=>({id:p.id,name:p.name}))},{status:409});}
 if(!b.force){const activeProducts=products(session.active_products);let pq=db.from('parameter_master').select('id,frequency,product_code,shift_applicability,parameter_sections!inner(module)').eq('active',true).eq('mandatory',true);pq=scope==='quality'?pq.eq('parameter_sections.module','quality'):pq.in('parameter_sections.module',['solvent','boiler']);const {data:params}=await pq;const shiftId=Number(session.shift_id),applicable=(params||[]).filter((p:any)=>(!Array.isArray(p.shift_applicability)||!p.shift_applicability.length||p.shift_applicability.includes(shiftId))&&(scope!=='quality'||!p.product_code||(isProductCode(p.product_code)&&activeProducts.includes(p.product_code))));
  // Normally 8, but an extended shift's scheduled_end has been pushed
  // further out (see the 'extend' action below), so the real slot count
  // for this specific session can be more.
  const shiftHours=session.scheduled_start&&session.scheduled_end?Math.min(24,Math.max(1,Math.round((new Date(session.scheduled_end).getTime()-new Date(session.scheduled_start).getTime())/3600000))):8;
  // `applicable` is already filtered to mandatory=true (the query above) and
  // to this request's own scope (quality-only vs solvent/boiler-only, set
  // a few lines up). Hourly-family frequencies count every slot. For Solvent/
  // Boiler, every other frequency (once_per_shift/daily/first_shift_only/
  // weekly) now counts as exactly one required entry — previously it counted
  // as 0 regardless of the mandatory flag, so a mandatory once-per-shift
  // reading (e.g. the Factory General Safety / Boiler checklist, sql/052)
  // could be skipped all shift and the shift would still close as 100%
  // complete. Quality's non-hourly mandatory parameters (confirmed live to
  // exist — e.g. product-specific PROCESS LAB REPORT rows — a wrong
  // assumption during planning said this frequency never appears there)
  // deliberately keep the OLD exempt behavior: tightening Quality's gate was
  // never asked for and risks blocking real Quality shifts on a change no
  // one reviewed. There is no per-product multiplier for Solvent/Boiler —
  // those rows are always submitted plant-wide (product_code 'PLANT'),
  // never once per active product.
  function scheduleCountFor(freq:string){if(freq==='hourly'||freq==='every_two_hours'||freq==='every_4_hours')return shiftHours;return scope==='quality'?0:1}
  const expected=applicable.reduce((sum:number,p:any)=>sum+scheduleCountFor(String(p.frequency)),0);
  const {count}=await db.from('parameter_entries').select('id',{count:'exact',head:true}).eq('shift_session_id',session.id);if((count||0)<expected)return NextResponse.json({error:`Shift period is complete, but ${expected-(count||0)} mandatory entries are still missing. Authorised override is required.`},{status:409})}const {data,error}=await db.from('shift_sessions').update({status:'completed',actual_end:new Date().toISOString()}).eq('id',session.id).select('*').single();if(error)throw error;if(b.force)await db.from('audit_logs').insert({user_id:user.id,module:scope==='quality'?'quality_input':'input',action:'SHIFT_OVERRIDE_CLOSE',entity_type:'shift_session',entity_id:session.id,metadata:{reason:b.reason||'Authorised override'}});return NextResponse.json({session:data})}catch(e){logServerError('shift/session',e);return NextResponse.json({error:errorMessage(e,'Unable to update shift')},{status:500})}}
