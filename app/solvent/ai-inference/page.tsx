'use client';
import {useEffect,useMemo,useState} from 'react';
import {BrainCircuit,CircleCheckBig,CircleGauge,Lightbulb,ShieldAlert,Sparkles,TrendingUp} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {productName,type ProductCode} from '@/lib/products';

const sections=[
 ['whatWentWell','What went well',CircleCheckBig,'good'],['needsAttention','What needs attention',ShieldAlert,'attention'],['canBeDoneBetter','What can be done better',Lightbulb,'improve'],['productionInsights','Production insights',CircleGauge,'production'],['safetyInsights','Safety insights',ShieldAlert,'safety'],['trendSignals','Trend signals',TrendingUp,'trend'],['managementActions','Management actions',Sparkles,'action'],
] as const;

export default function InferencePage(){
 const [reports,setReports]=useState<any[]>([]);const [session,setSession]=useState<any>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [product,setProduct]=useState<'ALL'|ProductCode>('ALL');
 const load=()=>Promise.all([fetch('/api/reports',{cache:'no-store'}).then(r=>r.json()),fetch('/api/shift/session',{cache:'no-store'}).then(r=>r.json())]).then(([r,s])=>{setReports(r.reports||[]);setSession(s.session||null)}).catch(()=>{});
 useEffect(()=>{void load()},[]);
 const products=(session?.active_products||[]) as ProductCode[];
 useEffect(()=>{if(product!=='ALL'&&!products.includes(product))setProduct('ALL')},[products.join('|')]);
 const latest=useMemo(()=>reports.find(r=>product==='ALL'||(r.input_refs||[]).includes(product))||reports[0]||null,[reports,product]);
 async function generate(){if(!session){setMessage('No active Solvent shift is available to generate a new inference.');return}setBusy(true);setMessage('');try{const r=await fetch('/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shiftSessionId:session.id,reportType:'shift',operationalDate:session.operational_date,productCode:product==='ALL'?undefined:product})});const j=await r.json();if(!r.ok)throw new Error(j.error);await load()}catch(e){setMessage(e instanceof Error?e.message:'Unable to generate inference')}finally{setBusy(false)}}
 const report=latest?.report||{};
 return <><PageHeader title="Solvent AIX3 Insight" subtitle="Management-ready interpretation built from validated production and safety data" backHref="/solvent" backLabel="Solvent Production & Safety" action={<div className="action-row inference-filters"><select value={product} onChange={e=>setProduct(e.target.value as 'ALL'|ProductCode)}><option value="ALL">All running products</option>{products.map(code=><option value={code} key={code}>{productName(code)}</option>)}</select><button className="btn btn-primary" disabled={busy||!session} onClick={generate}><BrainCircuit size={17}/>{busy?'Analysing…':'Refresh AIX3 Insight'}</button></div>}/>{message?<div className="notice warn" style={{marginBottom:14}}>{message}</div>:null}
 <section className="inference-head"><div><span className="eyebrow">LATEST URUV.AI OPERATIONAL INSIGHT {product!=='ALL'?`• ${productName(product).toUpperCase()}`:''}</span><h2>{latest?`${String(latest.report_type).replaceAll('_',' ').toUpperCase()} • ${latest.operational_date}`:'No AIX3 insight generated yet'}</h2><p>{latest?`Generated ${new Date(latest.created_at).toLocaleString()}. Based on your submitted readings and operating history.`:'Submit parameter and safety readings during a shift to create the first AIX3 operational insight.'}</p></div><div className="inference-mark"><BrainCircuit size={30}/></div></section>
 {latest?<div className="inference-grid" style={{marginTop:16}}>{sections.map(([key,title,Icon,tone])=><InferenceCard key={key} title={title} Icon={Icon} tone={tone} values={Array.isArray(report[key])?report[key]:[]}/>)}</div>:<div className="card empty" style={{marginTop:16}}>No inference is available yet.</div>}
 {reports.length>1?<div className="card" style={{marginTop:16}}><div className="section-title">Recent inference timeline</div><div className="timeline-list">{reports.slice(0,8).map(r=><div className="timeline-item" key={r.id}><span className="status-dot info"/><div><b>{String(r.report_type).replaceAll('_',' ')}</b><span>{r.operational_date} • {new Date(r.created_at).toLocaleTimeString()}</span></div></div>)}</div></div>:null}</>;
}
// Each card starts collapsed to its first 3 evidence-backed statements — a
// full inference can carry 7-12 sentences a section, which was the "too
// much wording, hard to read" complaint; the rest is one click away, never
// dropped.
function InferenceCard({title,Icon,tone,values}:{title:string;Icon:any;tone:string;values:any[]}){
 const [open,setOpen]=useState(false);
 const shown=open?values:values.slice(0,3);
 return <section className={`inference-card tone-${tone}`}>
  <div className="inference-title"><Icon size={19}/><h3>{title}</h3></div>
  {values.length?<ul>{shown.map((x:any,i:number)=><li key={i}>{String(x)}</li>)}</ul>:<p className="muted">No evidence-based item for this section.</p>}
  {values.length>3?<button type="button" className="text-link" style={{marginTop:6}} onClick={()=>setOpen(x=>!x)}>{open?'Show less':`Show ${values.length-3} more`}</button>:null}
 </section>;
}
