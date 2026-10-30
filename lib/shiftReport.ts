import {supabaseAdmin} from './supabase/admin';
import {productName} from './products';
import {attachHandoffInfo} from './shiftHandoff';
import {fetchAllRows} from './supabase/fetchAll';

// Shared by the Excel export (app/api/export/shift) and the in-app report
// viewer (app/api/reports/shift-view) — same grouping/row logic either
// way, so the two can never silently drift apart. The Excel export layers
// its own AI-commentary generation on top of this; the viewer intentionally
// skips it (an OpenAI call per parameter isn't something a "just let me
// look at it" click should pay for every time).

export function fmtHour(d:string){return new Date(d).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Kolkata'})}
export function valueOf(e:any){if(!e)return '';if(e.result_state==='na'||e.validation_status==='na'||e.value_text==='NA')return `NA${e.na_reason?` (${e.na_reason}${e.na_note?`: ${e.na_note}`:''})`:''}`;return e.amended_value_numeric??e.amended_value_text??e.value_numeric??e.value_text??''}
export function worstStatus(es:any[]){const rank:Record<string,number>={critical:5,warning:4,target_missing:3,missing:2,na:1,normal:0};return es.reduce((w,e)=>(rank[e.validation_status||'']??0)>(rank[w]??0)?e.validation_status:w,'normal')}

export type ShiftReportRow={
 parameterId:number;sourceSerial:string;section:string;parameter:string;unit:string;target:string;frequency:string;
 hourValues:string[];hourStatuses:(string|null)[];shiftActual:string;status:string;comments:string;
 ticketIds:string[];enteredBy:string;enteredAt:string;
};
export type ShiftReportGroup={key:string;productCode:string;productLabel:string;sectionLabel:string;rows:ShiftReportRow[]};
export type ShiftReportData={
 session:any;scope:'solvent'|'quality';slotLabels:string[];groups:ShiftReportGroup[];deviations:any[];
 summary:{submittedRecords:number;normal:number;warning:number;critical:number;na:number;unconfigured:number;deviationTickets:number};
};

export async function buildShiftReportData(scope:'solvent'|'quality',shiftSessionId:string):Promise<ShiftReportData>{
 const db=supabaseAdmin();
 const {data:rawSession,error:se}=await db.from('shift_sessions').select('*,shift_master(*)').eq('id',shiftSessionId).eq('scope',scope).single();
 if(se)throw se;
 // entry_person_name only ever records who STARTED the shift (see
 // app/api/shift/session/route.ts) — a completed shift's own report/export
 // previously had zero trace of a later hand-off, which is exactly the gap
 // that made "who actually closed this" invisible once the shift was no
 // longer live on a dashboard. Same handoff attachment every live-shift
 // chip already uses (lib/shiftHandoff.ts), now applied here too.
 const session=await attachHandoffInfo(db,rawSession);
 // A long/multi-product shift can genuinely pass 1000 rows on either table
 // (confirmed live) — a bare select() silently caps there with no error
 // (see lib/supabase/fetchAll.ts), which would quietly drop rows from the
 // very export/report meant to be the authoritative record of the shift.
 const [{data:entries,error},{data:deviations,error:de}]=await Promise.all([
  fetchAllRows<any>((f,t)=>db.from('parameter_entries').select('*,profiles!parameter_entries_entered_by_fkey(full_name,email),parameter_master(name,unit,target_text,frequency,sample_frequency,result_latency_minutes,source_serial,source_group,sort_order,parameter_sections(name,module,sort_order))').eq('shift_session_id',shiftSessionId).order('slot_start',{ascending:true}).range(f,t)),
  fetchAllRows<any>((f,t)=>db.from('deviations').select('id,entry_id,parameter_id,severity,target_text,actual_text,status,created_at,deviation_tickets(ticket_no,status)').eq('shift_session_id',shiftSessionId).order('created_at',{ascending:true}).range(f,t)),
 ]);
 if(error)throw error;if(de)throw de;
 const modules=scope==='quality'?['quality']:['solvent','boiler'],rows=(entries||[]).filter((e:any)=>modules.includes(String(e.parameter_master?.parameter_sections?.module))),devs=deviations||[];
 const ticketCount=devs.reduce((n:number,d:any)=>n+(Array.isArray(d.deviation_tickets)?d.deviation_tickets.length:0),0);
 // Normally 8, but an extended shift's scheduled_end is pushed further
 // out (see the Extend Shift action) — the report always covers exactly
 // the real span the operator logged against, not a fixed 8.
 const shiftStart=new Date(session.scheduled_start),shiftEnd=new Date(session.scheduled_end),shiftHours=Math.min(24,Math.max(1,Math.round((shiftEnd.getTime()-shiftStart.getTime())/3600000)));
 const slotStarts=Array.from({length:shiftHours},(_,i)=>new Date(shiftStart.getTime()+i*3600000).toISOString());
 const slotLabels=slotStarts.map(s=>`${fmtHour(s)}-${fmtHour(new Date(new Date(s).getTime()+3600000).toISOString())}`);
 const groupKey=(e:any)=>scope==='quality'?`${e.product_code||'UNSET'}|${e.parameter_master?.source_group||'Quality'}`:`${e.product_code||'PLANT'}|${e.parameter_master?.parameter_sections?.name||'Other'}`;
 const keys=Array.from(new Set(rows.map(groupKey)));
 const groups:ShiftReportGroup[]=keys.map(g=>{
  const [pc,label]=String(g).split('|'),er=rows.filter((e:any)=>groupKey(e)===g),pm=new Map<number,any>();
  er.forEach((e:any)=>pm.set(e.parameter_id,e.parameter_master));
  const pars=Array.from(pm.entries()).sort((a:any,b:any)=>(a[1].sort_order||0)-(b[1].sort_order||0));
  const reportRows:ShiftReportRow[]=pars.map(([pid,p]:any)=>{
   const treatAsHourly=scope==='solvent'||p.frequency!=='once_per_shift';
   const pe=er.filter((e:any)=>e.parameter_id===pid);
   const hourEntries=slotStarts.map(s=>pe.find((e:any)=>e.slot_start&&Math.abs(new Date(e.slot_start).getTime()-new Date(s).getTime())<60000&&treatAsHourly));
   const hourValues=hourEntries.map(valueOf),hourStatuses=hourEntries.map((e:any)=>e?.validation_status||null);
   const shiftEntry=treatAsHourly?undefined:pe.find((e:any)=>p.frequency==='once_per_shift'||!e.slot_start);
   const ds=devs.filter((d:any)=>Number(d.parameter_id)===Number(pid));
   const ticketIds=ds.flatMap((d:any)=>Array.isArray(d.deviation_tickets)?d.deviation_tickets.map((t:any)=>t.ticket_no).filter(Boolean):[]);
   const enteredBy=Array.from(new Set(pe.map((e:any)=>e.profiles?.full_name||e.profiles?.email).filter(Boolean))).join(', ');
   const enteredTimes=pe.map((e:any)=>e.server_timestamp).filter(Boolean).map((t:string)=>new Date(t).getTime());
   const enteredAt=enteredTimes.length?new Date(Math.max(...enteredTimes)).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'';
   return{parameterId:Number(pid),sourceSerial:p.source_serial||'',section:label,parameter:p.name,unit:p.unit||'',target:p.target_text||'Target not configured',frequency:p.sample_frequency||String(p.frequency||'').replaceAll('_',' '),hourValues,hourStatuses,shiftActual:valueOf(shiftEntry),status:worstStatus(pe),comments:pe.map((e:any)=>e.comments).filter(Boolean).join(' | '),ticketIds,enteredBy,enteredAt};
  });
  return{key:String(g),productCode:pc,productLabel:pc==='PLANT'||pc==='UNSET'?(scope==='solvent'?'Plant-wide':'—'):productName(pc),sectionLabel:label,rows:reportRows};
 });
 return{
  session,scope,slotLabels,groups,deviations:devs,
  summary:{
   submittedRecords:rows.length,
   normal:rows.filter((x:any)=>x.validation_status==='normal').length,
   warning:rows.filter((x:any)=>x.validation_status==='warning').length,
   critical:rows.filter((x:any)=>x.validation_status==='critical').length,
   na:rows.filter((x:any)=>x.validation_status==='na').length,
   unconfigured:rows.filter((x:any)=>x.validation_status==='unconfigured').length,
   deviationTickets:ticketCount,
  },
 };
}
