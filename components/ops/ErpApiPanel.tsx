'use client';
import {useEffect,useMemo,useState} from 'react';
import {Download,RefreshCw,CloudDownload} from 'lucide-react';

type Report='pending'|'payments'|'purchases';
type Source='saved'|'live';
type Snapshot={date:string;contracts:number;balance:number};
type Run={id:string;started_at:string;finished_at:string|null;trigger:string;status:string;details:Record<string,{rows:number;added:number;changed:number;unchanged:number;error?:string}>;error:string|null};
const inr=(n:number)=>`₹${Math.round(n||0).toLocaleString('en-IN')}`;
const q2=(n:number)=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
const day=(s:unknown)=>String(s||'').slice(0,10);
const today=()=>new Date().toISOString().slice(0,10);
const fyStart=()=>{const d=new Date(),y=d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;return `${y}-04-01`};
const daysAgo=(d:string)=>Math.round((Date.parse(today())-Date.parse(d))/86400000);
const when=(s:string|null)=>s?new Date(s).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';

const REPORTS:{key:Report;label:string;note:string}[]=[
 {key:'pending',label:'Open purchase orders (pending)',note:'Purchase contracts not yet fully received, as on a date.'},
 {key:'payments',label:'Supplier payments',note:'Payments made to suppliers, one line per bill (lot) paid.'},
 {key:'purchases',label:'Purchase documents',note:'Purchase documents in a date range (the API currently returns purchase returns only).'},
];

