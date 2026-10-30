import {moduleAuthorization,SOLVENT_MANAGEMENT_ROLES,QUALITY_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import * as XLSX from 'xlsx';
import {errorMessage,logServerError} from '@/lib/errors';

function auth(scope:string){return scope==='quality'?moduleAuthorization('quality_management',QUALITY_MANAGEMENT_ROLES):moduleAuthorization('solvent_management',SOLVENT_MANAGEMENT_ROLES)}

// Same query shape as GET /api/tickets, rendered to .xlsx — one row per
// action ticket with the deviation it was raised from alongside it.
export async function GET(req:NextRequest){
 try{
  const scope=req.nextUrl.searchParams.get('scope')==='quality'?'quality':'solvent';
  const az=await auth(scope);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Management access not assigned'},{status:az.status});
  const db=supabaseAdmin(),modules=scope==='quality'?['quality']:['solvent','boiler'];
  const from=req.nextUrl.searchParams.get('from'),to=req.nextUrl.searchParams.get('to');
  // occurrence_count / last_observed_at exist only after sql/062 — retry without them so the download works either way.
  const build=(withRecurrence:boolean)=>{let q=db.from('deviation_tickets').select(`*,deviations!inner(severity,target_text,actual_text,created_at,${withRecurrence?'occurrence_count,last_observed_at,':''}parameter_master!inner(name,source_serial,source_group,parameter_sections!inner(name,module)))`).in('deviations.parameter_master.parameter_sections.module',modules).order('created_at',{ascending:false}).limit(2000);
   if(from)q=q.gte('created_at',`${from}T00:00:00`);
   if(to)q=q.lte('created_at',`${to}T23:59:59`);
   return q};
  let {data,error}=await build(true);
  if(error&&/occurrence_count|last_observed_at/.test(error.message||''))({data,error}=await build(false));
  if(error)throw error;
  const rows=data||[];

  const headers=['S.No','Ticket No.','Raised','Section','Parameter','Target','Actual','Occurrences','Last Seen','Severity','Status','Root Cause','Corrective Action','Closure Comments','Closed At'];
  const out:any[][]=[headers];
  rows.forEach((r:any,i:number)=>{
   out.push([
    i+1,
    r.ticket_no||'—',
    new Date(r.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
    r.deviations?.parameter_master?.parameter_sections?.name||'—',
    r.deviations?.parameter_master?.name||'—',
    r.deviations?.target_text||'',
    r.deviations?.actual_text||'',
    r.deviations?.occurrence_count||1,
    r.deviations?.last_observed_at?new Date(r.deviations.last_observed_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'',
    String(r.deviations?.severity||'').toUpperCase(),
    String(r.status||'').replaceAll('_',' '),
    r.root_cause||'',
    r.corrective_action||'',
    r.closure_comments||'',
    r.closed_at?new Date(r.closed_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'',
   ]);
  });

  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(out);
  ws['!freeze']={xSplit:0,ySplit:1};
  ws['!cols']=[{wch:6},{wch:16},{wch:20},{wch:20},{wch:32},{wch:18},{wch:18},{wch:12},{wch:20},{wch:10},{wch:14},{wch:40},{wch:40},{wch:32},{wch:20}];
  XLSX.utils.book_append_sheet(wb,ws,scope==='quality'?'Quality Tickets':'Solvent Tickets');

  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const rangeSuffix=from||to?`_${from||'start'}_to_${to||'now'}`:`_${new Date().toISOString().slice(0,10)}`;
  const name=`SVMA_${scope==='quality'?'Quality':'Solvent'}_Tickets${rangeSuffix}.xlsx`;
  return new NextResponse(new Uint8Array(buf),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`}});
 }catch(e){logServerError('tickets/export',e);return NextResponse.json({error:errorMessage(e,'Unable to export tickets')},{status:500})}
}
