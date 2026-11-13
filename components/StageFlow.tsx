import {CheckCircle2,AlertTriangle,Flame} from 'lucide-react';

// The plant as a row of stages: each process section of the dashboard with its worst condition and its most relevant readings.
// Built only from the dashboard's own `metrics` (section, name, latest, unit, critical, warning) — no extra data source.
type M={section?:string;group?:string;warnings?:boolean;name?:string;latest?:number|string|null;unit?:string;critical?:boolean;warning?:boolean};

export function StageFlow({metrics,label='Process stages'}:{metrics:M[];label?:string}){
 const order:string[]=[];const by=new Map<string,M[]>();
 for(const m of metrics){const k=(m.section||m.group||'Other').trim()||'Other';if(!by.has(k)){by.set(k,[]);order.push(k)}by.get(k)!.push(m)}
 if(!order.length)return null;
 return <section className="stage-flow-wrap" aria-label={label}>
  <div className="stage-flow-label">{label}</div>
  <div className="stage-flow">{order.map((k,i)=>{
   const list=by.get(k)!;const bad=list.filter(m=>m.critical),warn=list.filter(m=>!m.critical&&(m.warning||m.warnings));
   const tone=bad.length?'danger':warn.length?'warn':'ok';
   const shown=[...bad,...warn,...list.filter(m=>!m.critical&&!m.warning)].slice(0,3);
   const Icon=tone==='danger'?Flame:tone==='warn'?AlertTriangle:CheckCircle2;
   return <div className="stage-flow-item" key={k}>
    <div className={`stage-card stage-${tone}`}>
     <div className="stage-head"><b>{k}</b><span className={`pill ${tone==='ok'?'ok':tone==='warn'?'warn':'danger'}`}><Icon size={12}/>{tone==='danger'?'Alert':tone==='warn'?'Watch':'OK'}</span></div>
     {shown.map((m,j)=><div className="stage-row" key={j}><span>{m.name}</span><b className={m.critical?'t-bad':m.warning?'t-warn':''}>{m.latest==null||m.latest===''?'—':String(m.latest)}{m.unit?` ${m.unit}`:''}</b></div>)}
     {list.length>shown.length?<div className="stage-more">+{list.length-shown.length} more reading{list.length-shown.length===1?'':'s'}</div>:null}
    </div>
    {i<order.length-1?<span className="stage-arrow" aria-hidden="true">›</span>:null}
   </div>;
  })}</div>
 </section>;
}
