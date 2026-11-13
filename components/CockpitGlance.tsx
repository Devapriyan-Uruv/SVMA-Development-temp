'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,Sparkles} from 'lucide-react';

// The Management cockpit's top half, as designed: five headline numbers, production by day beside the live status of the plant sections, then Money,
// Import and Decisions-waiting. Everything is read-only and fail-soft: each block loads from an endpoint that already exists and is simply left out (or says so)
// when the signed-in user cannot see it or it cannot load. Nothing here writes, and no figure is invented — no "plan" line is drawn because no plan is stored.
const addDays=(ymd:string,n:number)=>new Date(Date.parse(ymd+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const istToday=()=>new Date(Date.now()+5.5*3600000).toISOString().slice(0,10);
const cr=(n:number)=>`₹${(n/1e7).toFixed(2)}`;
const dm=(ymd:string)=>{const d=new Date(ymd+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})};

type Tab='attention'|'good'|'better';
// The Uruv.ai reading of the day (the same "what went well / needs attention / could be better" statements the Management dashboard has always carried, each one
// traceable to a submitted reading) shown first, next to the headline numbers. The headline is simply the most important statement, not a new claim.
function AiReading({good,attention,better,trends}:{good:string[];attention:string[];better:string[];trends:string[]}){
 const [tab,setTab]=useState<Tab>(attention.length?'attention':'good');
 const [all,setAll]=useState(false);
 const [brief,setBrief]=useState<any>(null);
 useEffect(()=>{fetch('/api/ops/brief',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>setBrief(j?.brief||null)).catch(()=>{})},[]);
 const lists:Record<Tab,string[]>={attention,good,better};
 // the first "needs attention" statement is already the headline, so it is not repeated in the list below it
 const items=tab==='attention'&&attention.length?attention.slice(1):lists[tab],shown=all?items:items.slice(0,4);
 const headline=attention[0]||better[0]||good[0]||'No evidence-backed statement is available yet — readings are still coming in.';
 const tone=attention.length?'bad':'ok';
 const ask=()=>window.dispatchEvent(new CustomEvent('svma-assistant',{detail:{question:'Give me a management summary of the plant today: what needs my attention first, what went well and what to do next.'}}));
 const tabs:{k:Tab;label:string}[]=[{k:'attention',label:'Needs attention'},{k:'good',label:'Went well'},{k:'better',label:'Could be better'}];
 return <section className={`ck-ai tone-${tone}`} aria-label="Uruv.ai reading">
  <div className="ck-ai-head"><span className="ck-ai-badge"><Sparkles size={14}/>URUV.AI READING</span><button type="button" className="btn btn-outline ck-ask" onClick={ask}>Ask Uruvan</button></div>
  <h2 className="ck-ai-headline">{headline}</h2>
  <div className="ck-ai-tabs" role="tablist">{tabs.map(t=><button type="button" role="tab" aria-selected={tab===t.k} key={t.k} className={`${tab===t.k?'on':''} k-${t.k}`} onClick={()=>{setTab(t.k);setAll(false)}}>{t.label}<em>{lists[t.k].length}</em></button>)}</div>
  {items.length?<ul className={`ck-ai-list k-${tab}`}>{shown.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className="panel-muted">{tab==='attention'&&attention.length?'That is the only item that needs attention.':'Nothing in this group right now.'}</p>}
  {items.length>4?<button type="button" className="text-link ck-more" onClick={()=>setAll(a=>!a)}>{all?'Show fewer':`Show ${items.length-4} more`}</button>:null}
  {trends.length?<div className="ck-ai-trend"><b>Trend</b> {trends[0]}</div>:null}
  {brief?.summary?<div className="ck-ai-trend ops"><b>Operations today</b> {brief.summary}{brief.actionsRequired?.length?<> Needs action: {brief.actionsRequired.slice(0,2).join(' · ')}</>:null}</div>:null}
  <p className="ck-ai-foot">Built from submitted readings and operating history. Each line traces to a reading.</p>
 </section>;
}


const freshTone=(f:any)=>f.asOn==null?'bad':f.live?(f.ageDays<=1?'ok':'warn'):(f.ageDays<=3?'ok':'bad');
const ageText=(f:any)=>f.asOn==null?'no data':f.ageDays===0?'today':f.ageDays===1?'1 day old':`${f.ageDays} days old`;

// Open purchase orders, open sale orders and open deviations, as plain counts next to the AI reading.
function OrderTiles({ol,failed,openDev}:{ol:any;failed:boolean;openDev?:number|null}){
 const n=(v:any)=>v==null?'—':v;
 return <div className="ck-tiles">
  <Link href="/operations/supply" className="ck-tile"><span>OPEN PURCHASE ORDERS</span><b className="num">{ol?n(ol.purchase.openPoCount):failed?'—':'…'}</b><em>{ol?`${ol.purchase.pendingMt} MT pending`:' '}</em></Link>
  <Link href="/operations/sales" className="ck-tile"><span>OPEN SALE ORDERS</span><b className="num">{ol?n(ol.sales.openSoCount):failed?'—':'…'}</b><em>{ol?`${ol.sales.openSoMt} MT to dispatch`:' '}</em></Link>
  <Link href="/solvent/deviations" className="ck-tile"><span>OPEN DEVIATIONS</span><b className="num">{n(openDev)}</b><em>Solvent and Quality</em></Link>
  <Link href="/operations/exceptions" className="ck-tile"><span>OPERATIONS EXCEPTIONS</span><b className="num">{ol?n(ol.exceptions.open):failed?'—':'…'}</b><em className={ol?.exceptions.critical?'t-bad':''}>{ol?`${ol.exceptions.critical} critical`:' '}</em></Link>
 </div>;
}

// "Can we produce and sell over the next 3 days?" — an honest answer from the Operations data, with the age of every source shown.
function OutlookPanel({ol,failed}:{ol:any;failed:boolean}){
 if(failed)return <section className="dashboard-panel ck-outlook"><div className="panel-heading"><div><span>NEXT 3 DAYS</span><h3>Production and sales outlook</h3></div></div><p className="panel-muted">The Operations outlook is not available for your access, or could not load just now.</p></section>;
 if(!ol)return <section className="dashboard-panel ck-outlook"><div className="panel-heading"><div><span>NEXT 3 DAYS</span><h3>Production and sales outlook</h3></div></div><p className="panel-muted">Loading…</p></section>;
 const pv=ol.verdict.produce,sv=ol.verdict.sell,cover=ol.rawMaterial.coverDays;
 const chip=(st:string)=>({yes:['Yes','ok'],tight:['Tight','warn'],no:['No','bad'],partial:['Partly','warn'],unknown:['Not confirmed','idle']} as any)[st];
 const [pl,pt]=chip(pv.state),[sl,st2]=chip(sv.state);
 const maxD=Math.max(1,...ol.sales.last7.map((x:any)=>x.value));
 return <section className="dashboard-panel ck-outlook">
  <div className="panel-heading"><div><span>NEXT 3 DAYS</span><h3>Can we produce and sell?</h3></div><Link className="text-link" href="/operations">Operations <ArrowRight size={14}/></Link></div>
  <div className="ck-out-grid">
   <div className="ck-out-card">
    <div className="ck-out-top"><b>Production</b><span className={`mc-tag tag-${pt}`}>{pl}</span></div>
    <p>{pv.text}</p>
    <div className="ck-facts"><div><span>Raw material</span><b className="num">{ol.rawMaterial.totalMt}<small> MT</small></b></div><div><span>Feeding / day</span><b className="num">{ol.production.avgFeedMtPerDay||'—'}<small> MT</small></b></div><div><span>Cover</span><b className="num">{cover==null?'—':cover}<small> days</small></b></div></div>
    {cover!=null?<div className="ck-cover" aria-label="Raw material cover against 3 days"><i style={{width:`${Math.min(100,(cover/3)*100)}%`}} className={pt}/><em/></div>:null}
    {ol.rawMaterial.byGrade.length?<div className="ck-grades">{ol.rawMaterial.byGrade.slice(0,4).map((g:any)=><span key={g.grade}>{g.grade||'Other'} <b className="num">{g.mt}</b></span>)}</div>:null}
   </div>
   <div className="ck-out-card">
    <div className="ck-out-top"><b>Sales from stock</b><span className={`mc-tag tag-${st2}`}>{sl}</span></div>
    <p>{sv.text}</p>
    <div className="ck-facts"><div><span>Open orders</span><b className="num">{ol.sales.openSoMt}<small> MT</small></b></div><div><span>Finished stock</span><b className="num">{ol.sales.stockStale?'—':ol.sales.finishedStockMt}<small>{ol.sales.stockStale?'':' MT'}</small></b></div><div><span>Invoiced, 7 days</span><b className="num">{cr(ol.sales.last7Value)}<small> Cr</small></b></div></div>
    <div className="ck-minibars" role="img" aria-label="Invoiced value per day, last 7 days">{ol.sales.last7.map((d:any)=><div key={d.date} title={`${d.date}: ${d.invoices} invoices, ${cr(d.value)} Cr`}><i style={{height:`${Math.max(4,(d.value/maxD)*100)}%`}}/><span>{d.date.slice(8)}</span></div>)}</div>
   </div>
  </div>
  <div className="ck-fresh"><b>Data behind this</b>{ol.freshness.map((f:any)=><span key={f.label} className={`ck-fchip t-${freshTone(f)}`}><i className={`dot d-${freshTone(f)}`}/>{f.label} <em>{f.asOn?`${f.asOn.slice(5)} · ${ageText(f)}`:'no data'}</em>{f.live?<small>live</small>:<small>manual</small>}</span>)}</div>
  {ol.freshness.some((f:any)=>!f.live&&f.ageDays>3)?<p className="ck-fnote">The sources marked manual are loaded from uploaded files and can run behind the live ones.</p>:null}
 </section>;
}

export function CockpitGlance({solventHealth,qualityHealth,openTickets,openDev,solventNote,qualityNote,good=[],attention=[],better=[],trends=[]}:{solventHealth?:number|null;qualityHealth?:number|null;openTickets?:number|null;openDev?:number|null;solventNote?:string;qualityNote?:string;good?:string[];attention?:string[];better?:string[];trends?:string[]}){
 const [ol,setOl]=useState<any>(null),[olFailed,setOlFailed]=useState(false);
 useEffect(()=>{fetch('/api/ceo/outlook',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error('x'))).then(setOl).catch(()=>setOlFailed(true))},[]);
 // the plant statements from the dashboard and the Operations outlook statements read as one reading
 const rg=ol?.reading||{attention:[],good:[],better:[]};
 const allAttention=[...attention,...rg.attention],allGood=[...good,...rg.good],allBetter=[...better,...rg.better];
 const [range,setRange]=useState<7|30>(7);
 const [dash,setDash]=useState<any>(null),[dashFailed,setDashFailed]=useState(false);
 const [me,setMe]=useState<any>(null);
 const [prod,setProd]=useState<any>(null),[endDay,setEndDay]=useState('');
 const [money,setMoney]=useState<any>(null);
 const [contracts,setContracts]=useState<any[]|null>(null);

 useEffect(()=>{
  const load=(retry:boolean)=>fetch('/api/solvent/dashboard',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error('x'))).then(j=>{setDash(j);setDashFailed(false)}).catch(()=>{if(retry)setTimeout(()=>load(false),2500);else setDashFailed(true)});
  void load(true);
  fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(setMe).catch(()=>{});
  fetch('/api/finance/outstanding',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>{
   if(!v||v.empty||!Array.isArray(v.parties))return;
   const sum=(side:string)=>v.parties.filter((p:any)=>p.side===side).reduce((a:number,p:any)=>a+Number(p.outstanding||0),0);
   const oldBy=new Map<string,number>();for(const b of (v.bills||[]))if(b.side==='debtor'&&Number(b.ageDays||0)>60&&Number(b.outstanding||0)>0)oldBy.set(b.party,(oldBy.get(b.party)||0)+Number(b.outstanding));
   let overdue=0,n=0;for(const p of v.parties){if(p.side!=='debtor')continue;const o=Math.min(Math.max(0,Number(p.outstanding||0)),oldBy.get(p.party)||0);if(o>0){overdue+=o;n++}}
   setMoney({receivable:sum('debtor'),payable:sum('creditor'),overdue,overdueParties:n,asOf:v.periodTo||''});
  }).catch(()=>{});
  fetch('/api/import-contracts?pageSize=4&page=1',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>setContracts(j?.contracts||null)).catch(()=>{});
 },[]);
 // One read of the last 60 days; the chart then ends on the newest day that actually has production entered (entries can lag the calendar), and the
 // 7 / 30 day switch only changes how much of that is shown.
 useEffect(()=>{
  fetch(`/api/ops/production/dashboard?from=${addDays(istToday(),-60)}&to=${istToday()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{
   if(!j){setProd({failed:true});return}
   const dates=(j.byShift||[]).filter((r:any)=>Number(r.weightQty)>0).map((r:any)=>String(r.reportDate)).sort();
   setEndDay(dates.length?dates[dates.length-1]:istToday());setProd(j);
  }).catch(()=>setProd({failed:true}));
 },[]);

 const days=useMemo(()=>{
  const out:{d:string;mt:number}[]=[];for(let i=range-1;i>=0;i--)out.push({d:addDays(endDay||istToday(),-i),mt:0});
  for(const r of (prod?.byShift||[])){const x=out.find(o=>o.d===r.reportDate);if(x)x.mt+=Number(r.weightQty||0)}
  return out;
 },[prod,range,endDay]);
 const lastWithData=[...days].reverse().find(x=>x.mt>0)||null;
 const maxMt=Math.max(1,...days.map(x=>x.mt));
 const avgMt=days.filter(x=>x.mt>0).length?days.reduce((a,x)=>a+x.mt,0)/days.filter(x=>x.mt>0).length:0;

 const by=new Map<string,any[]>();for(const m of (dash?.metrics||[])){const k=String(m.section||'Other').trim()||'Other';if(!by.has(k))by.set(k,[]);by.get(k)!.push(m)}
 const rows=[...by.entries()].map(([name,list])=>{const bad=list.filter(m=>m.critical),warn=list.filter(m=>!m.critical&&m.warning);const worst=bad[0]||warn[0]||null;return {name,tone:bad.length?'bad':warn.length?'warn':'ok',n:bad.length||warn.length,worst}})
  .sort((a,b)=>({bad:0,warn:1,ok:2} as any)[a.tone]-({bad:0,warn:1,ok:2} as any)[b.tone]);
 const decisions=[
  {label:'Approvals waiting',sub:'Purchases, payments and requests',n:Number(me?.pendingApprovalsCount||0),href:'/approvals',who:'AP'},
  {label:'Leave to approve',sub:'Team leave requests',n:Number(me?.pendingLeaveApprovalsCount||0),href:'/hr/my',who:'LV'},
  {label:'Access requests',sub:'People asking for access',n:Number(me?.pendingAccessRequestsCount||0),href:'/admin/access-requests',who:'AC'},
  {label:'Announcements',sub:'Not yet read',n:Number(me?.unreadAnnouncementCount||0),href:'/announcements',who:'AN'},
 ];
 const total=decisions.reduce((s,x)=>s+x.n,0);
 const hasMoney=!!money,total2=money?Math.max(money.receivable,money.payable,1):1;

 return <>
  <div className="ck-top"><AiReading good={allGood} attention={allAttention} better={allBetter} trends={trends}/>
  <div className="ck-side">
  <div className="ck-kpis">
   <div className="entry-kpi accentc"><span>PRODUCTION · {lastWithData?dm(lastWithData.d).toUpperCase():'LAST DAY'}</span><b className="num">{prod?(lastWithData?lastWithData.mt.toFixed(0):'—'):'…'}<small> MT</small></b><em>{avgMt?`${avgMt.toFixed(0)} MT average per day`:'No production entered in this range'}</em></div>
   <div className={`entry-kpi ${solventHealth==null?'':solventHealth>=90?'okc':solventHealth>=75?'warnc':'badc'}`}><span>SOLVENT HEALTH</span><b className="num">{solventHealth==null?'N/A':solventHealth}<small>{solventHealth==null?'':' %'}</small></b><em>{solventNote||'Readings within target'}</em></div>
   <div className={`entry-kpi ${qualityHealth==null?'':qualityHealth>=90?'okc':qualityHealth>=75?'warnc':'badc'}`}><span>QUALITY HEALTH</span><b className="num">{qualityHealth==null?'N/A':qualityHealth}<small>{qualityHealth==null?'':' %'}</small></b><em>{qualityNote||'Lab results within target'}</em></div>
   <div className="entry-kpi okc"><span>RECEIVABLE</span><b className="num">{hasMoney?cr(money.receivable):'—'}<small>{hasMoney?' Cr':''}</small></b><em className={hasMoney&&money.overdue>0?'t-bad':''}>{hasMoney?`${cr(money.overdue)} Cr over 60 days`:'Finance access needed'}</em></div>
   <div className={`entry-kpi ${Number(openTickets||0)>100?'badc':'warnc'}`}><span>OPEN TICKETS</span><b className="num">{openTickets==null?'—':openTickets}</b><em>Deviations and actions to close</em></div>
  </div>
  <OrderTiles ol={ol} failed={olFailed} openDev={openDev}/>
  </div>
  </div>

  <OutlookPanel ol={ol} failed={olFailed}/>

  <div className="dashboard-canvas" style={{marginTop:16}}>
   <section className="dashboard-panel span-7"><div className="panel-heading"><div><span>PRODUCTION</span><h3>Output by day</h3></div>
    <div className="segmented" role="group" aria-label="Range"><button type="button" className={range===7?'active':''} onClick={()=>setRange(7)}>7 days</button><button type="button" className={range===30?'active':''} onClick={()=>setRange(30)}>30 days</button></div></div>
    {prod?.failed?<p className="panel-muted">Production by day is not available for your access.</p>:
     <div className={`ck-bars r${range}`} role="img" aria-label="Production in MT per day">{days.map((x,i)=><div className="ck-bar" key={x.d} title={`${dm(x.d)}: ${x.mt.toFixed(1)} MT`}>
      <em className="num">{x.mt>0&&(range===7||i===days.length-1)?x.mt.toFixed(0):''}</em>
      <i className={x.d===lastWithData?.d?'last':x.mt>0?'':'zero'} style={{height:`${Math.max(x.mt>0?4:1,(x.mt/maxMt)*100)}%`}}/>
      <span>{range===7||i%5===0||i===days.length-1?dm(x.d):''}</span></div>)}</div>}
    <p className="panel-muted" style={{marginTop:6}}>Up to {endDay?dm(endDay):'—'} · weight-based production only (MT) from the Operations production entries. No plan is stored, so none is drawn.</p>
   </section>
   <section className="dashboard-panel span-5"><div className="panel-heading"><div><span>PLANT SECTIONS</span><h3>Live status</h3></div><Link className="text-link" href="/solvent">Solvent <ArrowRight size={14}/></Link></div>
    {rows.length?<div className="glance-list">{rows.slice(0,6).map(r=><div className="glance-row" key={r.name}><i className={`dot d-${r.tone}`}/><span className="glance-main"><b>{r.name}</b><small>{r.worst?`${r.worst.name} ${r.worst.latest??''}${r.worst.unit?` ${r.worst.unit}`:''}`:'Running within limits'}</small></span><span className={`mc-tag tag-${r.tone}`}>{r.tone==='bad'?'Alert':r.tone==='warn'?'Watch':'Running'}</span></div>)}</div>
     :<p className="panel-muted">{dash?'No readings submitted yet.':dashFailed?'Live status could not load just now — open the Solvent dashboard.':'Loading…'}</p>}
    {rows.length>6?<p className="panel-muted" style={{marginTop:8}}>+{rows.length-6} more sections on the Solvent dashboard.</p>:null}
   </section>
  </div>

  <div className="ck-three">
   <section className="dashboard-panel"><div className="panel-heading"><div><span>MONEY</span><h3>Debtors and creditors</h3></div><Link className="text-link" href="/finance/outstanding">Open <ArrowRight size={14}/></Link></div>
    {hasMoney?<div className="stack" style={{gap:16}}>
     <div><div className="between"><b>Receivable</b><span className="num">{cr(money.receivable)} Cr</span></div><div className="bar ok" style={{marginTop:6}}><i style={{width:`${(money.receivable/total2)*100}%`}}/></div></div>
     <div><div className="between"><b>Payable</b><span className="num">{cr(money.payable)} Cr</span></div><div className="bar warn" style={{marginTop:6}}><i style={{width:`${(money.payable/total2)*100}%`}}/></div></div>
     <div className="ck-note">{money.overdueParties} parties have bills older than 60 days ({cr(money.overdue)} Cr). Day Book as of {money.asOf?dm(money.asOf):'—'}.</div>
    </div>:<p className="panel-muted">Not available — Finance access is needed, or no Day Book is uploaded yet.</p>}
   </section>
   <section className="dashboard-panel"><div className="panel-heading"><div><span>IMPORT</span><h3>Contracts</h3></div><Link className="text-link" href="/import/contracts">Open <ArrowRight size={14}/></Link></div>
    {contracts?.length?<div className="glance-list">{contracts.map((c:any)=><div className="glance-row" key={c.id}><span className="glance-main"><b>{c.fields?.supplierName||c.importId||'Contract'}</b><small>{[c.fields?.productMaterialName,c.fields?.quantity&&`${c.fields.quantity} ${c.fields.uom||''}`.trim()].filter(Boolean).join(' · ')||c.fields?.contractNumber||''}</small></span><span className={`mc-tag tag-${c.status==='Confirmed'?'ok':'warn'}`}>{c.status}</span></div>)}</div>
     :<p className="panel-muted">{contracts?'No contracts yet.':'Not available — Import access is needed.'}</p>}
   </section>
   <section className="dashboard-panel"><div className="panel-heading"><div><span>DECISIONS WAITING</span><h3>{total?`${total} need you`:'Nothing waiting'}</h3></div></div>
    <div className="glance-list">{decisions.map(x=><Link key={x.label} href={x.href} className="glance-row glance-link"><span className="ava">{x.who}</span><span className="glance-main"><b>{x.label}</b><small>{x.sub}</small></span><span className={`num glance-n ${x.n?'on':''}`}>{x.n}</span></Link>)}</div>
   </section>
  </div>
 </>;
}
