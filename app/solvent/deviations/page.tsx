'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {productName} from '@/lib/products';
import {DateRangeFilter} from '@/components/DateRangeFilter';
import {Download} from 'lucide-react';
export default function Deviations(){
 const [rows,setRows]=useState<any[]>([]),[downloading,setDownloading]=useState(false),[error,setError]=useState('');
 const [from,setFrom]=useState(''),[to,setTo]=useState('');
 const [severity,setSeverity]=useState(''),[section,setSection]=useState('');
 const [allSections,setAllSections]=useState<string[]>([]);
 function load(){
  const qs=new URLSearchParams();if(from)qs.set('from',from);if(to)qs.set('to',to);if(severity)qs.set('severity',severity);if(section)qs.set('section',section);
  fetch(`/api/deviations?${qs.toString()}`,{cache:'no-store'}).then(r=>r.json()).then(j=>setRows(j.deviations||[])).catch(()=>{});
 }
 useEffect(()=>{load()},[from,to,severity,section]);
 // Populated once from an unfiltered load so the section dropdown's own
 // option list doesn't shrink to just the currently-selected section.
 useEffect(()=>{fetch('/api/deviations',{cache:'no-store'}).then(r=>r.json()).then(j=>setAllSections(Array.from(new Set((j.deviations||[]).map((r:any)=>r.parameter_master?.parameter_sections?.name).filter(Boolean))) as string[])).catch(()=>{})},[]);
 async function download(){
  setDownloading(true);setError('');
  try{
   const qs=new URLSearchParams({scope:'solvent'});if(from)qs.set('from',from);if(to)qs.set('to',to);
   const r=await fetch(`/api/deviations/export?${qs.toString()}`,{cache:'no-store'});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Unable to download.')}
   const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');
   a.href=url;a.download=`SVMA_Solvent_Deviations_${new Date().toISOString().slice(0,10)}.xlsx`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:'Unable to download.')}finally{setDownloading(false)}
 }
 return <><PageHeader title="Deviation Register" subtitle="Target and expected-condition exceptions raised immediately from submitted Solvent production and safety readings" backHref="/solvent" backLabel="Solvent Production & Safety"
  action={<button type="button" className="btn btn-primary" disabled={downloading||!rows.length} onClick={download}><Download size={16}/>{downloading?'Downloading…':'Download Excel'}</button>}/>
  {error?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}
  {rows.length?<div className="dev-strip"><div className="dev-stat bad"><span>CRITICAL</span><b className="num">{rows.filter(r=>r.severity==='critical').length}</b></div><div className="dev-stat warn"><span>WARNING</span><b className="num">{rows.filter(r=>r.severity==='warning').length}</b></div><div className="dev-stat"><span>STILL OPEN</span><b className="num">{rows.filter(r=>r.status==='open').length}</b></div><div className="dev-stat"><span>SHOWN</span><b className="num">{rows.length}</b></div></div>:null}
  <div className="card" style={{marginBottom:14,display:'flex',flexWrap:'wrap',alignItems:'center',gap:14}}>
   <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} onClear={()=>{setFrom('');setTo('')}}/>
   <label className="sub" style={{display:'grid',gap:4}}>Severity<select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option></select></label>
   <label className="sub" style={{display:'grid',gap:4}}>Section<select value={section} onChange={e=>setSection(e.target.value)}><option value="">All sections</option>{allSections.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
   {severity||section?<button type="button" className="btn btn-outline" onClick={()=>{setSeverity('');setSection('')}}>Clear</button>:null}
  </div>
  <div className="card">{!rows.length?<div className="empty">No deviations recorded{from||to||severity||section?' for these filters':' yet'}.</div>:<div className="table-wrap"><table><thead><tr><th>Time</th><th>Shift</th><th>Section</th><th>Product</th><th>Parameter</th><th>Target</th><th>Actual</th><th>Deviation</th><th>Operator</th><th>Severity</th><th>Status</th></tr></thead><tbody>{rows.map(r=>{const pc=r.parameter_entries?.product_code;return <tr key={r.id} className={`sev-${r.severity}`}><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.shift_sessions?.shift_master?.name||'—'}</td><td>{r.parameter_master?.parameter_sections?.name||'—'}</td><td>{pc&&pc!=='PLANT'?productName(pc):'Plant-wide'}</td><td><b>{r.parameter_master?.name||'—'}</b></td><td>{r.target_text}</td><td>{r.actual_text}</td><td>{r.variance??'—'}{r.variance!=null&&r.parameter_master?.unit?` ${r.parameter_master.unit}`:''}</td><td>{r.parameter_entries?.profiles?.full_name||r.parameter_entries?.profiles?.email||'—'}</td><td><span className={`pill ${r.severity==='critical'?'danger':r.severity==='warning'?'warn':'info'}`}>{String(r.severity).toUpperCase()}</span></td><td>{String(r.status).replaceAll('_',' ')}</td></tr>})}</tbody></table></div>}</div></>}
