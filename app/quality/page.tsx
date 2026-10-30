'use client';
import {TicketSummary} from '@/components/TicketSummary';
import {useEffect,useState} from 'react';
import {AlertTriangle,BrainCircuit,FileSpreadsheet,FlaskConical,LineChart,TicketCheck,TestTube2} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';import {Kpi} from '@/components/Kpi';import {StatusBars,TrendChart} from '@/components/IntelligenceCharts';import {SkeletonDashboard} from '@/components/Skeleton';import {targetBounds} from '@/lib/metrics';
import {PeriodFilter, type Period} from '@/components/PeriodFilter';
import {SubNav} from '@/components/SubNav';
const subNavItems=[
 {href:'/quality/analytics',label:'Analytics',icon:LineChart},
 {href:'/quality/ai-inference',label:'Uruv.ai Insight',icon:BrainCircuit},
 {href:'/quality/reports',label:'Reports',icon:FileSpreadsheet},
 {href:'/quality/deviations',label:'Deviations',icon:AlertTriangle},
 {href:'/quality/tickets',label:'Tickets',icon:TicketCheck},
];
export default function Quality(){
 const [period,setPeriod]=useState<Period>({date:'',shiftId:'',product:''});
 const [d,setD]=useState<any>(),[error,setError]=useState(''),[refreshKey,setRefreshKey]=useState(0);
 const [metricKey,setMetricKey]=useState('');
 useEffect(()=>{const qs=new URLSearchParams();if(period.date)qs.set('date',period.date);if(period.shiftId)qs.set('shiftId',period.shiftId);if(period.product)qs.set('product',period.product);fetch(`/api/quality/dashboard?${qs.toString()}`,{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Dashboard failed (${r.status})`);return j}).then(setD).catch(e=>{setD({summary:{},metrics:[],products:[],criticalTimeline:[]});setError(e instanceof Error?e.message:'Dashboard failed')})},[period.date,period.shiftId,period.product,refreshKey]);
 const s=d?.summary||{};
 const graphable=(d?.metrics||[]).filter((m:any)=>m.points?.filter((p:any)=>Number.isFinite(Number(p.value))).length>1);
 useEffect(()=>{if(graphable.length&&!graphable.some((m:any)=>m.key===metricKey))setMetricKey(graphable[0].key)},[graphable.map((m:any)=>m.key).join('|')]);
 const selected=graphable.find((m:any)=>m.key===metricKey)||null;
 if(!d)return <><PageHeader title="Quality Intelligence" subtitle="" backHref="/" backLabel="Home"/><SkeletonDashboard/></>;
 return <><PageHeader title="Quality Intelligence" subtitle="" backHref="/" backLabel="Home" action={d?.activeShift?<span className="pill ok">{d.activeShift.shift_master?.name||'SHIFT'} LIVE</span>:<span className="pill neutral">NO LIVE SHIFT</span>}/>
 <SubNav items={subNavItems}/>
 <TicketSummary scope="quality"/>
 <PeriodFilter period={period} onChange={setPeriod} liveSessions={(d?.liveShifts||[]).map((shift:any)=>({scope:'quality' as const,shift}))} onStopped={()=>setRefreshKey(x=>x+1)} products={[{code:'RB',name:'Rice Bran'},{code:'COPRA',name:'Copra'},{code:'PK',name:'Palm Kernel'}]}/>
 {error?<div className="session-error-banner" style={{marginBottom:14}}><b>Quality dashboard data could not be loaded.</b><span>{error}</span></div>:null}
 <div className="grid kpis modern-kpis" style={{marginTop:16}}><Kpi icon={FlaskConical} tone="green" label="Quality Health" value={s.health==null?'N/A':`${s.health}%`} foot={s.health==null?'Awaiting Quality Results':`${s.submitted||0} submitted results`}/><Kpi icon={TestTube2} tone="blue" label="Normal" value={s.normal??'—'} foot="Within configured target"/><Kpi icon={AlertTriangle} tone="amber" label="Warnings" value={s.warnings??'—'} foot={`${s.unconfigured||0} targets awaiting setup`}/><Kpi icon={TicketCheck} tone="rose" label="Open Actions" value={s.openTickets??'—'} foot={`${s.openDeviations??0} deviations`}/></div>
 <div className="grid kpis modern-kpis" style={{marginTop:12}}><Kpi icon={TestTube2} tone="cyan" label="Samples Received" value={s.samplesExpected?`${s.samplesReceived||0}/${s.samplesExpected}`:'—'} foot={`${s.sampleOverdue||0} sample overdue`}/><Kpi icon={TestTube2} tone="indigo" label="Results On Time" value={s.resultsExpected?`${s.resultsOnTime||0}/${s.resultsExpected}`:'—'} foot={`${s.resultOverdue||0} result overdue`}/></div>
 <div className="dashboard-canvas" style={{marginTop:16}}><section className="dashboard-panel span-5"><div className="panel-heading"><div><span>QUALITY STATUS</span><h3>Validated result mix</h3></div><FlaskConical size={20}/></div><StatusBars normal={s.normal||0} warning={s.warnings||0} critical={s.critical||0}/><div className="quality-product-list">{(d?.products||[]).map((p:any)=><div key={p.code}><span><i className={p.active?'live-dot':''}/>{p.name}</span><b>{p.submitted&&p.health!=null?`${p.health}%`:'N/A'}</b></div>)}</div></section><section className="dashboard-panel span-7"><div className="panel-heading"><div><span>ATTENTION TIMELINE</span><h3>Recent target deviations</h3></div></div><div className="event-timeline">{(d?.criticalTimeline||[]).slice(0,6).map((x:any,i:number)=><div key={i} className={`event-row ${x.status}`}><i/><div><b>{x.parameter}</b><span>{x.product} • {x.group}</span></div><div><strong>{x.actual??'—'}</strong><small>Target {x.target||'—'}</small></div><time>{new Date(x.time).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div>)}{!d?.criticalTimeline?.length?<p className="panel-muted">No out-of-target Quality result is available yet.</p>:null}</div></section><section className="dashboard-panel span-12">
  <div className="panel-heading"><div><span>PARAMETER TREND</span><h3>{selected?selected.name:'Pick a parameter to view its trend'}</h3></div>
   {graphable.length?<select value={metricKey} onChange={e=>setMetricKey(e.target.value)} style={{minWidth:220}}>{graphable.map((m:any)=><option key={m.key} value={m.key}>{m.group} • {m.name}</option>)}</select>:null}
  </div>
  {selected?(()=>{const b=targetBounds(selected.target);return <><div className="split-header" style={{marginBottom:10}}><span className="sub">{selected.product} • {selected.group}</span><span className={`pill ${selected.critical?'danger':selected.warnings?'warn':'ok'}`}>{selected.latest??'—'} {selected.unit||''}</span></div><TrendChart points={selected.points} targetLow={b.low} targetHigh={b.high}/></>})():<p className="panel-muted">No parameter has enough submitted readings yet to plot a trend.</p>}
 </section></div>
 </>;
}
