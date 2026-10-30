import {moduleAuthorization,SOLVENT_MANAGEMENT_ROLES,QUALITY_MANAGEMENT_ROLES} from '@/lib/authorize';
import {NextRequest,NextResponse} from 'next/server';
import ExcelJS from 'exceljs';
import {productName} from '@/lib/products';
import {getOpenAI,OPENAI_MODEL} from '@/lib/openai';
import {buildShiftReportData,type ShiftReportRow} from '@/lib/shiftReport';
import {errorMessage,logServerError} from '@/lib/errors';

// The Excel is built from exactly the same data as the on-screen report
// (lib/shiftReport.ts), so what you viewed is what you download. It is
// complete and fast by default: every row gets a data-based comment written
// from the actual readings. The slower AI commentary is opt-in (?ai=1), is
// asked for only on rows that deviated (one batched request, not one per
// section), and falls back to the data-based text if it can't answer in time.
export const maxDuration=60;

type Dev={parameter_id:number;severity:string;actual_text:string;target_text:string;status:string};
type Insight={aiComment:string;probableCause:string};

const flaggedHours=(r:ShiftReportRow,labels:string[])=>labels.map((label,i)=>({label,value:r.hourValues[i]??'',status:r.hourStatuses[i]??''})).filter(x=>x.status==='warning'||x.status==='critical'||x.status==='target_missing');
const isDeviating=(r:ShiftReportRow,labels:string[])=>flaggedHours(r,labels).length>0||r.status==='warning'||r.status==='critical';

/** Written only from the recorded readings — never blank, never invented. */
function observed(r:ShiftReportRow,labels:string[]):Insight{
  const flagged=flaggedHours(r,labels);
  const filled=r.hourValues.filter(v=>String(v).trim()!==''&&!/^NA\b/i.test(String(v))).length;
  const naCount=r.hourValues.filter(v=>/^NA\b/i.test(String(v))).length;
  if(flagged.length||r.status==='warning'||r.status==='critical'){
    const list=flagged.map(f=>`${f.label} = ${f.value||'—'} (${f.status})`).join('; ');
    const tickets=r.ticketIds.length?` Ticket${r.ticketIds.length>1?'s':''}: ${r.ticketIds.join(', ')}.`:'';
    return {
      aiComment:`${flagged.length||1} reading${(flagged.length||1)===1?'':'s'} outside target (${r.target}): ${list||`shift actual ${r.shiftActual||'—'}`}.${tickets}`,
      probableCause:'Not generated. Check equipment condition, process load, upstream variation, utilities and the operator comments before confirming a cause.',
    };
  }
  if(r.status==='na'&&!filled)return {aiComment:`Recorded as NA for the shift${naCount?` (${naCount} slot${naCount===1?'':'s'})`:''}.`,probableCause:'No deviation detected; no probable-cause hypothesis is required.'};
  const n=filled+(r.shiftActual&&!/^NA\b/i.test(r.shiftActual)?1:0);
  return {aiComment:n?`${n} reading${n===1?'':'s'} recorded, all within target${r.target&&r.target!=='Target not configured'?` (${r.target})`:''}.`:'No reading recorded.',probableCause:'No deviation detected; no probable-cause hypothesis is required.'};
}

