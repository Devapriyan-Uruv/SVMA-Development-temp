'use client';
import {useEffect,useState} from 'react';
import {Sparkles,CheckCircle2,AlertTriangle,Wallet,Ship} from 'lucide-react';

type WentWell={module:'import'|'export';refCode:string;party:string;text:string};
type Flag={id:string;module:'import'|'export';refCode:string;party:string;issue:string;nextBestAction:string;daysMetric:number|null};
type Insights={whatWentWell:WentWell[];needsAttention:Flag[];paymentPending:Flag[];shipmentPending:Flag[];narrative:string|null};

// The CEO/Management/Super Admin intelligence panel — "what went well,
// who needs attention, where's payment pending, where's shipment
// pending, next best action for each" — read straight off
// GET /api/trade/insights. filterModule scopes the panel to just Import
// or just Export when embedded on that module's own page; omit it for a
// combined view.
export function TradeInsights({filterModule,linkBase}:{filterModule?:'import'|'export';linkBase:(module:'import'|'export',id:string)=>string}){
 const [data,setData]=useState<Insights|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  fetch('/api/trade/insights',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.error)setError(j.error);else setData(j)}).catch(()=>setError('Unable to load insights'));
 },[]);
 if(error)return null;
 if(!data)return <div className="card"><div className="empty">Loading intelligence…</div></div>;
 const wentWell=filterModule?data.whatWentWell.filter(w=>w.module===filterModule):data.whatWentWell;
 const attention=filterModule?data.needsAttention.filter(w=>w.module===filterModule):data.needsAttention;
 const payment=filterModule?data.paymentPending.filter(w=>w.module===filterModule):data.paymentPending;
 const shipment=filterModule?data.shipmentPending.filter(w=>w.module===filterModule):data.shipmentPending;
 const nothingFlagged=!wentWell.length&&!attention.length&&!payment.length&&!shipment.length;
 return <div className="card" style={{marginBottom:16}}>
  <div className="section-title"><Sparkles size={15} style={{verticalAlign:-2,marginRight:5}}/>Trade Intelligence</div>
  {data.narrative?<p className="sub" style={{marginTop:8,lineHeight:1.5}}>{data.narrative}</p>:null}
  {nothingFlagged?<p className="sub" style={{marginTop:10}}>Nothing needs attention right now.</p>:<div className="grid two" style={{marginTop:12,gap:14}}>
   <InsightList icon={<CheckCircle2 size={14}/>} tone="ok" title="What went well" items={wentWell.map(w=><span key={w.refCode}>{w.text}</span>)}/>
   <InsightList icon={<AlertTriangle size={14}/>} tone="danger" title="Needs attention" items={attention.map(f=><FlagRow key={f.id} f={f} href={linkBase(f.module,f.id)}/>)}/>
   <InsightList icon={<Wallet size={14}/>} tone="warn" title="Payment pending" items={payment.map(f=><FlagRow key={f.id} f={f} href={linkBase(f.module,f.id)}/>)}/>
   <InsightList icon={<Ship size={14}/>} tone="info" title="Shipment pending" items={shipment.map(f=><FlagRow key={f.id} f={f} href={linkBase(f.module,f.id)}/>)}/>
  </div>}
 </div>;
}

function InsightList({icon,tone,title,items}:{icon:React.ReactNode;tone:string;title:string;items:React.ReactNode[]}){
 if(!items.length)return null;
 return <div>
  <div className="split-header"><b style={{fontSize:12.5}}>{icon} {title}</b><span className={`pill ${tone}`}>{items.length}</span></div>
  <ul style={{marginTop:8,paddingLeft:18,display:'grid',gap:6}}>{items.map((it,i)=><li key={i} style={{fontSize:12.5,lineHeight:1.4}}>{it}</li>)}</ul>
 </div>;
}
function FlagRow({f,href}:{f:Flag;href:string}){
 return <a href={href} style={{display:'block',color:'inherit'}}>
  <b>{f.refCode}</b> — {f.party}: {f.issue}
  <div className="sub" style={{marginTop:2}}>Next: {f.nextBestAction}</div>
 </a>;
}
