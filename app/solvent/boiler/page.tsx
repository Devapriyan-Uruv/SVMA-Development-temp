'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {SkeletonDashboard} from '@/components/Skeleton';
import {TrendChart} from '@/components/IntelligenceCharts';
import {BoilerGauges,CriticalBanner,isBoilerMetric} from '@/components/SolventInsights';
import {targetBounds} from '@/lib/metrics';

// Boiler and steam at a glance: the boiler / steam / utility readings of the Solvent dashboard as dials, the trend of one of them and every reading with its
// state. It only reads /api/solvent/dashboard (the same data as the dashboard); entering readings stays on the Boiler entry page.
export default function SolventBoiler(){
 const [d,setD]=useState<any>(null),[error,setError]=useState(''),[key,setKey]=useState('');
 useEffect(()=>{fetch('/api/solvent/dashboard',{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Failed (${r.status})`);return j}).then(setD).catch(e=>{setD({metrics:[]});setError(e instanceof Error?e.message:'Unable to load')})},[]);
 const all:any[]=d?.metrics||[],boiler=all.filter(isBoilerMetric);
 const graphable=boiler.filter(m=>(m.points||[]).filter((p:any)=>Number.isFinite(Number(p.value))).length>1);
 useEffect(()=>{if(graphable.length&&!graphable.some(m=>m.key===key))setKey(graphable[0].key)},[graphable.map(m=>m.key).join('|')]);
 const sel=graphable.find(m=>m.key===key)||null;
 const entry=<Link href="/input/boiler" className="btn btn-primary">Open boiler entry</Link>;
 if(!d)return <><PageHeader eyebrow="Utilities" title="Boiler and steam" subtitle="" action={entry}/><SkeletonDashboard/></>;
 const bad=boiler.filter(m=>m.critical).length,warn=boiler.filter(m=>!m.critical&&m.warning).length;
 return <><PageHeader eyebrow="Utilities" title="Boiler and steam" subtitle="" action={entry}/>
  {error?<div className="notice danger" style={{marginBottom:14}}>{error}</div>:null}
  {boiler.length?<CriticalBanner metrics={boiler}/>:null}
  {boiler.length?<BoilerGauges metrics={boiler} limit={8} bare/>:<div className="card empty">No boiler or steam readings have been submitted for this shift yet.</div>}
  {boiler.length?<div className="dashboard-canvas" style={{marginTop:16}}>
   <section className="dashboard-panel span-7"><div className="panel-heading"><div><span>TREND</span><h3>{sel?sel.name:'Pick a reading'}</h3></div>{graphable.length?<select value={key} onChange={e=>setKey(e.target.value)} style={{minWidth:220}}>{graphable.map(m=><option key={m.key} value={m.key}>{m.section} • {m.name}</option>)}</select>:null}</div>
    {sel?(()=>{const b=targetBounds(sel.target);return <><TrendChart points={sel.points} targetLow={b.low} targetHigh={b.high}/><div className="chart-meta"><span>Target <b>{sel.target||'Not configured'}</b></span><span>Latest <b>{sel.latest??'—'} {sel.unit||''}</b></span></div></>})():<p className="panel-muted">No boiler reading has enough submitted values to plot yet.</p>}
   </section>
   <section className="dashboard-panel span-5"><div className="panel-heading"><div><span>ALL READINGS</span><h3>{boiler.length} boiler and steam checks</h3></div><span className="pill neutral">{bad} alert · {warn} watch</span></div>
    <div className="boiler-list">{boiler.slice(0,40).map((m,i)=><div className="boiler-row" key={(m.key||'')+i}><i className={`dot d-${m.critical?'bad':m.warning?'warn':'ok'}`}/><span><b>{m.name}</b><small>{m.section}</small></span><span className={`num ${m.critical?'t-bad':m.warning?'t-warn':''}`}>{m.latest==null||m.latest===''?'—':String(m.latest)}{m.unit?` ${m.unit}`:''}</span></div>)}</div>
   </section>
  </div>:null}</>;
}