/** One batched request for the deviating rows only, bounded in time. */
async function aiInsights(rows:ShiftReportRow[],devs:Dev[],labels:string[],scope:'solvent'|'quality'):Promise<Map<number,Insight>>{
  const out=new Map<number,Insight>();
  if(!process.env.OPENAI_API_KEY||!rows.length)return out;
  const domain=scope==='quality'?'SVMA Quality / Lab Analysing Report shift':'SVMA solvent production/safety shift';
  const instructions=`You are the management insight layer for an ${domain} report. Deterministic code has already decided target compliance and created tickets. You MUST NOT change status, target, actual values, ticket state, or invent measurements. For each parameter return: (1) a short AI comment describing the observed shift pattern using only supplied readings/statuses; and (2) why this MIGHT have arisen, as a cautious hypothesis based on industrial process knowledge, using language such as "may", "could", "possible" (not a confirmed root cause). If evidence is insufficient, say so. Return ONLY JSON: {"rows":[{"parameterId":123,"aiComment":"...","probableCause":"..."}]}.`;
  const compact=(r:ShiftReportRow)=>({parameterId:r.parameterId,section:r.section,parameter:r.parameter,target:r.target,unit:r.unit,hours:labels.map((label,i)=>({hour:label,value:r.hourValues[i]??'',status:r.hourStatuses[i]??''})).filter(h=>h.value!==''),shiftActual:r.shiftActual,status:r.status,comments:r.comments,tickets:r.ticketIds,deviations:devs.filter(d=>Number(d.parameter_id)===r.parameterId).map(d=>({severity:d.severity,actual:d.actual_text,target:d.target_text,status:d.status}))});
  const chunks:ShiftReportRow[][]=[];for(let i=0;i<rows.length;i+=12)chunks.push(rows.slice(i,i+12));
  const client=getOpenAI('Shift Report Summary');
  await Promise.all(chunks.map(async chunk=>{
    try{
      const res=await client.responses.create({model:OPENAI_MODEL,instructions,input:JSON.stringify(chunk.map(compact))} as any,{timeout:35000,maxRetries:0});
      const parsed=JSON.parse(String((res as any).output_text||'').replace(/^```json\s*|```$/g,'').trim());
      for(const x of Array.isArray(parsed?.rows)?parsed.rows:[]){const id=Number(x.parameterId);if(chunk.some(r=>r.parameterId===id)&&x.aiComment)out.set(id,{aiComment:String(x.aiComment),probableCause:String(x.probableCause||'')});}
    }catch{/* those rows keep the data-based comment */}
  }));
  return out;
}

const FILL:Record<string,string>={normal:'FFDCFCE7',warning:'FFFEF3C7',critical:'FFFEE2E2',na:'FFF3F4F6',target_missing:'FFE5E7EB'};
const STATUS_LABEL:Record<string,string>={normal:'Normal',warning:'Warning',critical:'Critical',na:'NA',target_missing:'No target',missing:'Missing'};
const thin={style:'thin' as const,color:{argb:'FFD0D5DD'}};
const border={top:thin,bottom:thin,left:thin,right:thin};
function uniqueName(base:string,used:Set<string>){const clean=base.replace(/[\\/?*\[\]:]/g,' ').replace(/\s+/g,' ').trim().slice(0,31)||'Sheet';let n=clean,i=2;while(used.has(n.toLowerCase())){const suffix=` (${i++})`;n=clean.slice(0,31-suffix.length)+suffix}used.add(n.toLowerCase());return n}

