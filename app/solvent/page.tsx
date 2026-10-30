'use client';
import Link from 'next/link';
import {TicketSummary} from '@/components/TicketSummary';
import {useEffect,useState} from 'react';
import {Activity,ArrowRight,BrainCircuit,ChartNoAxesCombined,FileChartColumn,ShieldAlert,Tickets,Flame,Factory,Clock3} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {Kpi} from '@/components/Kpi';
import {StatusBars,TrendChart} from '@/components/IntelligenceCharts';
import {SkeletonDashboard} from '@/components/Skeleton';
import {targetBounds} from '@/lib/metrics';
import {PeriodFilter, type Period} from '@/components/PeriodFilter';
import {SubNav} from '@/components/SubNav';

const cards=[
 {href:'/solvent/ai-inference',label:'Uruv.ai Insight',icon:BrainCircuit},
 {href:'/solvent/analytics',label:'Analytics',icon:ChartNoAxesCombined},
 {href:'/solvent/reports',label:'Reports',icon:FileChartColumn},
 {href:'/solvent/tickets',label:'Tickets',icon:Tickets},
 {href:'/solvent/deviations',label:'Deviations',icon:ShieldAlert},
];
export default function SolventDashboard(){
 const [period,setPeriod]=useState<Period>({date:'',shiftId:'',product:''});
 const [d,setD]=useState<any>(null),[error,setError]=useState(''),[refreshKey,setRefreshKey]=useState(0);
 const [metricKey,setMetricKey]=useState('');
 useEffect(()=>{const qs=new URLSearchParams();if(period.date)qs.set('date',period.date);if(period.shiftId)qs.set('shiftId',period.shiftId);if(period.product)qs.set('product',period.product);fetch(`/api/solvent/dashboard?${qs.toString()}`,{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Dashboard failed (${r.status})`);return j}).then(setD).catch(e=>{setD({summary:{},production:{},safety:{},metrics:[],products:[]});setError(e instanceof Error?e.message:'Dashboard failed')})},[period.date,period.shiftId,period.product,refreshKey]);
 const s=d?.summary||{},production=d?.production||{},safety=d?.safety||{};
 const graphable=(d?.metrics||[]).filter((m:any)=>m.points?.filter((p:any)=>Number.isFinite(Number(p.value))).length>1);
 useEffect(()=>{if(graphable.length&&!graphable.some((m:any)=>m.key===metricKey))setMetricKey(graphable[0].key)},[graphable.map((m:any)=>m.key).join('|')]);
 const selected=graphable.find((m:any)=>m.key===metricKey)||null;
 if(!d)return <><PageHeader title="Solvent Production & Safety" subtitle="" backHref="/" backLabel="Home"/><SkeletonDashboard/></>;
 return <><PageHeader title="Solvent Production & Safety" subtitle="" backHref="/" backLabel="Home" action={d?.activeShift?<span className="pill ok">{d.activeShift.shift_master?.name||'SHIFT'} LIVE</span>:<span className="pill neutral">NO LIVE SHIFT</span>}/>
 <SubNav items={cards}/>
 <TicketSummary scope="solvent"/>
 <PeriodFilter period={period} onChange={setPeriod} liveSessions={(d?.liveShifts||[]).map((shift:any)=>({scope:'solvent' as const,shift}))} onStopped={()=>setRefreshKey(x=>x+1)} products={[{code:'RB',name:'Rice Bran'},{code:'COPRA',name:'Copra'},{code:'PK',name:'Palm Kernel'}]}/>
 {error?<div className="session-error-banner" style={{marginBottom:14}}><b>Solvent dashboard data could not be loaded.</b><span>{error}</span><small>Entry and Finance data are unchanged; this is an access/runtime issue only.</small></div>:null}
 <div className="grid kpis modern-kpis" style={{marginTop:16}}><Kpi icon={Clock3} tone="blue" label="Shift Coverage" value={d?`${s.compliance||0}%`:'—'} foot={`${s.submitted||0} of ${s.expected||0} expected`}/><Kpi icon={Factory} tone="green" label="Production Health" value={d?`${production.health||0}%`:'—'} foot={`${production.submitted||0} process readings`}/><Kpi icon={ShieldAlert} tone="cyan" label="Safety Health" value={d?`${safety.health||0}%`:'—'} foot={`${safety.submitted||0} safety / boiler checks`}/><Kpi icon={Tickets} tone="rose" label="Open Actions" value={s.openTickets??'—'} foot={`${s.openDeviations??0} open deviations`}/></div>
 <div className="dashboard-canvas" style={{marginTop:16}}><section className="dashboard-panel span-7"><div className="panel-heading"><div><span>LIVE STATUS</span><h3>Parameter condition</h3></div><Activity size={20}/></div><StatusBars normal={s.normal||0} warning={s.warning||0} critical={s.critical||0}/><div className="health-split"><div><Flame size={18}/><span>Critical</span><b>{s.critical||0}</b></div><div><ShieldAlert size={18}/><span>Warning</span><b>{s.warning||0}</b></div><div><Clock3 size={18}/><span>Late</span><b>{s.late||0}</b></div></div></section><section className="dashboard-panel span-5"><div className="panel-heading"><div><span>{period.date?'VIEWING':d?.activeShift?.status==='paused'?'SHIFT PAUSED':'ACTIVE SHIFT'}</span><h3>{period.date?`${period.date}${d?.period?.shiftLabel?` • ${d.period.shiftLabel}`:''}`:(d?.activeShift?.shift_master?.name||'No active shift')}</h3></div>{!period.date&&d?.activeShift?.status==='paused'?<span className="pill warn">Paused</span>:null}</div><p className="panel-muted">{period.date?`${d?.period?.sessionCount||0} shift session(s) on this date.`:d?.activeShift?`${new Date(d.activeShift.scheduled_start).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} – ${new Date(d.activeShift.scheduled_end).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'Start a Solvent shift from Solvent Parameter Input.'}</p>
{!period.date&&d?.activeShift?.actual_start?<p className="panel-muted" style={{marginTop:2}}>{(()=>{const started=new Date(d.activeShift.actual_start),mins=Math.max(0,Math.round((Date.now()-started.getTime())/60000)),h=Math.floor(mins/60),m=mins%60;return`Started ${started.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} • running ${h}h ${m}m`})()}</p>:null}<div className="product-health-list">{(d?.products||[]).map((p:any)=><div key={p.code}><span>{p.name}</span><b>{p.health}%</b><i><em style={{width:`${p.health}%`}}/></i></div>)}</div><Link href="/input" className="text-link">Open Solvent Parameter Input <ArrowRight size={15}/></Link></section>
 <section className="dashboard-panel span-12">
  <div className="panel-heading"><div><span>PARAMETER TREND</span><h3>{selected?selected.name:'Pick a parameter to view its trend'}</h3></div>
   {graphable.length?<select value={metricKey} onChange={e=>setMetricKey(e.target.value)} style={{minWidth:220}}>{graphable.map((m:any)=><option key={m.key} value={m.key}>{m.section} • {m.name}</option>)}</select>:null}
  </div>
  {selected?(()=>{const b=targetBounds(selected.target);return <><div className="split-header" style={{marginBottom:10}}><span className="sub">{selected.product} • {selected.section}</span><span className={`pill ${selected.critical?'danger':selected.warning?'warn':'ok'}`}>{selected.latest??'—'} {selected.unit||''}</span></div><TrendChart points={selected.points} targetLow={b.low} targetHigh={b.high}/><div className="chart-meta"><span>Target <b>{selected.target||'Not configured'}</b></span><span>Average <b>{selected.average==null?'—':Number(selected.average).toFixed(2)}</b></span></div></>})():<p className="panel-muted">No parameter has enough submitted readings yet to plot a trend.</p>}
 </section>
 </div></>;
}
