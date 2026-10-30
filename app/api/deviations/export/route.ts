import {moduleAuthorization,SOLVENT_MANAGEMENT_ROLES,QUALITY_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {productName} from '@/lib/products';
import * as XLSX from 'xlsx';
import {errorMessage,logServerError} from '@/lib/errors';

// Same query/authorization shape as GET /api/deviations — this route only
// adds the .xlsx rendering, so the two can never quietly drift apart on
// who's allowed to see what.
export async function GET(req:NextRequest){
 try{
  const scope=req.nextUrl.searchParams.get('scope')==='quality'?'quality':'solvent';
  const az=scope==='quality'?await moduleAuthorization('quality_management',QUALITY_MANAGEMENT_ROLES):await moduleAuthorization('solvent_management',SOLVENT_MANAGEMENT_ROLES);
  if(!az.ok)return NextResponse.json({error:az.status===401?'Not authenticated':'Management access not assigned'},{status:az.status});
  const db=supabaseAdmin();
  const from=req.nextUrl.searchParams.get('from'),to=req.nextUrl.searchParams.get('to');
  let q=db.from('deviations').select('*,parameter_master(name,unit,source_serial,source_group,parameter_sections(name,module)),shift_sessions(operational_date,scope,shift_master(name)),parameter_entries(product_code,slot_start,entered_by,profiles!parameter_entries_entered_by_fkey(full_name,email))').order('created_at',{ascending:false}).limit(2000);
  if(from)q=q.gte('created_at',`${from}T00:00:00`);
  if(to)q=q.lte('created_at',`${to}T23:59:59`);
  const {data,error}=await q;
  if(error)throw error;
  const modules=scope==='quality'?['quality']:['solvent','boiler'];
  const rows=(data||[]).filter((x:any)=>modules.includes(String(x.parameter_master?.parameter_sections?.module)));

  const headers=['S.No','Date/Time','Shift','Section','Product','Parameter','Unit','Target','Entered (Actual)','Deviation (Variance)','Severity','Status','Operator'];
  const out:any[][]=[headers];
  rows.forEach((r:any,i:number)=>{
   const pc=r.parameter_entries?.product_code;
   out.push([
    i+1,
    new Date(r.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
    r.shift_sessions?.shift_master?.name||'—',
    r.parameter_master?.parameter_sections?.name||'—',
    pc&&pc!=='PLANT'?productName(pc):'Plant-wide',
    r.parameter_master?.name||'—',
    r.parameter_master?.unit||'',
    r.target_text||'',
    r.actual_text||'',
    r.variance??'',
    String(r.severity||'').toUpperCase(),
    String(r.status||'').replaceAll('_',' '),
    r.parameter_entries?.profiles?.full_name||r.parameter_entries?.profiles?.email||'—',
   ]);
  });

  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(out);
  ws['!freeze']={xSplit:0,ySplit:1};
  ws['!cols']=[{wch:6},{wch:20},{wch:10},{wch:20},{wch:16},{wch:32},{wch:10},{wch:18},{wch:18},{wch:16},{wch:10},{wch:14},{wch:22}];
  XLSX.utils.book_append_sheet(wb,ws,scope==='quality'?'Quality Deviations':'Solvent Deviations');

  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const rangeSuffix=from||to?`_${from||'start'}_to_${to||'now'}`:`_${new Date().toISOString().slice(0,10)}`;
  const name=`SVMA_${scope==='quality'?'Quality':'Solvent'}_Deviations${rangeSuffix}.xlsx`;
  return new NextResponse(new Uint8Array(buf),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`}});
 }catch(e){logServerError('deviations/export',e);return NextResponse.json({error:errorMessage(e,'Unable to export deviations')},{status:500})}
}
