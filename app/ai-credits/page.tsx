'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Coins,Download,FileText,Gauge,Receipt,TrendingUp,Zap} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {Kpi} from '@/components/Kpi';
import {DateRangeFilter} from '@/components/DateRangeFilter';

type Line={key:string;requests:number;credits:number;charge:number;name?:string};
type Data={
 notSetUp?:boolean;error?:string;range:{from:string;to:string};markupPct:number;gstPct:number;usdInrRate:number;creditUnit:string;
 totals:{requests:number;credits:number;charge:number;avgChargePerRequest:number};
 month:{label:string;charge:number;credits:number;projectedCharge:number};
 daily:{date:string;requests:number;credits:number;charge:number}[];
 byFeature:Line[];byTier:Line[];byUser:Line[];
 statements:{month:string;statementNo:string;requests:number;credits:number;charge:number}[];
 recent:{time:string;feature:string;tier:string;credits:number;charge:number;user:string}[];
};
const usd=(n:number)=>`₹${n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:n>0&&n<1?3:2})}`;
const num=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});
const pad=(n:number)=>String(n).padStart(2,'0');
const ymd=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function monthLabel(m:string){const [y,mo]=m.split('-').map(Number);return new Date(y,mo-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'})}

export default function AiCreditsPage(){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[denied,setDenied]=useState(false),[loading,setLoading]=useState(true);
 const load=useCallback(async(f:string,t:string)=>{
  setLoading(true);setError('');
  try{
   const q=new URLSearchParams();if(f)q.set('from',f);if(t)q.set('to',t);
   const r=await fetch(`/api/ai-credits?${q}`,{cache:'no-store'}),j=await r.json().catch(()=>({}));
   if(r.status===403||r.status===401){setDenied(true);return}
   if(!r.ok)throw new Error(j.error||'Unable to load URUV model credits.');
   setData(j);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load URUV model credits.')}finally{setLoading(false)}
 },[]);
 useEffect(()=>{void load(from,to)},[from,to,load]);
 const preset=(kind:'month'|'30'|'last')=>{const now=new Date();if(kind==='month'){setFrom('');setTo('')}else if(kind==='30'){const s=new Date(now.getTime()-29*864e5);setFrom(ymd(s));setTo(ymd(now))}else{const s=new Date(now.getFullYear(),now.getMonth()-1,1),e=new Date(now.getFullYear(),now.getMonth(),0);setFrom(ymd(s));setTo(ymd(e))}};
 const max=useMemo(()=>Math.max(0.0001,...(data?.daily||[]).map(d=>d.charge)),[data]);
 const csv=(f:string,t:string)=>{window.location.href=`/api/ai-credits?format=csv&from=${f}&to=${t}`};
 const [receiptMsg,setReceiptMsg]=useState('');
 async function receipt(f:string,t:string){
  setReceiptMsg('');
  try{
   const r=await fetch(`/api/ai-credits/receipt?from=${f}&to=${t}`,{cache:'no-store'});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Unable to create the receipt.')}
   const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`AIX3_usage_receipt_${f}_to_${t}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setReceiptMsg(e instanceof Error?e.message:'Unable to create the receipt.')}
 }
 const monthRange=(m:string)=>{const [y,mo]=m.split('-').map(Number);return [`${m}-01`,`${m}-${pad(new Date(y,mo,0).getDate())}`] as const};
 const monthReceipt=(m:string)=>{const [a,b]=monthRange(m);void receipt(a,b)};
 const monthCsv=(m:string)=>{const [y,mo]=m.split('-').map(Number);csv(`${m}-01`,`${m}-${pad(new Date(y,mo,0).getDate())}`)};

 if(denied)return <><PageHeader title="URUV Model Credits" backHref="/" backLabel="Home"/><div className="notice danger" role="alert">URUV model credits are visible to Management and Super Admin only.</div></>;
 return <>
  <PageHeader title="URUV Model Credits" subtitle="What the AI features across the app have consumed, and the charge for it." backHref="/" backLabel="Home" action={data&&!data.notSetUp?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-primary" onClick={()=>receipt(data.range.from,data.range.to)}><FileText size={15}/>Download receipt (PDF)</button><button className="btn btn-outline" onClick={()=>csv(data.range.from,data.range.to)}><Download size={15}/>Usage (CSV)</button></div>:undefined}/>
  {error?<div role="alert" className="notice danger" style={{marginBottom:12}}>{error}</div>:null}
  {receiptMsg?<div role="alert" className="notice warn" style={{marginBottom:12}}>{receiptMsg}</div>:null}
  {data?.notSetUp?<div className="notice warn" role="status">{data.error}</div>:null}
  {!data&&loading?<div className="card tight">Loading…</div>:null}
  {data&&!data.notSetUp?<>
   <div className="card tight" style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end',justifyContent:'space-between'}}>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button className="btn btn-outline btn-sm" onClick={()=>preset('month')}>This month</button>
     <button className="btn btn-outline btn-sm" onClick={()=>preset('30')}>Last 30 days</button>
     <button className="btn btn-outline btn-sm" onClick={()=>preset('last')}>Last month</button>
    </div>
    <DateRangeFilter from={from||data.range.from} to={to||data.range.to} onFrom={setFrom} onTo={setTo} onClear={()=>{setFrom('');setTo('')}}/>
   </div>
   <div className="sub" style={{margin:'8px 2px'}}>Showing {data.range.from} to {data.range.to} (IST). {data.creditUnit}. Amounts are in rupees and include a {data.markupPct}% service fee and {data.gstPct}% GST (converted at ₹{data.usdInrRate} per US$1). The downloaded receipt splits the usage value and GST. Usage is recorded from the day this feature went live.</div>

   <div className="grid kpis" style={{marginTop:6}}>
    <Kpi icon={Coins} tone="blue" label="Charge in period" value={usd(data.totals.charge)} foot={`${data.totals.requests.toLocaleString('en-US')} requests`}/>
    <Kpi icon={Zap} tone="violet" label="Credits used" value={num(data.totals.credits)} foot="URUV model credits"/>
    <Kpi icon={Gauge} tone="green" label="Average per request" value={usd(data.totals.avgChargePerRequest)} foot="incl. service fee and GST"/>
    <Kpi icon={TrendingUp} tone="amber" label={`${monthLabel(data.month.label)} so far`} value={usd(data.month.charge)} foot={`Projected month-end ${usd(data.month.projectedCharge)}`}/>
   </div>

   <div className="card" style={{marginTop:14}}>
    <div className="section-title">Daily charge</div>
    {data.totals.requests===0?<div className="empty">No usage recorded in this period.</div>:
    <div style={{display:'flex',alignItems:'flex-end',gap:3,height:150,paddingTop:8,overflowX:'auto'}} role="img" aria-label="Daily charge in rupees">
     {data.daily.map(d=><div key={d.date} title={`${d.date}: ${usd(d.charge)} · ${num(d.credits)} credits · ${d.requests} requests`} style={{flex:'1 0 14px',display:'flex',flexDirection:'column',justifyContent:'flex-end',height:'100%'}}>
      <div style={{height:`${Math.max(d.charge>0?3:0,(d.charge/max)*100)}%`,background:'var(--navy,#1F3A5F)',borderRadius:'3px 3px 0 0',opacity:d.charge>0?1:.15}}/>
     </div>)}
    </div>}
    {data.daily.length?<div className="sub" style={{display:'flex',justifyContent:'space-between',marginTop:6}}><span>{data.daily[0].date}</span><span>Peak day {usd(max<0.001?0:max)}</span><span>{data.daily[data.daily.length-1].date}</span></div>:null}
   </div>

   <div className="grid two" style={{marginTop:14}}>
    <Breakdown title="By feature" rows={data.byFeature} label={r=>r.key}/>
    <Breakdown title="By URUV model" rows={data.byTier} label={r=>r.key}/>
   </div>
   <div style={{marginTop:14}}><Breakdown title="By user" rows={data.byUser} label={r=>r.name||r.key}/></div>

   <div className="card" style={{marginTop:14}}>
    <div className="section-title" style={{display:'flex',alignItems:'center',gap:8}}><Receipt size={17}/>Monthly statements</div>
    {!data.statements.length?<div className="empty">No statements yet.</div>:
    <div className="table-wrap"><table><thead><tr><th>Statement</th><th>Month</th><th style={{textAlign:'right'}}>Requests</th><th style={{textAlign:'right'}}>Credits used</th><th style={{textAlign:'right'}}>Charge</th><th/></tr></thead><tbody>
     {data.statements.map(s=><tr key={s.month}><td><b>{s.statementNo}</b></td><td>{monthLabel(s.month)}</td><td style={{textAlign:'right'}}>{s.requests.toLocaleString('en-US')}</td><td style={{textAlign:'right'}}>{num(s.credits)}</td><td style={{textAlign:'right'}}><b>{usd(s.charge)}</b></td><td style={{textAlign:'right',whiteSpace:'nowrap'}}><button className="btn btn-outline btn-sm" onClick={()=>monthReceipt(s.month)}><FileText size={13}/>Receipt</button> <button className="btn btn-outline btn-sm" onClick={()=>monthCsv(s.month)}><Download size={13}/>CSV</button></td></tr>)}
    </tbody></table></div>}
   </div>

   <div className="card" style={{marginTop:14}}>
    <div className="section-title">Recent requests</div>
    {!data.recent.length?<div className="empty">No requests in this period.</div>:
    <div className="table-wrap" style={{maxHeight:420}}><table><thead><tr><th>Time (IST)</th><th>Feature</th><th>URUV model</th><th>Requested by</th><th style={{textAlign:'right'}}>Credits</th><th style={{textAlign:'right'}}>Charge</th></tr></thead><tbody>
     {data.recent.map((r,i)=><tr key={i}><td style={{whiteSpace:'nowrap'}}>{r.time}</td><td>{r.feature}</td><td>{r.tier}</td><td>{r.user}</td><td style={{textAlign:'right'}}>{num(r.credits)}</td><td style={{textAlign:'right'}}>{usd(r.charge)}</td></tr>)}
    </tbody></table></div>}
   </div>
  </>:null}
 </>;
}

function Breakdown({title,rows,label}:{title:string;rows:Line[];label:(r:Line)=>string}){
 const total=rows.reduce((s,r)=>s+r.charge,0)||1;
 return <div className="card">
  <div className="section-title">{title}</div>
  {!rows.length?<div className="empty">No usage in this period.</div>:
  <div className="table-wrap"><table><thead><tr><th>{title.replace('By ','')}</th><th style={{textAlign:'right'}}>Requests</th><th style={{textAlign:'right'}}>Credits</th><th style={{textAlign:'right'}}>Charge</th><th style={{minWidth:90}}>Share</th></tr></thead><tbody>
   {rows.map(r=><tr key={r.key}><td>{label(r)}</td><td style={{textAlign:'right'}}>{r.requests.toLocaleString('en-US')}</td><td style={{textAlign:'right'}}>{num(r.credits)}</td><td style={{textAlign:'right'}}><b>{usd(r.charge)}</b></td><td><div style={{height:8,background:'#eef1f5',borderRadius:4}}><div style={{width:`${Math.round(r.charge/total*100)}%`,height:'100%',background:'var(--navy,#1F3A5F)',borderRadius:4}}/></div></td></tr>)}
  </tbody></table></div>}
 </div>;
}
