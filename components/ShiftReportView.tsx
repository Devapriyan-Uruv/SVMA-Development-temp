'use client';
import {useEffect,useState} from 'react';
import {Download} from 'lucide-react';
import {PageHeader} from './PageHeader';
import {StatusBadge} from './StatusBadge';

type Row={parameterId:number;sourceSerial:string;section:string;parameter:string;unit:string;target:string;frequency:string;hourValues:string[];hourStatuses:(string|null)[];shiftActual:string;status:string;comments:string;ticketIds:string[];enteredBy:string;enteredAt:string};
type Group={key:string;productCode:string;productLabel:string;sectionLabel:string;rows:Row[]};
type ReportData={session:any;scope:'solvent'|'quality';slotLabels:string[];groups:Group[];summary:{submittedRecords:number;normal:number;warning:number;critical:number;na:number;unconfigured:number;deviationTickets:number}};

export function ShiftReportView({scope,shiftSessionId}:{scope:'solvent'|'quality';shiftSessionId:string}){
 const [data,setData]=useState<ReportData|null>(null),[error,setError]=useState('');
 useEffect(()=>{setData(null);setError('');fetch(`/api/reports/shift-view?scope=${scope}&shiftSessionId=${encodeURIComponent(shiftSessionId)}`,{cache:'no-store'}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to load report');return j}).then(setData).catch(e=>setError(e instanceof Error?e.message:'Unable to load report'))},[scope,shiftSessionId]);

 const backHref=`/${scope}/reports`;
 if(error)return <><PageHeader title="Shift report" backHref={backHref} backLabel="Reports"/><div className="notice danger" style={{marginTop:12}}>{error}</div></>;
 if(!data)return <><PageHeader title="Shift report" backHref={backHref} backLabel="Reports"/><div className="empty" style={{marginTop:12}}>Loading report…</div></>;

 const {session,slotLabels,groups,summary}=data;
 const sectionOrProduct=scope==='solvent'?'Section':'Product';
 return <>
  <PageHeader title={`${session.shift_master?.name||'Shift'} • ${session.operational_date}`} subtitle={`${scope==='quality'?'Quality':'Solvent'} shift report. The Excel has exactly what you see here; the AI version adds commentary on deviations and takes longer.`} backHref={backHref} backLabel="Reports" action={<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><a className="btn btn-primary" href={`/api/export/shift?scope=${scope}&shiftSessionId=${encodeURIComponent(shiftSessionId)}`}><Download size={16}/> Download Excel</a><a className="btn btn-outline" title="Adds AI commentary on deviated readings. Takes about half a minute." href={`/api/export/shift?scope=${scope}&shiftSessionId=${encodeURIComponent(shiftSessionId)}&ai=1`}><Download size={16}/> Excel with AI commentary</a></div>}/>

  <section className="card" style={{marginTop:14}}>
   <div className="grid four" style={{gap:10}}>
    <SummaryStat label="Entered by" value={session.entry_person_name||'—'}/>
    {session.handoff?<SummaryStat label="Handed off to" value={`${session.handoff.toName} at ${new Date(session.handoff.handedOffAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}`}/>:null}
    <SummaryStat label="Completed at" value={session.actual_end?new Date(session.actual_end).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—'}/>
    <SummaryStat label="Submitted records" value={String(summary.submittedRecords)}/>
    <SummaryStat label="Deviation tickets" value={String(summary.deviationTickets)}/>
   </div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
    <span className="pill ok">{summary.normal} normal</span>
    <span className="pill warn">{summary.warning} warning</span>
    <span className="pill danger">{summary.critical} critical</span>
    <span className="pill neutral">{summary.na} NA</span>
    {summary.unconfigured?<span className="pill neutral">{summary.unconfigured} no target</span>:null}
   </div>
  </section>

  {groups.map(g=><section className="card" key={g.key} style={{marginTop:14,padding:0}}>
   <div className="panel-heading" style={{padding:'15px 17px 0'}}><div><span>{scope==='solvent'?g.sectionLabel.toUpperCase():g.productLabel.toUpperCase()}</span><h3>{scope==='solvent'?(g.productLabel!=='Plant-wide'?g.productLabel:'Plant-wide'):g.sectionLabel}</h3></div></div>
   <div className="table-wrap" style={{border:0,marginTop:10}}>
    <table>
     <thead><tr>
      <th>S.No</th><th>{sectionOrProduct}</th><th>Parameter</th><th>Target</th>
      {slotLabels.map(l=><th key={l}>{l}</th>)}
      <th>Shift Actual</th><th>Status</th><th>Ticket</th><th>Comments</th><th>Entered by</th><th>Entered at</th>
     </tr></thead>
     <tbody>{g.rows.map(r=><tr key={r.parameterId} className={r.status==='critical'?'row-flagged':''}>
      <td>{r.sourceSerial||'—'}</td>
      <td>{scope==='solvent'?g.sectionLabel:g.productLabel}</td>
      <td><b>{r.parameter}</b>{r.unit?<div className="sub">Unit: {r.unit}</div>:null}</td>
      <td>{r.target}</td>
      {r.hourValues.map((v,i)=><td key={i}>{v||'—'}</td>)}
      <td>{r.shiftActual||'—'}</td>
      <td><StatusBadge status={r.status}/></td>
      <td>{r.ticketIds.length?r.ticketIds.join(', '):'—'}</td>
      <td>{r.comments||'—'}</td>
      <td>{r.enteredBy||'—'}</td>
      <td>{r.enteredAt||'—'}</td>
     </tr>)}</tbody>
    </table>
   </div>
  </section>)}
  {!groups.length?<div className="empty" style={{marginTop:14}}>No entries recorded for this shift.</div>:null}
 </>;
}
function SummaryStat({label,value}:{label:string;value:string}){return <div><div className="kpi-label">{label}</div><div className="kpi-value" style={{fontSize:16}}>{value}</div></div>}
