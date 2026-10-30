'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {productName} from '@/lib/products';
import {DateRangeFilter} from '@/components/DateRangeFilter';
import {Download} from 'lucide-react';
export default function QualityDeviations(){
 const [rows,setRows]=useState<any[]>([]),[downloading,setDownloading]=useState(false),[error,setError]=useState('');
 const [from,setFrom]=useState(''),[to,setTo]=useState('');
 const [severity,setSeverity]=useState(''),[section,setSection]=useState(''),[allSections,setAllSections]=useState<string[]>([]);
 function load(){
  const qs=new URLSearchParams({scope:'quality'});if(from)qs.set('from',from);if(to)qs.set('to',to);if(severity)qs.set('severity',severity);if(section)qs.set('section',section);
  fetch(`/api/deviations?${qs.toString()}`,{cache:'no-store'}).then(r=>r.json()).then(j=>setRows(j.deviations||[])).catch(()=>{});
 }
 useEffect(()=>{load()},[from,to,severity,section]);
 useEffect(()=>{fetch('/api/deviations?scope=quality',{cache:'no-store'}).then(r=>r.json()).then(j=>setAllSections(Array.from(new Set((j.deviations||[]).map((r:any)=>r.parameter_master?.parameter_sections?.name).filter(Boolean))) as string[])).catch(()=>{})},[]);
 async function download(){
  setDownloading(true);setError('');
  try{
   const qs=new URLSearchParams({scope:'quality'});if(from)qs.set('from',from);if(to)qs.set('to',to);
   const r=await fetch(`/api/deviations/export?${qs.toString()}`,{cache:'no-store'});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Unable to download.')}
   const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');
   a.href=url;a.download=`SVMA_Quality_Deviations_${new Date().toISOString().slice(0,10)}.xlsx`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:'Unable to download.')}finally{setDownloading(false)}
 }
 return <><PageHeader title="Quality Deviations" subtitle="Lab readings outside the source target, generated immediately at the time of entry" backHref="/quality" backLabel="Quality"
  action={<button type="button" className="btn btn-primary" disabled={downloading||!rows.length} onClick={download}><Download size={16}/>{downloading?'Downloading…':'Download Excel'}</button>}/>
  {error?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}
  <div className="card" style={{marginBottom:14,display:'flex',flexWrap:'wrap',alignItems:'center',gap:14}}>
   <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} onClear={()=>{setFrom('');setTo('')}}/>
   <label className="sub" style={{display:'grid',gap:4}}>Severity<select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option></select></label>
   <label className="sub" style={{display:'grid',gap:4}}>Section<select value={section} onChange={e=>setSection(e.target.value)}><option value="">All sections</option>{allSections.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
   {severity||section?<button type="button" className="btn btn-outline" onClick={()=>{setSeverity('');setSection('')}}>Clear</button>:null}
  </div>
  <div className="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Group</th><th>S.No</th><th>Metric</th><th>Target</th><th>Actual</th><th>Deviation</th><th>Operator</th><th>Severity</th><th>Status</th></tr></thead><tbody>{rows.map(r=>{const pc=r.parameter_entries?.product_code;return <tr key={r.id}><td>{new Date(r.created_at).toLocaleString()}</td><td>{pc&&pc!=='PLANT'?productName(pc):'—'}</td><td>{r.parameter_master?.source_group||'—'}</td><td>{r.parameter_master?.source_serial||'—'}</td><td>{r.parameter_master?.name}</td><td>{r.target_text}</td><td>{r.actual_text}</td><td>{r.variance??'—'}{r.variance!=null&&r.parameter_master?.unit?` ${r.parameter_master.unit}`:''}</td><td>{r.parameter_entries?.profiles?.full_name||r.parameter_entries?.profiles?.email||'—'}</td><td><span className={`pill ${r.severity==='critical'?'danger':'warn'}`}>{String(r.severity).toUpperCase()}</span></td><td>{r.status}</td></tr>})}</tbody></table></div>
  {!rows.length?<div className="card empty" style={{marginTop:12}}>No Quality deviations recorded{from||to?' for this date range':''}.</div>:null}
 </>;
}
