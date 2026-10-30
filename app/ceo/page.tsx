'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowRight,BadgeIndianRupee,Boxes,CheckCircle2,ChevronDown,ChevronUp,CircleAlert,Factory,FlaskConical,Lightbulb,Radio,ShieldAlert,ShoppingCart,Sparkles,TicketCheck,TrendingUp,Truck,TriangleAlert} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {Kpi} from '@/components/Kpi';
import {StatusBars,Donut,TrendChart} from '@/components/IntelligenceCharts';
import {SkeletonDashboard} from '@/components/Skeleton';
import {PeriodFilter, type Period} from '@/components/PeriodFilter';
import {ShiftControlList} from '@/components/ShiftControlList';

export default function CEO(){
 const [period,setPeriod]=useState<Period>({date:'',shiftId:'',product:''});
 const [d,setD]=useState<any>(null),[error,setError]=useState(''),[refreshKey,setRefreshKey]=useState(0);
 const [showShift,setShowShift]=useState(false);
 useEffect(()=>{const qs=new URLSearchParams();if(period.date)qs.set('date',period.date);if(period.shiftId)qs.set('shiftId',period.shiftId);fetch(`/api/ceo/dashboard?${qs.toString()}`,{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Dashboard failed (${r.status})`);return j}).then(setD).catch(e=>{setD({ss:{},qs:{},prod:{},safe:{},good:[],attention:[],better:[],trends:[],finance:{}});setError(e instanceof Error?e.message:'Dashboard failed')})},[period.date,period.shiftId,refreshKey]);
 if(!d)return <><PageHeader title="Management" subtitle="" backHref="/" backLabel="Home"/><SkeletonDashboard/></>;
 const {ss,qs,prod,safe,good,attention,better,trends,openDev,openTickets,devResolutionPct,ticketResolutionPct,products,trendDaily,finance,solvent,quality,liveSolventShifts,liveQualityShifts}=d;
 const trendPoints=(scope:'solventHealth'|'qualityHealth')=>(trendDaily||[]).filter((t:any)=>t[scope]!=null).map((t:any)=>({time:t.date,value:t[scope]}));
 // Section: the AI trend-signal text is often empty (it needs several
 // sequential inference runs to have anything to compare), so this
 // computes a real week-over-week reading directly from trendDaily rather
 // than leaving the panel blank — the same data backing the chart above,
 // just stated as a sentence.
 function weekOverWeek(scope:'solventHealth'|'qualityHealth',label:string){
  const pts=trendPoints(scope);if(pts.length<2)return null;
  const first=pts[0],last=pts[pts.length-1],delta=Math.round(Number(last.value)-Number(first.value));
  const dir=delta>0?'up':delta<0?'down':'flat';
  return `${label} health is ${dir}${delta!==0?` ${Math.abs(delta)} point${Math.abs(delta)===1?'':'s'}`:''} over the last ${pts.length} day${pts.length===1?'':'s'} (${first.value}% → ${last.value}%).`;
 }
 const weeklySignals=[weekOverWeek('solventHealth','Solvent'),weekOverWeek('qualityHealth','Quality')].filter(Boolean) as string[];

 return <><PageHeader title="Management" subtitle="" backHref="/" backLabel="Home" action={<span className="pill info">EXECUTIVE VIEW</span>}/>
 <PeriodFilter period={period} onChange={setPeriod} liveSessions={[...(liveSolventShifts||[]).map((shift:any)=>({scope:'solvent' as const,shift})),...(liveQualityShifts||[]).map((shift:any)=>({scope:'quality' as const,shift}))]} onStopped={()=>setRefreshKey(x=>x+1)}/>
 {error?<div className="session-error-banner" style={{marginBottom:14}}><b>Management dashboard data could not be loaded.</b><span>{error}</span></div>:null}
 <section className="dashboard-panel span-12" style={{marginTop:16}}>
  <button type="button" onClick={()=>setShowShift(x=>!x)} style={{all:'unset',cursor:'pointer',display:'flex',width:'100%',alignItems:'center',justifyContent:'space-between',gap:12}}>
   <div className="panel-heading" style={{marginBottom:0,flex:1}}><div><span>SHIFT CONTROL</span><h3>What's being entered right now, Solvent and Quality</h3></div><Radio size={20}/></div>
   <span className="pill info" style={{flexShrink:0}}>{(liveSolventShifts?.length||0)+(liveQualityShifts?.length||0)} live{showShift?<ChevronUp size={14} style={{marginLeft:6,verticalAlign:'-2px'}}/>:<ChevronDown size={14} style={{marginLeft:6,verticalAlign:'-2px'}}/>}</span>
  </button>
  {showShift?<>
   <p className="panel-muted" style={{margin:'10px 0'}}>Read-only — Management can see every live shift here but cannot stop one; that stays a Super Admin action.</p>
   <ShiftControlList canStop={false} canViewAs={false} canReassign={false} pollMs={30000}/>
  </>:null}
 </section>
 <div className="grid kpis modern-kpis" style={{marginTop:16}}><Kpi icon={Factory} tone="blue" label="Solvent Plant Health" value={ss?.health==null?'N/A':`${ss.health}%`} foot={`${ss?.warning||0} warning • ${ss?.critical||0} critical`}/><Kpi icon={TrendingUp} tone="green" label="Production Health" value={prod?.health==null?'N/A':`${prod.health}%`} foot={`${(prod?.normal||0)+(prod?.warning||0)+(prod?.critical||0)} process readings`}/><Kpi icon={ShieldAlert} tone="amber" label="Safety Health" value={safe?.health==null?'N/A':`${safe.health}%`} foot={`${(safe?.warning||0)+(safe?.critical||0)} attention readings`}/><Kpi icon={FlaskConical} tone="purple" label="Quality Health" value={qs?.health==null?'N/A':`${qs.health}%`} foot={`${qs?.warning||0} warning • ${qs?.critical||0} critical`}/></div>
 <div className="dashboard-canvas" style={{marginTop:16}}>
  <section className="dashboard-panel span-6"><div className="panel-heading"><div><span>SOLVENT</span><h3>Status mix</h3></div><Factory size={20}/></div><StatusBars normal={ss?.normal||0} warning={ss?.warning||0} critical={ss?.critical||0}/></section>
  <section className="dashboard-panel span-6"><div className="panel-heading"><div><span>QUALITY</span><h3>Status mix</h3></div><FlaskConical size={20}/></div><StatusBars normal={qs?.normal||0} warning={qs?.warning||0} critical={qs?.critical||0}/></section>
 </div>
 <div className="executive-intelligence-grid" style={{marginTop:16}}><Insight title="What went well" tone="good" items={good||[]}/><Insight title="What needs attention" tone="attention" items={attention||[]}/><Insight title="What could have been done better" tone="improve" items={better||[]}/></div>
 <section className="dashboard-panel span-12" style={{marginTop:16}}><div className="panel-heading"><div><span>TREND SIGNALS</span><h3>Evidence across recent inference</h3></div><TrendingUp size={20}/></div>{(weeklySignals.length||trends?.length)?<ul className="insight-list">{[...weeklySignals,...(trends||[])].slice(0,6).map((x:string,i:number)=><li key={i}>{x}</li>)}</ul>:<p className="panel-muted">Trend signals appear after enough sequential readings are available.</p>}</section>
 <OpsControlTowerSection date={period.date}/>
 <div className="dashboard-canvas" style={{marginTop:16}}>
  <section className="dashboard-panel span-7"><div className="panel-heading"><div><span>7-DAY TREND</span><h3>Plant health, day by day</h3></div><TrendingUp size={20}/></div><div className="ceo-trend-pair"><div><div className="panel-muted" style={{marginBottom:6}}>Solvent</div><TrendChart points={trendPoints('solventHealth')} height={140}/></div><div><div className="panel-muted" style={{marginBottom:6}}>Quality</div><TrendChart points={trendPoints('qualityHealth')} height={140}/></div></div></section>
  <section className="dashboard-panel span-5"><div className="panel-heading"><div><span>ACTION CONTROL</span><h3>Resolution rate</h3></div><TicketCheck size={20}/></div><div className="ceo-donut-pair"><Donut value={devResolutionPct??0} label="Deviations resolved"/><Donut value={ticketResolutionPct??0} label="Tickets resolved"/></div><div className="action-big" style={{marginTop:12}}><div><ShieldAlert/><span>Open deviations</span><b>{openDev||0}</b></div><div><TicketCheck/><span>Open tickets</span><b>{openTickets||0}</b></div></div><div style={{display:'flex',gap:14,marginTop:13,flexWrap:'wrap'}}><Link className="text-link" href="/solvent/tickets">Solvent ticket centre <ArrowRight size={15}/></Link><Link className="text-link" href="/quality/tickets">Quality ticket centre <ArrowRight size={15}/></Link></div></section>
  <section className="dashboard-panel span-6"><div className="panel-heading"><div><span>SOLVENT</span><h3>Plant health</h3></div><Factory size={20}/></div><div className="ceo-health-row"><div><span>Production</span><b>{prod?.health==null?'N/A':`${prod.health}%`}</b></div><div><span>Safety</span><b>{safe?.health==null?'N/A':`${safe.health}%`}</b></div><div><span>Shift</span><b>{solvent?.shift_master?.name||'—'}</b></div></div><Link className="text-link" href="/solvent">Open Solvent intelligence <ArrowRight size={15}/></Link></section>
  <section className="dashboard-panel span-6"><div className="panel-heading"><div><span>QUALITY</span><h3>Product quality</h3></div><FlaskConical size={20}/></div><div className="ceo-health-row"><div><span>Normal</span><b>{qs?.normal||0}</b></div><div><span>Attention</span><b>{(qs?.warning||0)+(qs?.critical||0)}</b></div><div><span>Shift</span><b>{quality?.shift_master?.name||'—'}</b></div></div><Link className="text-link" href="/quality">Open Quality intelligence <ArrowRight size={15}/></Link></section>
  <section className="dashboard-panel span-12"><div className="panel-heading"><div><span>PRODUCT COMPARISON</span><h3>Solvent vs Quality health, by product</h3></div><Factory size={20}/></div><div className="ceo-product-compare">{(products||[]).map((p:any)=><div className="ceo-product-row" key={p.code}><span>{p.name}</span><div className="ceo-product-bar"><label>Solvent</label><i><em style={{width:`${p.solventHealth??0}%`}}/></i><b>{p.solventHealth==null?'N/A':`${p.solventHealth}%`}</b></div><div className="ceo-product-bar"><label>Quality</label><i><em className="quality" style={{width:`${p.qualityHealth??0}%`}}/></i><b>{p.qualityHealth==null?'N/A':`${p.qualityHealth}%`}</b></div></div>)}</div></section>
  <section className="dashboard-panel span-12"><div className="panel-heading"><div><span>FINANCE CONTROL</span><h3>Latest reconciliation exceptions{finance?.latestTxnDate?` • as of ${finance.latestTxnDate}`:''}</h3></div><BadgeIndianRupee size={20}/></div><div className="ceo-health-row"><div><span>Physical awaiting ERP/Tally</span><b>{finance?.physicalReview||0}</b></div><div><span>Payments needing review</span><b>{finance?.paymentsReview||0}</b></div><div><span>Net payment variance</span><b>{typeof finance?.netVariance==='number'?`₹${Math.round(finance.netVariance).toLocaleString('en-IN')}`:'—'}</b></div></div><Link className="text-link" href="/finance">Open Finance control centre <ArrowRight size={15}/></Link></section>
 </div></>;
}
// Operations Daily Control Tower / ERP intelligence — additive, fed by its
// own endpoints (not the shared /api/ceo/dashboard call above) so it never
// changes what that route computes or how the rest of this page loads.
// Follows the same date filter as the rest of the page (`date` prop, the
// PeriodFilter's own selection) — the API falls back to the latest
// available summary at or before that date rather than showing nothing,
// same as every other "as of" figure here, and says so clearly when it
// does.
function OpsControlTowerSection({date}:{date:string}){
 const [summary,setSummary]=useState<any>(null),[loaded,setLoaded]=useState(false);
 const [fallbackInfo,setFallbackInfo]=useState<{requestedDate:string|null;isFallback:boolean}>({requestedDate:null,isFallback:false});
 const [values,setValues]=useState<{totalSalesValue:number;totalPurchaseValue:number}>({totalSalesValue:0,totalPurchaseValue:0});
 const [brief,setBrief]=useState<any>(null);
 const [showStory,setShowStory]=useState(false);
 const [supplyKpis,setSupplyKpis]=useState<any>(null);
 const [availability,setAvailability]=useState<any[]>([]);
 useEffect(()=>{
  setLoaded(false);
  const qs=date?`?date=${date}`:'';
  fetch(`/api/ops/dashboard${qs}`,{cache:'no-store'}).then(r=>r.ok?r.json():{summary:null}).then(j=>{setSummary(j.summary||null);setFallbackInfo({requestedDate:j.requestedDate||null,isFallback:!!j.isFallback});setValues({totalSalesValue:j.totalSalesValue||0,totalPurchaseValue:j.totalPurchaseValue||0})}).catch(()=>{}).finally(()=>setLoaded(true));
  fetch('/api/ops/brief',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>setBrief(j?.brief||null)).catch(()=>{});
  fetch('/api/ops/supply/dashboard',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>setSupplyKpis(j?.kpis||null)).catch(()=>{});
  fetch('/api/ops/reconciliation/sales',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>setAvailability(j?.availability||[])).catch(()=>{});
 },[date]);
 if(!loaded)return null;
 if(!summary)return <section className="dashboard-panel span-12" style={{marginTop:16}}><div className="panel-heading"><div><span>ERP / OPERATIONS INTELLIGENCE</span><h3>No Operations data uploaded yet</h3></div><Boxes size={20}/></div><p className="panel-muted">Upload Feeding, Production, Stock Summary and other Operations reports to populate this section.</p><Link className="text-link" href="/operations/upload">Open Operations Data Hub <ArrowRight size={15}/></Link></section>;
 const totalFreeToSell=availability.reduce((s,a)=>s+a.freeToSellMt,0);
 const negativeAvailability=availability.filter(a=>a.freeToSellMt<0).length;
 const erp=buildErpInsight(summary,supplyKpis,availability,negativeAvailability,totalFreeToSell);
 return <><div className="executive-intelligence-grid" style={{marginTop:16}}><Insight title="ERP: what went well" tone="good" items={erp.good}/><Insight title="ERP: what needs attention" tone="attention" items={erp.attention}/><Insight title="ERP: what could have been done better" tone="improve" items={erp.better}/></div>
 <section className="dashboard-panel span-12" style={{marginTop:16}}>
  <div className="panel-heading"><div><span>OPERATIONS DAILY CONTROL TOWER</span><h3>Data as of {summary.report_date}</h3></div><Boxes size={20}/></div>
  {fallbackInfo.isFallback?<div className="notice warn" style={{marginBottom:12}}>No Operations upload for {fallbackInfo.requestedDate} yet — showing the most recent available data ({summary.report_date}).</div>:null}

  {brief?<div className="ops-brief" style={{margin:'10px 0 14px',padding:'12px 14px',borderRadius:12,background:'var(--panel-soft,#f6f8fb)',border:'1px solid var(--border,#e2e8f0)'}}>
   <button type="button" onClick={()=>setShowStory(x=>!x)} style={{all:'unset',cursor:'pointer',display:'flex',width:'100%',alignItems:'center',justifyContent:'space-between',gap:10}}>
    <span style={{display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:600,color:'#5b6b82'}}><Sparkles size={14}/>TODAY'S OPERATIONS STORY — Uruv.ai</span>
    {showStory?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
   </button>
   <p style={{margin:'6px 0 0'}}>{brief.summary}</p>
   {showStory?<>
    {brief.productionSummary||brief.inventorySummary||brief.supplySummary||brief.salesSummary?<div className="ceo-health-row" style={{marginTop:10}}>
     {brief.productionSummary?<div><span>Production</span><p style={{margin:0,fontSize:12}}>{brief.productionSummary}</p></div>:null}
     {brief.inventorySummary?<div><span>Inventory</span><p style={{margin:0,fontSize:12}}>{brief.inventorySummary}</p></div>:null}
     {brief.supplySummary?<div><span>Supply</span><p style={{margin:0,fontSize:12}}>{brief.supplySummary}</p></div>:null}
     {brief.salesSummary?<div><span>Sales</span><p style={{margin:0,fontSize:12}}>{brief.salesSummary}</p></div>:null}
    </div>:null}
    {brief.risks?.length?<div style={{marginTop:10}}><div className="panel-muted" style={{marginBottom:4}}>At risk</div><ul className="insight-list">{brief.risks.slice(0,4).map((r:string,i:number)=><li key={i}>{r}</li>)}</ul></div>:null}
    {brief.actionsRequired?.length?<div style={{marginTop:10}}><div className="panel-muted" style={{marginBottom:4}}>Needs action today</div><ul className="insight-list">{brief.actionsRequired.slice(0,4).map((r:string,i:number)=><li key={i}>{r}</li>)}</ul></div>:null}
   </>:null}
  </div>:null}

  <div className="ceo-health-row" style={{gridTemplateColumns:'repeat(3,minmax(0,1fr))'}}>
   <div><span>Feeding</span><b>{Number(summary.feeding_total_weight_mt||0).toFixed(1)} MT</b></div>
   <div><span>Production</span><b>{Number(summary.production_total_qty_mt||0).toFixed(1)} MT</b></div>
   <div><span>Production ↔ Stock variance</span><b>{Number(summary.production_stock_variance_mt||0).toFixed(1)} MT</b></div>
   <div><span>Stock closing value</span><b>₹{Math.round(Number(summary.stock_closing_value||0)).toLocaleString('en-IN')}</b></div>
   <div><span>Total Sales Value</span><b>₹{Math.round(values.totalSalesValue).toLocaleString('en-IN')}</b></div>
   <div><span>Total Purchase Value</span><b>₹{Math.round(values.totalPurchaseValue).toLocaleString('en-IN')}</b></div>
  </div>
  <div className="action-big" style={{marginTop:12}}>
   <div><CircleAlert/><span>Open exceptions</span><b>{summary.open_exceptions_count||0}</b></div>
   <div><TriangleAlert/><span>Critical</span><b>{summary.critical_exceptions_count||0}</b></div>
   <div><TicketCheck/><span>Open Operations tickets</span><b>{summary.open_erp_tickets_count||0}</b></div>
  </div>
  {summary.topVariance?.length?<div style={{marginTop:12}}><div className="panel-muted" style={{marginBottom:6}}>Largest variances</div><ul className="insight-list">{summary.topVariance.slice(0,5).map((v:any,i:number)=><li key={i}>{v.productName}: {Number(v.variance).toFixed(2)} MT</li>)}</ul></div>:null}

  {supplyKpis?<div className="dashboard-canvas" style={{marginTop:14}}>
   <section className="dashboard-panel span-6"><div className="panel-heading"><div><span>SUPPLY</span><h3>Open purchase orders</h3></div><Truck size={18}/></div><div className="ceo-health-row"><div><span>Open POs</span><b>{supplyKpis.openPoCount}</b></div><div><span>Pending qty</span><b>{Number(supplyKpis.totalPendingQty).toFixed(1)} MT</b></div><div><span>Awaiting weighment</span><b>{supplyKpis.vehiclesAwaitingWeighment}</b></div><div><span>Lots in progress</span><b>{supplyKpis.lotsInProgress}</b></div></div><Link className="text-link" href="/operations/supply">Open Supply Intelligence <ArrowRight size={15}/></Link></section>
   <section className="dashboard-panel span-6"><div className="panel-heading"><div><span>SALES</span><h3>Free to Sell</h3></div><ShoppingCart size={18}/></div><div className="ceo-health-row"><div><span>Products tracked</span><b>{availability.length}</b></div><div><span>Total free to sell</span><b>{totalFreeToSell.toFixed(1)} MT</b></div><div><span>Over-committed</span><b>{negativeAvailability}</b></div></div><Link className="text-link" href="/operations/sales">Open Sales &amp; Fulfilment <ArrowRight size={15}/></Link></section>
  </div>:null}

  <div style={{display:'flex',gap:14,marginTop:13,flexWrap:'wrap'}}><Link className="text-link" href="/operations/exceptions">Operations exceptions <ArrowRight size={15}/></Link><Link className="text-link" href="/operations/reconciliation">Reconciliation <ArrowRight size={15}/></Link></div>
 </section></>;
}
// Deterministic — every statement traces directly to a number already
// fetched for this section, same discipline as the AI Insight fallbacks
// elsewhere (lib/aix3/pageInsight.ts): never invented, never speculative.
function buildErpInsight(summary:any,supplyKpis:any,availability:any[],negativeAvailability:number,totalFreeToSell:number){
 const good:string[]=[],attention:string[]=[],better:string[]=[];
 const openExceptions=summary.open_exceptions_count||0,critical=summary.critical_exceptions_count||0;
 const variance=Number(summary.production_stock_variance_mt||0),openTickets=summary.open_erp_tickets_count||0;
 if(!openExceptions)good.push('No open Operations exceptions.');else attention.push(`${openExceptions} open Operations exception${openExceptions===1?'':'s'}${critical?`, ${critical} critical`:''}.`);
 if(Math.abs(variance)<0.5)good.push(`Production ↔ Stock variance is tight (${variance.toFixed(1)} MT).`);else better.push(`Production ↔ Stock variance is ${variance.toFixed(1)} MT — review the largest contributing product${summary.topVariance?.length?` (${summary.topVariance[0].productName})`:''}.`);
 if(openTickets)attention.push(`${openTickets} open Operations ticket${openTickets===1?'':'s'} still unresolved.`);
 if(supplyKpis){
  if(!supplyKpis.vehiclesAwaitingWeighment)good.push('No vehicles waiting on a weighment.');else attention.push(`${supplyKpis.vehiclesAwaitingWeighment} vehicle${supplyKpis.vehiclesAwaitingWeighment===1?'':'s'} at the gate still awaiting weighment.`);
  if(supplyKpis.openPoCount)better.push(`${supplyKpis.openPoCount} purchase order${supplyKpis.openPoCount===1?'':'s'} still open, ${Number(supplyKpis.totalPendingQty||0).toFixed(1)} MT pending.`);
 }
 if(availability.length){
  if(!negativeAvailability)good.push(`All ${availability.length} tracked product(s) have Free to Sell stock available.`);else attention.push(`${negativeAvailability} product${negativeAvailability===1?'':'s'} over-committed — Free to Sell is negative.`);
  if(totalFreeToSell>0)good.push(`${totalFreeToSell.toFixed(1)} MT free to sell across finished goods.`);
 }
 return {good,attention,better};
}
const insightIcon:Record<string,any>={good:CheckCircle2,attention:TriangleAlert,improve:Lightbulb};
function Insight({title,tone,items}:{title:string;tone:string;items:string[]}){const Icon=insightIcon[tone]||CheckCircle2;return <section className={`executive-card ${tone}`}><div className="section-title"><span className="exec-icon"><Icon size={16}/></span>{title}</div>{items.length?<ul>{items.slice(0,7).map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className="muted">No evidence-backed statement is available yet.</p>}</section>}