export async function GET(req:NextRequest){try{
 const scope=req.nextUrl.searchParams.get('scope')==='quality'?'quality':'solvent',id=req.nextUrl.searchParams.get('shiftSessionId'),withAi=req.nextUrl.searchParams.get('ai')==='1';
 if(!id)return NextResponse.json({error:'Shift session is required.'},{status:400});
 const az=scope==='quality'?await moduleAuthorization('quality_management',QUALITY_MANAGEMENT_ROLES):await moduleAuthorization('solvent_management',SOLVENT_MANAGEMENT_ROLES);
 if(!az.ok)return NextResponse.json({error:'Download access not assigned'},{status:az.status});
 const data=await buildShiftReportData(scope,id);
 const {session,slotLabels,groups,summary,deviations}=data;
 if(session.status!=='completed')return NextResponse.json({error:'The shift must be completed before the official Excel can be downloaded.'},{status:409});

 const allRows=groups.flatMap(g=>g.rows);
 const ai=withAi?await aiInsights(allRows.filter(r=>isDeviating(r,slotLabels)),deviations as Dev[],slotLabels,scope):new Map<number,Insight>();

 const wb=new ExcelJS.Workbook();wb.creator='SVMA Intelligence';wb.created=new Date();
 const activeProducts=Array.isArray(session.active_products)?session.active_products.map(String):[];
 const ist=(v:string|null|undefined)=>v?new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—';
 const sws=wb.addWorksheet('Summary');sws.columns=[{width:28},{width:72}];
 const info:[string,string|number][]=[
  ['SVMA',scope==='quality'?'QUALITY SHIFT REPORT':'SOLVENT PRODUCTION & SAFETY SHIFT REPORT'],['Operational Date',session.operational_date],['Shift',session.shift_master?.name||''],
  ['Running Products',activeProducts.map(productName).join(', ')||'—'],['Data Entered By',session.entry_person_name||'—'],
  ...(session.handoff?[['Handed Off To',`${session.handoff.toName} at ${ist(session.handoff.handedOffAt)}`] as [string,string]]:[]),
  ['Scheduled Start',ist(session.scheduled_start)],['Scheduled End',ist(session.scheduled_end)],['Completed At',ist(session.actual_end)],
  ['Submitted Records',summary.submittedRecords],['Normal',summary.normal],['Warning',summary.warning],['Critical',summary.critical],['NA',summary.na],['Target Not Configured',summary.unconfigured],['Deviation Tickets',summary.deviationTickets],
  ['Comments',withAi?'AI commentary is included for rows that deviated. Probable-cause text is a hypothesis only; ticket/root-cause closure requires human review.':'Comments are written from the recorded readings.'],
 ];
 info.forEach(([k,v],i)=>{const row=sws.addRow([k,v]);row.getCell(1).font={bold:true};row.getCell(2).alignment={wrapText:true,vertical:'top'};if(i===0){row.font={bold:true,size:13}}});
 sws.addRow([]);sws.addRow(['Powered by','AIX3']);

 const used=new Set<string>(['summary']);
 for(const g of groups){
  const headers=['S.No',scope==='solvent'?'Section':'Product','Parameter / Unit','Target','Sampling',...slotLabels,'Shift Actual','Status','Ticket ID',withAi?'AI Comments':'Comments (from readings)',withAi?'Why this might have arisen (AI hypothesis — not confirmed root cause)':'Probable cause','Operator Comments','Entered By','Entered At'];
  const ws=wb.addWorksheet(uniqueName(`${g.productCode==='PLANT'?'Plant':g.productCode} ${g.sectionLabel}`,used),{views:[{state:'frozen',xSplit:3,ySplit:1}]});
  ws.columns=[{width:8},{width:24},{width:48},{width:20},{width:18},...slotLabels.map(()=>({width:12})),{width:16},{width:12},{width:24},{width:56},{width:60},{width:42},{width:22},{width:22}];
  const head=ws.getRow(1);headers.forEach((h,i)=>{const c=head.getCell(i+1);c.value=h;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F3A5F'}};c.alignment={vertical:'middle',horizontal:'center',wrapText:true};c.border=border});head.height=34;
  const firstHour=6;
  for(const r of g.rows){
   const insight=ai.get(r.parameterId)||observed(r,slotLabels);
   const row=ws.addRow([r.sourceSerial,scope==='solvent'?g.sectionLabel:g.productLabel,`${r.parameter}${r.unit?` (${r.unit})`:''}`,r.target,r.frequency,...r.hourValues,r.shiftActual,STATUS_LABEL[r.status]||r.status,r.ticketIds.join(', '),insight.aiComment,insight.probableCause,r.comments,r.enteredBy,r.enteredAt]);
   row.eachCell({includeEmpty:true},c=>{c.border=border;c.alignment={vertical:'top',wrapText:true}});
   slotLabels.forEach((_,i)=>{const s=r.hourStatuses[i];if(s&&FILL[s]){row.getCell(firstHour+i).fill={type:'pattern',pattern:'solid',fgColor:{argb:FILL[s]}}}});
   const stCell=row.getCell(firstHour+slotLabels.length+1);if(FILL[r.status]){stCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:FILL[r.status]}};stCell.font={bold:true}}
   if(r.status==='critical')row.getCell(3).font={bold:true,color:{argb:'FFB42318'}};
  }
  ws.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}};
 }
 const buf=await wb.xlsx.writeBuffer();
 const name=`SVMA_${scope==='quality'?'Quality':'Solvent'}_Shift_${session.operational_date}_${String(session.shift_master?.name||'Shift').replace(/\s+/g,'_')}${withAi?'_AI':''}.xlsx`;
 return new NextResponse(new Uint8Array(buf as ArrayBuffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`,'Cache-Control':'no-store'}});
}catch(e){logServerError('export/shift',e);return NextResponse.json({error:errorMessage(e,'Unable to export shift')},{status:500})}}
