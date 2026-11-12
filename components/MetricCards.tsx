import {targetBounds} from '@/lib/metrics';

// Each key parameter as its own card: latest value, a state tag, a small trend line and its limits. Built only from the dashboard's `metrics`
// (name, latest, unit, target, critical, warning/warnings, average, points).
type P={value?:number|string|null};
type M={key?:string;name?:string;group?:string;section?:string;latest?:number|string|null;unit?:string;target?:string|null;critical?:boolean;warning?:boolean;warnings?:boolean;average?:number|string|null;points?:P[]};
const num=(v:unknown)=>{const n=Number(v);return v!==null&&v!==''&&v!==undefined&&Number.isFinite(n)?n:null};

function Spark({points,low,high,tone}:{points:number[];low:number|null;high:number|null;tone:string}){
 const W=300,H=70,vals=[...points,...(low!=null?[low]:[]),...(high!=null?[high]:[])];
 const mn=Math.min(...vals),mx=Math.max(...vals),span=mx-mn||1,y=(v:number)=>H-6-((v-mn)/span)*(H-12),x=(i:number)=>points.length>1?(i/(points.length-1))*(W-8)+4:W/2;
 const band=low!=null||high!=null?{top:y(high??mx),bot:y(low??mn)}:null;
 return <svg className={`mc-spark t-${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
  {band?<rect x="0" y={Math.min(band.top,band.bot)} width={W} height={Math.max(2,Math.abs(band.bot-band.top))} className="mc-band"/>:null}
  <polyline fill="none" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" points={points.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}/>
  <circle cx={x(points.length-1)} cy={y(points[points.length-1])} r="4" className="mc-dot"/>
 </svg>;
}

export function MetricCards({metrics,limit=6}:{metrics:M[];limit?:number}){
 const rows=metrics.map(m=>{const pts=(m.points||[]).map(p=>num(p.value)).filter((v):v is number=>v!=null);return {m,pts,v:num(m.latest)}}).filter(r=>r.v!=null&&r.pts.length>1)
  .sort((a,b)=>Number(!!b.m.critical)-Number(!!a.m.critical)||Number(!!(b.m.warning||b.m.warnings))-Number(!!(a.m.warning||a.m.warnings))).slice(0,limit);
 if(!rows.length)return null;
 return <div className="mc-grid">{rows.map((r,i)=>{
  const b=targetBounds(r.m.target),tone=r.m.critical?'bad':(r.m.warning||r.m.warnings)?'warn':'ok';
  return <div className={`mc-card mc-${tone}`} key={(r.m.key||'')+i}>
   <div className="mc-top"><span className="mc-idx">{i+1}</span><span className="mc-name"><b>{r.m.name}</b><small>{r.m.group||r.m.section||''}</small></span><span className={`tag-${tone} mc-tag`}>{tone==='bad'?'Outside limit':tone==='warn'?'Watch':'In range'}</span></div>
   <div className="mc-val num">{r.v}<small>{r.m.unit?` ${r.m.unit}`:''}</small></div>
   <Spark points={r.pts} low={b.low} high={b.high} tone={tone}/>
   <div className="mc-foot num"><span>{r.m.target?`Target ${r.m.target}`:'No target'}</span><span>Avg {r.m.average==null||r.m.average===''?'—':Number(r.m.average).toFixed(1)}</span><span>Min {Math.min(...r.pts)}</span><span>Max {Math.max(...r.pts)}</span></div>
  </div>})}</div>;
}
