'use client';
import {useEffect,useMemo,useState} from 'react';
import {BrainCircuit,CheckCircle2,Lightbulb,TriangleAlert,TrendingUp} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {productName,type ProductCode} from '@/lib/products';

export default function QualityInference(){
 const [reports,setReports]=useState<any[]>([]),[shifts,setShifts]=useState<any[]>([]),[shift,setShift]=useState(''),[product,setProduct]=useState<'ALL'|ProductCode>('ALL'),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const load=()=>Promise.all([fetch('/api/reports?scope=quality',{cache:'no-store'}).then(r=>r.json()),fetch('/api/shift/history?scope=quality',{cache:'no-store'}).then(r=>r.json())]).then(([a,b])=>{setReports(a.reports||[]);setShifts(b.shifts||[]);if(!shift&&b.shifts?.[0])setShift(b.shifts[0].id)});
 useEffect(()=>{void load()},[]);
 const selectedShift=useMemo(()=>shifts.find(x=>x.id===shift),[shifts,shift]);
 const products=(selectedShift?.active_products||[]) as ProductCode[];
 useEffect(()=>{if(product!=='ALL'&&!products.includes(product))setProduct('ALL')},[shift,products.join('|')]);
 async function generate(){if(!shift)return;setBusy(true);setMsg('');const s=selectedShift,r=await fetch('/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:'quality',shiftSessionId:shift,reportType:'quality_shift',operationalDate:s?.operational_date,productCode:product==='ALL'?undefined:product})}),j=await r.json();if(!r.ok)setMsg(j.error||'Inference failed');else await load();setBusy(false)}
 const latest=reports.find(r=>product==='ALL'||(r.input_refs||[]).includes(product))||reports[0],report=latest?.report;
 return <><PageHeader title="Quality Uruv.ai Insight" subtitle="Evidence-based interpretation of validated Lab results, product by product or across the completed shift" backHref="/quality" backLabel="Quality" action={<div className="action-row inference-filters"><select value={shift} onChange={e=>setShift(e.target.value)}><option value="">Select completed shift</option>{shifts.map(s=><option value={s.id} key={s.id}>{s.operational_date} • {s.shift_master?.name}</option>)}</select><select value={product} onChange={e=>setProduct(e.target.value as 'ALL'|ProductCode)}><option value="ALL">All running products</option>{products.map(code=><option value={code} key={code}>{productName(code)}</option>)}</select><button className="btn btn-primary" disabled={!shift||busy} onClick={generate}>{busy?'Analysing…':'Generate Uruv.ai Insight'}</button></div>}/>{msg?<div className="notice danger">{msg}</div>:null}{report?<><div className="inference-head quality-inference"><div><span className="eyebrow">LATEST URUV.AI QUALITY INSIGHT {product!=='ALL'?`• ${productName(product).toUpperCase()}`:''}</span><h2>{latest.operational_date}</h2><p>Observed facts remain separate from recommendations. Uruv.ai does not change targets or invent a lab result.</p></div><div className="inference-mark"><BrainCircuit/></div></div><div className="inference-grid" style={{marginTop:16}}><Box icon={<CheckCircle2/>} title="What went well" tone="good" rows={report.whatWentWell}/><Box icon={<TriangleAlert/>} title="Needs attention" tone="attention" rows={report.needsAttention}/><Box icon={<Lightbulb/>} title="What can be done better" tone="improve" rows={report.canBeDoneBetter}/><Box icon={<TrendingUp/>} title="Trend signals" tone="trend" rows={report.trendSignals}/><Box icon={<BrainCircuit/>} title="Management actions" tone="action" rows={report.managementActions}/></div></>:<div className="card empty">No AIX3 quality insight has been generated yet. Complete a Quality shift, then generate its inference here.</div>}</>;
}
// Starts collapsed to the first 3 statements — a full inference can carry
// 7-12 sentences a section ("too much wording, hard to read"); the rest is
// one click away, never dropped.
function Box({icon,title,tone,rows}:{icon:any;title:string;tone:string;rows:any[]}){
 const [open,setOpen]=useState(false);
 const values=rows||[],shown=open?values:values.slice(0,3);
 return <section className={`inference-card tone-${tone}`}>
  <div className="inference-title">{icon}<h3>{title}</h3></div>
  <ul>{values.length?shown.map((x:string,i:number)=><li key={i}>{x}</li>):<li>No supported observation for this category.</li>}</ul>
  {values.length>3?<button type="button" className="text-link" style={{marginTop:6}} onClick={()=>setOpen(x=>!x)}>{open?'Show less':`Show ${values.length-3} more`}</button>:null}
 </section>;
}
