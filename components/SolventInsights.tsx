import {AlertTriangle,Gauge} from 'lucide-react';
import {targetBounds} from '@/lib/metrics';

// Dashboard blocks built only from the dashboard's own `metrics` (name, section, latest, unit, target, critical, warning):
//   CriticalBanner — what is over its limit right now
//   LimitsPanel    — how close the key readings are to their limits (bars)
//   BoilerGauges   — boiler / steam / utility readings as dials
type M={key?:string;name?:string;section?:string;group?:string;warnings?:boolean;latest?:number|string|null;unit?:string;target?:string|null;critical?:boolean;warning?:boolean};
const num=(v:unknown)=>{const n=Number(v);return v!==null&&v!==''&&Number.isFinite(n)?n:null};
const tone=(m:M)=>m.critical?'bad':(m.warning||m.warnings)?'warn':'ok';

export function CriticalBanner({metrics}:{metrics:M[]}){
 const bad=metrics.filter(m=>m.critical);
 if(!bad.length)return null;
 return <div className="v3-banner bad" role="alert"><AlertTriangle size={20}/><div><b>{bad.length===1?'1 reading is outside its limit':`${bad.length} readings are outside their limit`}</b><span>{bad.slice(0,3).map(m=>`${(m.section||m.group)?`${m.section||m.group}: `:''}${m.name} ${m.latest}${m.unit?` ${m.unit}`:''}${m.target?` (target ${m.target})`:''}`).join(' · ')}{bad.length>3?` · +${bad.length-3} more`:''}</span></div></div>;
}

export function LimitsPanel({metrics}:{metrics:M[]}){
 const rows=metrics.map(m=>{const v=num(m.latest),b=targetBounds(m.target);return {m,v,high:b.high}}).filter(r=>r.v!=null&&r.high!=null&&(r.high as number)>0)
  .map(r=>({...r,ratio:(r.v as number)/(r.high as number)}))
  .sort((a,b)=>Number(!!b.m.critical)-Number(!!a.m.critical)||Number(!!b.m.warning)-Number(!!a.m.warning)||b.ratio-a.ratio).slice(0,5);
 if(!rows.length)return null;
 return <section className="dashboard-panel span-5"><div className="panel-heading"><div><span>AGAINST THE LIMIT</span><h3>Key readings</h3></div></div>
  <div className="limit-list">{rows.map((r,i)=><div key={(r.m.key||'')+i}><div className="limit-top"><b>{r.m.name}</b><span className={`num t-${r.m.critical?'bad':r.m.warning?'warn':'ok'}`}>{r.v} / {r.high}{r.m.unit?` ${r.m.unit}`:''}</span></div><div className={`bar ${tone(r.m)}`}><i style={{width:`${Math.min(100,Math.max(3,r.ratio*100))}%`}}/></div></div>)}</div></section>;
}

export const isBoilerMetric=(m:M)=>/boiler|steam|utilit|feed ?water/i.test(`${m.section||''} ${m.name||''}`);
export function BoilerGauges({metrics,limit=4,bare=false}:{metrics:M[];limit?:number;bare?:boolean}){
 const dials=metrics.filter(isBoilerMetric).map(m=>{const v=num(m.latest),b=targetBounds(m.target);return {m,v,b}}).filter(r=>r.v!=null).slice(0,limit);
 if(!dials.length)return null;
 const grid=<div className="gauge-grid">{dials.map((r,i)=>{
   const top=r.b.high??(r.b.low!=null?r.b.low*2:Math.max(1,Math.abs(r.v as number)*1.6)),frac=Math.min(1,Math.max(0,Math.abs(r.v as number)/(top*1.15||1))),len=Math.PI*80;
   const t=tone(r.m);
   return <div className="gauge" key={(r.m.key||'')+i}>
    <svg viewBox="0 0 200 118" role="img" aria-label={`${r.m.name} ${r.v}${r.m.unit?` ${r.m.unit}`:''}`}><path d="M20 100a80 80 0 0 1 160 0" className="gauge-bg"/><path d="M20 100a80 80 0 0 1 160 0" className={`gauge-fill g-${t}`} strokeDasharray={`${frac*len} ${len}`}/></svg>
    <div className="gauge-val num">{r.v}<small>{r.m.unit?` ${r.m.unit}`:''}</small></div>
    <div className={`gauge-state t-${t}`}>{t==='bad'?'Outside limit':t==='warn'?'Watch':'Normal'}</div>
    <div className="gauge-name">{r.m.name}{r.m.target?<span> · target {r.m.target}</span>:null}</div>
   </div>;})}</div>;
 return bare?grid:<section className="dashboard-panel span-12"><div className="panel-heading"><div><span>UTILITIES</span><h3>Boiler and steam</h3></div><Gauge size={20}/></div>{grid}</section>;
}