// The ERP Report API. "Saved daily" shows the consolidated data the daily sync keeps in our database (history, no waiting on the ERP);
// "Live" asks the ERP right now. Both read only — nothing here changes the ERP.
export function ErpApiPanel(){
 const [source,setSource]=useState<Source>('saved'),[report,setReport]=useState<Report>('pending');
 const [asOn,setAsOn]=useState(today()),[from,setFrom]=useState(fyStart()),[to,setTo]=useState(today()),[snapshot,setSnapshot]=useState('');
 const [rows,setRows]=useState<any[]|null>(null),[loadedFor,setLoadedFor]=useState<Report|null>(null),[fetchedAt,setFetchedAt]=useState(''),[busy,setBusy]=useState(false),[syncing,setSyncing]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
 const [lastRun,setLastRun]=useState<Run|null>(null),[snapshots,setSnapshots]=useState<Snapshot[]>([]),[notSetUp,setNotSetUp]=useState(false),[syncMsg,setSyncMsg]=useState('');

 async function loadStatus(){
  try{
   const r=await fetch('/api/ops/supply/erp-saved?report=status',{cache:'no-store'});const j=await r.json().catch(()=>({}));
   if(r.status===503&&j.code==='not_set_up'){setNotSetUp(true);setSource('live');return}
   if(!r.ok)return;
   setNotSetUp(false);setLastRun(j.lastRun||null);setSnapshots(j.snapshots||[]);if(j.snapshots?.[0]&&!snapshot)setSnapshot(j.snapshots[0].date);
  }catch{/* the status line is optional */}
 }
 useEffect(()=>{void loadStatus()},[]);

 async function load(fresh=false){
  setBusy(true);setError('');
  try{
   const p=new URLSearchParams({report});
   if(report==='pending'){if(source==='live')p.set('asOn',asOn);else if(snapshot)p.set('snapshot',snapshot)}else{p.set('from',from);p.set('to',to)}
   if(fresh&&source==='live')p.set('fresh','1');
   const r=await fetch(`${source==='live'?'/api/ops/supply/erp-api':'/api/ops/supply/erp-saved'}?${p}`,{cache:'no-store'});const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||`Could not read the ERP data (HTTP ${r.status}).`);
   setRows(j.rows||[]);setLoadedFor(report);setFetchedAt(j.fetchedAt||'');if(j.lastRun)setLastRun(j.lastRun);
  }catch(e){setError(e instanceof Error?e.message:'Could not read the ERP data.');setRows(null)}finally{setBusy(false)}
 }

 async function syncNow(){
  setSyncing(true);setSyncMsg('');setError('');
  try{
   const r=await fetch('/api/ops/mtreport/sync',{method:'POST'});const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||`The sync failed (HTTP ${r.status}).`);
   const d=j.details||{};
   setSyncMsg(`Sync ${j.status}: payments +${d.payments?.added??0} new, ${d.payments?.changed??0} updated • purchase documents +${d.purchases?.added??0} • pending contracts ${d.pending?.rows??0}${Object.values(d).some((x:any)=>x.error)?' — some parts failed, see the last run below':''}.`);
   await loadStatus();setNotSetUp(false);setRows(null);
  }catch(e){setError(e instanceof Error?e.message:'The sync failed.')}finally{setSyncing(false)}
 }

 const shown=useMemo(()=>{const t=search.trim().toLowerCase();return (rows||[]).filter(r=>!t||Object.values(r).some(v=>String(v??'').toLowerCase().includes(t)))},[rows,search]);
 const latest=useMemo(()=>{const k=loadedFor==='payments'?'paymentDate':loadedFor==='purchases'?'poDate':loadedFor==='pending'?'contractDate':'';return k&&rows?.length?rows.map(r=>day(r[k])).sort().pop()||'':''},[rows,loadedFor]);
 const stats=useMemo(()=>{
  if(!rows||!loadedFor)return [];
  if(loadedFor==='pending')return [['Open contracts',String(rows.length)],['Suppliers',String(new Set(rows.map(r=>r.partyName)).size)],['Contract qty',q2(rows.reduce((s,r)=>s+r.contractQty,0))],['Received',q2(rows.reduce((s,r)=>s+r.receivedQty,0))],['Balance',q2(rows.reduce((s,r)=>s+r.balanceQty,0))]];
  if(loadedFor==='payments')return [['Payment lines',String(rows.length)],['Payments',String(new Set(rows.map(r=>r.paymentReferenceNo)).size)],['Suppliers',String(new Set(rows.map(r=>r.supplierId)).size)],['Amount paid',inr(rows.reduce((s,r)=>s+r.amount,0))]];
  return [['Documents',String(rows.length)],['Suppliers',String(new Set(rows.map(r=>r.supplierName)).size)],['Total amount',inr(rows.reduce((s,r)=>s+r.totalAmount,0))]];
 },[rows,loadedFor]);

 async function download(){
  if(!shown.length)return;
  const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(shown),'ERP API');
  XLSX.writeFile(wb,`ERP_API_${loadedFor}_${today()}.xlsx`);
 }
 const cur=REPORTS.find(r=>r.key===report)!;
 const stale=latest&&daysAgo(latest)>10?daysAgo(latest):0;
 const syncLine=lastRun?`Last sync ${when(lastRun.finished_at||lastRun.started_at)} (${lastRun.status}${lastRun.trigger==='schedule'?', daily':', manual'})`:'No sync has run yet';

 return <section className="card" style={{marginTop:14}}>
  <div className="section-title">ERP API <span className="sub" style={{fontWeight:400}}>— read-only; consolidated daily</span></div>
  <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap',alignItems:'center'}}>
   <button type="button" className={`btn ${source==='saved'?'btn-primary':'btn-outline'}`} disabled={notSetUp} onClick={()=>{setSource('saved');setRows(null);setError('')}}>Saved daily</button>
   <button type="button" className={`btn ${source==='live'?'btn-primary':'btn-outline'}`} onClick={()=>{setSource('live');setRows(null);setError('')}}>Live from ERP</button>
   <button type="button" className="btn btn-outline" disabled={syncing} onClick={()=>void syncNow()}><CloudDownload size={16}/>{syncing?'Syncing from the ERP…':'Sync now'}</button>
   <span className="sub">{notSetUp?'Saved data not set up yet — run sql/073_erp_api_sync.sql in Supabase.':syncLine}</span>
  </div>
  {syncMsg?<div className="notice" style={{marginTop:8}}>{syncMsg}</div>:null}
  {lastRun?.error?<div className="notice warn" style={{marginTop:8}}>Last run reported: {lastRun.error}</div>:null}

  <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end',marginTop:12}}>
   <div className="field compact-field"><label>Report</label><select value={report} onChange={e=>{setReport(e.target.value as Report);setRows(null);setLoadedFor(null);setError('')}}>{REPORTS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
   {report==='pending'?(source==='live'
     ?<div className="field compact-field"><label>As on</label><input type="date" value={asOn} onChange={e=>setAsOn(e.target.value)}/></div>
     :<div className="field compact-field"><label>Snapshot (day)</label><select value={snapshot} onChange={e=>setSnapshot(e.target.value)}>{snapshots.length?snapshots.map(s=><option key={s.date} value={s.date}>{s.date} — {s.contracts} open</option>):<option value="">No snapshots yet</option>}</select></div>)
    :<><div className="field compact-field"><label>From</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div className="field compact-field"><label>To</label><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div></>}
   <button type="button" className="btn btn-primary" disabled={busy||(source==='saved'&&notSetUp)} onClick={()=>void load(true)}><RefreshCw size={16}/>{busy?'Loading…':rows?'Reload':source==='saved'?'Show saved data':'Load from ERP'}</button>
   {rows?<button type="button" className="btn btn-outline" disabled={!shown.length} onClick={()=>void download()}><Download size={16}/>Download Excel</button>:null}
  </div>
  <div className="sub" style={{marginTop:6}}>{cur.note}{source==='saved'?' Each day the app pulls the report and keeps it; payments and documents accumulate, pending contracts are kept as one snapshot per day.':''}</div>
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  {rows&&!rows.length&&!error?<div className="empty" style={{marginTop:10}}>{source==='saved'?'Nothing saved for this selection yet — press "Sync now" to pull from the ERP.':'The ERP returned no rows for this selection.'}</div>:null}
  {rows?.length?<>
   {stale?<div className="notice warn" style={{marginTop:10}}>The newest record is dated {latest} — {stale} days ago. The ERP API may not be carrying recent entries yet, so compare with your uploaded reports before relying on it.</div>:null}
   <div style={{display:'flex',gap:26,marginTop:12,flexWrap:'wrap'}}>{stats.map(([l,v])=><div key={l}><div className="kpi-label">{l}</div><b style={{fontSize:20}}>{v}</b></div>)}<div><div className="kpi-label">Newest record</div><b style={{fontSize:20}}>{latest||'—'}</b></div></div>
   <div className="field compact-field" style={{marginTop:12,maxWidth:360}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search any column"/></div>
   <div className="table-wrap" style={{marginTop:8,maxHeight:'60vh',overflow:'auto'}}><table>
    {loadedFor==='pending'?<><thead><tr><th>Contract</th><th>Date</th><th>Supplier</th><th>Product</th><th style={{textAlign:'right'}}>Contract qty</th><th style={{textAlign:'right'}}>Received</th><th style={{textAlign:'right'}}>Balance</th><th style={{textAlign:'right'}}>Rate</th><th/></tr></thead><tbody>
     {shown.map((r,i)=>{const off=Math.abs(r.balanceQty-(r.contractQty-r.receivedQty))>0.01;return <tr key={i}><td>{r.contractNo}</td><td>{day(r.contractDate)}</td><td>{r.partyName}{r.brokerName?<div className="sub">Broker: {r.brokerName}</div>:null}</td><td>{r.productName}</td><td style={{textAlign:'right'}}>{q2(r.contractQty)}</td><td style={{textAlign:'right'}}>{q2(r.receivedQty)}</td><td style={{textAlign:'right',fontWeight:600}}>{q2(r.balanceQty)}</td><td style={{textAlign:'right'}}>{inr(r.rate)}</td><td>{off?<span className="sub" title="Balance is not contract minus received">check</span>:null}</td></tr>})}</tbody></>
    :loadedFor==='payments'?<><thead><tr><th>Date</th><th>Reference</th><th>Supplier</th><th>Bill / lot</th><th>Bank</th><th style={{textAlign:'right'}}>This bill</th><th style={{textAlign:'right'}}>Whole payment</th></tr></thead><tbody>
     {shown.map((r,i)=><tr key={i}><td>{day(r.paymentDate)}</td><td>{r.paymentReferenceNo}</td><td>{r.supplierName}{r.supplierLocationName?<div className="sub">{r.supplierLocationName}</div>:null}</td><td>{r.lotNumber||'—'}</td><td>{r.bankName}</td><td style={{textAlign:'right'}}>{inr(r.amount)}</td><td style={{textAlign:'right'}}>{inr(r.totalAmount)}</td></tr>)}</tbody></>
    :<><thead><tr><th>Date</th><th>Document</th><th>Type</th><th>Supplier</th><th>Material</th><th style={{textAlign:'right'}}>Qty</th><th style={{textAlign:'right'}}>Rate</th><th style={{textAlign:'right'}}>Total</th><th>Status</th></tr></thead><tbody>
     {shown.map((r,i)=><tr key={i}><td>{day(r.poDate)}</td><td>{r.poNumber}</td><td>{r.title}</td><td>{r.supplierName}</td><td>{r.materialName}</td><td style={{textAlign:'right'}}>{q2(r.orderedQty)}</td><td style={{textAlign:'right'}}>{inr(r.rate)}</td><td style={{textAlign:'right'}}>{inr(r.totalAmount)}</td><td>{r.status}</td></tr>)}</tbody></>}
   </table></div>
   <div className="sub" style={{marginTop:6}}>{shown.length===rows.length?`${rows.length} rows`:`${shown.length} of ${rows.length} rows`}{fetchedAt?` • read from the ERP at ${new Date(fetchedAt).toLocaleTimeString('en-GB')}`:''}</div>
  </>:null}

  {report==='pending'&&source==='saved'&&snapshots.length>1?<div style={{marginTop:14}}>
   <div className="section-title" style={{fontSize:14}}>Open contracts over time</div>
   <div className="table-wrap" style={{marginTop:6,maxHeight:220,overflow:'auto'}}><table><thead><tr><th>Day</th><th style={{textAlign:'right'}}>Open contracts</th><th style={{textAlign:'right'}}>Balance qty</th></tr></thead><tbody>{snapshots.map(s=><tr key={s.date}><td>{s.date}</td><td style={{textAlign:'right'}}>{s.contracts}</td><td style={{textAlign:'right'}}>{q2(s.balance)}</td></tr>)}</tbody></table></div>
  </div>:null}
 </section>;
}
