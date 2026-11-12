import Link from 'next/link';
import {ArrowRight,ShieldAlert,TicketCheck} from 'lucide-react';

// The Management page's graphs: every one is drawn from numbers the page already loads (/api/ceo/dashboard) — nothing is estimated or filled in.
// Missing values are left as gaps / "N/A", never zero.
const SOLVENT='#0A6CE0',QUALITY='#7A3FA1';
const nz=(v:any)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const dm=(ymd:string)=>{const d=new Date(ymd+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})};

export function HealthTrend({days}:{days:{date:string;solventHealth:number|null;qualityHealth:number|null}[]}){
 const W=640,H=230,L=38,R=24,T=16,B=30;
 const vals=days.flatMap(d=>[d.solventHealth,d.qualityHealth]).filter(nz).map(Number);
 if(!vals.length)return <p className="panel-muted">Health appears here once readings are submitted on more than one day.</p>;
 const lo=Math.max(0,Math.floor((Math.min(...vals)-8)/10)*10),hi=100,x=(i:number)=>L+(days.length>1?i/(days.length-1):0.5)*(W-L-R),y=(v:number)=>T+(1-(v-lo)/(hi-lo))*(H-T-B);
 const ticks:number[]=[];for(let v=lo;v<=hi;v+=(hi-lo>50?25:10))ticks.push(v);if(ticks[ticks.length-1]!==hi)ticks.push(hi);
 const series=[{key:'solventHealth',name:'Solvent',color:SOLVENT},{key:'qualityHealth',name:'Quality',color:QUALITY}] as const;
 return <div className="cc-trend">
  <div className="cc-legend">{series.map(s=>{const last=[...days].reverse().find(d=>nz((d as any)[s.key]));return <span key={s.key}><i style={{background:s.color}}/>{s.name}<b className="num">{last?`${(last as any)[s.key]}%`:'N/A'}</b></span>})}</div>
  <svg viewBox={`0 0 ${W} ${H}`} className="cc-svg" role="img" aria-label="Solvent and Quality health, day by day">
   {ticks.map(t=><g key={t}><line x1={L} x2={W-R} y1={y(t)} y2={y(t)} stroke="#E2E7EE"/><text x={L-8} y={y(t)+4} textAnchor="end" fontSize="11" fill="#5B6B80" fontFamily="JetBrains Mono, monospace">{t}</text></g>)}
   <rect x={L} y={y(100)} width={W-L-R} height={y(90)-y(100)} fill="#E3F5EA" opacity=".55"/>
   {series.map(s=>{
    const pts=days.map((d,i)=>({i,v:(d as any)[s.key]})).filter(p=>nz(p.v));
    // a line is drawn only across consecutive days that both have a value
    const segs:{i:number;v:number}[][]=[];let cur:{i:number;v:number}[]=[];let prev=-2;for(const p of pts){if(p.i!==prev+1&&cur.length){segs.push(cur);cur=[]}cur.push({i:p.i,v:Number(p.v)});prev=p.i}if(cur.length)segs.push(cur);
    return <g key={s.key}>{segs.map((sg,k)=>sg.length>1?<polyline key={k} fill="none" stroke={s.color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" points={sg.map(p=>`${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}/>:null)}
     {pts.map(p=><circle key={p.i} cx={x(p.i)} cy={y(Number(p.v))} r={p.i===pts[pts.length-1].i?5:3.5} fill="#fff" stroke={s.color} strokeWidth="2.4"><title>{`${s.name} ${p.v}% on ${dm(days[p.i].date)}`}</title></circle>)}</g>})}
   {days.map((d,i)=><text key={d.date} x={x(i)} y={H-8} textAnchor="middle" fontSize="11" fill="#5B6B80">{dm(d.date)}</text>)}
  </svg>
 </div>;
}

function Ring({pct,label,color}:{pct:number|null;label:string;color:string}){
 const r=46,c=2*Math.PI*r,p=pct==null?0:Math.max(0,Math.min(100,pct));
 return <div className="cc-ring"><svg viewBox="0 0 120 120" role="img" aria-label={`${label} ${pct==null?'not available':pct+'%'}`}><circle cx="60" cy="60" r={r} fill="none" stroke="#E7ECF2" strokeWidth="12"/><circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(p/100)*c} ${c}`} transform="rotate(-90 60 60)"/></svg><b className="num">{pct==null?'N/A':`${Math.round(p)}%`}</b><span>{label}</span></div>;
}
export function ResolutionRings({devPct,ticketPct,openDev,openTickets}:{devPct:number|null;ticketPct:number|null;openDev:number;openTickets:number}){
 return <>
  <div className="cc-rings"><Ring pct={nz(devPct)?Number(devPct):null} label="Deviations resolved" color={SOLVENT}/><Ring pct={nz(ticketPct)?Number(ticketPct):null} label="Tickets resolved" color="#0B8A57"/></div>
  <div className="cc-duo"><div><ShieldAlert size={18}/><span>Open deviations</span><b className="num">{openDev}</b></div><div><TicketCheck size={18}/><span>Open tickets</span><b className="num">{openTickets}</b></div></div>
  <div className="cc-links"><Link className="text-link" href="/solvent/tickets">Solvent tickets <ArrowRight size={14}/></Link><Link className="text-link" href="/quality/tickets">Quality tickets <ArrowRight size={14}/></Link></div>
 </>;
}

function MixBar({label,normal,warning,critical,href,extra}:{label:string;normal:number;warning:number;critical:number;href:string;extra:{k:string;v:string}[]}){
 const total=normal+warning+critical,pc=(n:number)=>total?Math.round((n/total)*100):0;
 return <div className="cc-mix">
  <div className="between"><b>{label}</b><span className="num cc-mute">{total} readings</span></div>
  {total?<div className="cc-stack" role="img" aria-label={`${label}: ${normal} normal, ${warning} warning, ${critical} critical`}>{normal?<i className="ok" style={{flex:normal}}/>:null}{warning?<i className="warn" style={{flex:warning}}/>:null}{critical?<i className="bad" style={{flex:critical}}/>:null}</div>:<div className="cc-stack empty"/>}
  <div className="cc-mixlegend"><span><i className="d-ok dot"/>Normal <b className="num">{normal}</b> <em>{pc(normal)}%</em></span><span><i className="d-warn dot"/>Warning <b className="num">{warning}</b> <em>{pc(warning)}%</em></span><span><i className="d-bad dot"/>Critical <b className="num">{critical}</b> <em>{pc(critical)}%</em></span></div>
  <div className="cc-chips">{extra.map(e=><span key={e.k}>{e.k}<b>{e.v}</b></span>)}<Link className="text-link" href={href}>Open <ArrowRight size={14}/></Link></div>
 </div>;
}
export function ConditionMix({ss,qs,prod,safe,solvent,quality}:{ss:any;qs:any;prod:any;safe:any;solvent:any;quality:any}){
 return <div className="stack" style={{gap:22}}>
  <MixBar label="Solvent" normal={ss?.normal||0} warning={ss?.warning||0} critical={ss?.critical||0} href="/solvent" extra={[{k:'Production',v:prod?.health==null?'N/A':`${prod.health}%`},{k:'Safety',v:safe?.health==null?'N/A':`${safe.health}%`},{k:'Shift',v:solvent?.shift_master?.name||'—'}]}/>
  <MixBar label="Quality" normal={qs?.normal||0} warning={qs?.warning||0} critical={qs?.critical||0} href="/quality" extra={[{k:'Attention',v:String((qs?.warning||0)+(qs?.critical||0))},{k:'Shift',v:quality?.shift_master?.name||'—'}]}/>
 </div>;
}

export function ProductColumns({products}:{products:any[]}){
 if(!products?.length)return <p className="panel-muted">No product data yet.</p>;
 const col=(v:any,color:string,name:string)=><div className="cc-col"><b className="num">{nz(v)?`${v}%`:'N/A'}</b><div className="cc-colbar">{nz(v)?<i style={{height:`${Math.max(3,Math.min(100,Number(v)))}%`,background:color}}/>:<i className="na"/>}</div><span>{name}</span></div>;
 return <div className="cc-products">{products.map((p:any)=><div className="cc-product" key={p.code}><div className="cc-cols">{col(p.solventHealth,SOLVENT,'Solvent')}{col(p.qualityHealth,QUALITY,'Quality')}</div><h4>{p.name}</h4></div>)}</div>;
}
