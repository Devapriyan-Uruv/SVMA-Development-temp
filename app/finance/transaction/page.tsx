'use client';
import {useMemo,useState} from 'react';
import {CircleAlert,Download,FileSpreadsheet,ReceiptText,Scale,Sparkles} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {Kpi} from '@/components/Kpi';
import {FinanceRecentRuns} from '@/components/FinanceRecentRuns';

type Files={weighment:File[];gateIn:File[];gateOut:File[];tally:File[]};
const emptyFiles:Files={weighment:[],gateIn:[],gateOut:[],tally:[]};
const TABS=['Main','Purchase','Sales','Job Work','Others','Exceptions','Gate Mapping','Tally Evidence'] as const;
type Tab=typeof TABS[number];
type Column<T>={label:string;value:(row:T)=>unknown};
function show(v:unknown):string{return v==null||v===''?'—':Array.isArray(v)?v.join(', '):String(v);}
function statusTone(status:string){if(status==='Reconciled')return 'ok';if(status==='Reconciled (AI)')return 'info';if(status==='Partial')return 'warn';if(status==='Not Found')return 'danger';if(status==='Review')return 'warn';return 'neutral';}

const PROCESSING_STAGES=['Validating file formats...','Reading weighment data...','Reading Gate In...','Reading Gate Out...','Parsing Tally...','Normalizing records...','Classifying transactions...','Matching Gate records...','Matching accounting vouchers...','Resolving remaining candidates...','Running AI reasoning...','Validating results...','Generating reports...'];

export default function TransactionPage(){
 const [files,setFiles]=useState<Files>(emptyFiles),[busy,setBusy]=useState(false),[downloading,setDownloading]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<any>(null),[tab,setTab]=useState<Tab>('Main'),[date,setDate]=useState(''),[search,setSearch]=useState('');
 const [stage,setStage]=useState(''),[completedStages,setCompletedStages]=useState<string[]>([]),[showPopup,setShowPopup]=useState(false),[detail,setDetail]=useState<any>(null);
 const ready=Object.values(files).every(values=>values.length);
 function changeFile(key:keyof Files,list:FileList|null){setFiles(old=>({...old,[key]:Array.from(list||[])}));setResult(null);setError('');}

 async function run(){
  if(!ready)return setError('Upload all four source reports.');
  setBusy(true);setError('');setResult(null);setCompletedStages([]);setStage(PROCESSING_STAGES[0]);
  try{
   const form=new FormData();for(const key of Object.keys(files) as (keyof Files)[])for(const file of files[key])form.append(key,file);if(date)form.append('reconciliationDate',date);
   const response=await fetch('/api/reconcile/ai-transaction',{method:'POST',body:form});
   if(!response.body)throw new Error('No response from server.');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(true){
    const {done,value}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    const lines=buffer.split('\n');buffer=lines.pop()||'';
    for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);
     if(event.type==='stage'){setCompletedStages(prev=>[...prev,event.label]);setStage(event.label);}
     else if(event.type==='result'){setResult(event.payload);setTab('Main');setSearch('');setShowPopup(true);}
     else if(event.type==='error')throw new Error(event.error);
    }
   }
  }catch(e){setError(e instanceof Error?e.message:'Reconciliation failed.');}finally{setBusy(false);setStage('');}
 }
 async function download(){
  setDownloading(true);setError('');
  try{const response=await fetch('/api/reconcile/ai-transaction/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});if(!response.ok){const data=await response.json();throw new Error(data.error||'Export failed.');}const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`SVMA_AI_Transaction_Reconciliation_${result.reconciliationDate}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(e){setError(e instanceof Error?e.message:'Export failed.');}finally{setDownloading(false);}
 }
 const rows:any[]=result?.transactions||[];
 // Every tab label shows a live count, so switching tabs (or typing in
 // search) was re-filtering the full row set once per tab, 8 times over,
 // on every render — with gate/tally candidate arrays attached to each row
 // this was the real source of the reported tab-switching lag. Computed
 // once per [rows, search] change instead of on every render.
 const byTabMap=useMemo(()=>{
  const filtered=rows.filter(r=>!search||[r.weighBridgeRef,r.vehicle,r.party,r.material,r.status,r.tallySelected?.map((v:any)=>v.vchNo).join(' ')].join(' ').toLowerCase().includes(search.toLowerCase()));
  const map=new Map<Tab,any[]>();
  for(const t of TABS)map.set(t,t==='Main'?filtered:t==='Exceptions'?filtered.filter(r=>r.status!=='Reconciled'&&r.status!=='Reconciled (AI)'&&r.category!=='Others'):filtered.filter(r=>r.category===t));
  return map;
 },[rows,search]);
 const byTab=(t:Tab)=>byTabMap.get(t)||[];

 return <><PageHeader title="AI Transaction Reconciliation" subtitle="Upload the four daily files and let the AI accountant reconcile them automatically." backHref="/finance" backLabel="Finance"/>
  <div className="hero compact-hero"><div><div className="section-kicker light">Weighment → Gate → Business Document → Tally</div><h2>Upload today's reports.</h2><p>Weighment Register, Gate In, Gate Out and Tally Day Book — matched, scored and explained automatically.</p></div><div className="hero-chip"><Sparkles size={14}/> Purchase · Sales · Job Work · Others</div></div>
  <div className="card" style={{marginTop:16}}><div className="section-title">Upload reports for another day</div>
   <div className="grid four upload-grid">{([['weighment','1. Weighment Register','One operational day'],['gateIn','2. Gate In','Supplier, vehicle and purchase order'],['gateOut','3. Gate Out','Customer, vehicle and sales order'],['tally','4. Tally Day Book','Purchase/Sales registers and supporting books']] as const).map(([key,label,hint])=><label key={key} className={`upload modern-upload ${files[key].length?'good':''}`}><b>{label}</b><span className="sub">{hint}</span><input aria-label={label} disabled={busy} type="file" accept=".xls,.xlsx" multiple={key==='gateIn'||key==='gateOut'} onChange={e=>changeFile(key,e.target.files)}/><span className="file-name">{files[key].map(f=>f.name).join(', ')||'Choose Excel file'}</span></label>)}</div>
   <div className="split-header" style={{marginTop:16,gap:16}}><label className="sub">Date override (only if needed)<input aria-label="Reconciliation date override" type="date" value={date} disabled={busy} onChange={e=>{setDate(e.target.value);setResult(null);}}/></label><button className="btn btn-primary" disabled={busy||!ready} onClick={run}>{busy?'Running AI Reconciliation…':'Run AI Reconciliation'}</button></div>
   {busy?<div className="notice" style={{marginTop:14}}><b>{stage}</b><ul style={{margin:'8px 0 0',paddingLeft:18,fontSize:12,color:'var(--ink-600,#5b6b85)'}}>{completedStages.slice(-6).map((s,i)=><li key={i}>{s}</li>)}</ul></div>:null}
  </div>
  {error?<div role="alert" className="notice danger" style={{marginTop:14}}>{error}</div>:null}
  {result?<>
   {result.warnings?.map((warning:string,i:number)=><div key={i} className="notice" role="status" style={{marginTop:10}}>{warning}</div>)}
   <div className="grid kpis modern-kpis" style={{marginTop:14}}>
    <Kpi icon={Scale} tone="blue" label="Reconciliation %" value={`${result.summary.reconciliationPercent}%`} foot="Purchase + Sales + Job Work only"/>
    <Kpi icon={Sparkles} tone="purple" label="Automation %" value={`${result.summary.automationPercent}%`} foot="Auto + AI resolved, no manual step"/>
    <Kpi icon={FileSpreadsheet} tone="green" label="Avg AI Confidence" value={`${result.summary.averageConfidence}%`} foot="Across all physical movements"/>
    <Kpi icon={CircleAlert} tone="amber" label="Exceptions" value={result.summary.exceptions+result.summary.review} foot={`${result.summary.exceptions} not found · ${result.summary.review} review`}/>
   </div>
   <div className="card" style={{marginTop:14}}><div className="split-header"><div><div className="section-title">Results for {result.reconciliationDate}</div><div className="sub">Purchase {result.summary.purchase} · Sales {result.summary.sales} · Job Work {result.summary.jobWork} · Others {result.summary.others}</div></div><button className="btn btn-primary" onClick={download} disabled={downloading}><Download size={15}/>{downloading?'Preparing Excel…':'Download Excel'}</button></div>
    <div className="tabs">{TABS.map(name=><button key={name} className={`tab ${tab===name?'active':''}`} onClick={()=>setTab(name)}>{name}{name!=='Main'?` (${byTab(name).length})`:''}</button>)}</div>
    <label className="sub">Find a vehicle, name, material or reference<input aria-label="Search reconciliation" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search results"/></label>
    <ResultTable tab={tab} rows={byTab(tab)} onOpen={setDetail}/>
   </div></>:null}
  <FinanceRecentRuns type="ai_transaction" title="Recent AI-reconciled runs"/>
  <FinanceRecentRuns type="transaction" title="Legacy reports (before the AI engine)" note="Name/reference presence only — no AI scoring or confidence. Still viewable and downloadable in their original format."/>
  {showPopup&&result?<div className="modal-overlay" onClick={()=>setShowPopup(false)}><div className="modal-panel" onClick={e=>e.stopPropagation()} style={{width:'min(480px,100%)'}}>
   <div className="modal-icon info"><Sparkles size={18}/></div>
   <h3>AI Reconciliation Completed</h3>
   <div style={{fontSize:13,lineHeight:1.7,color:'var(--ink-700,#33415c)'}}>
    <p style={{margin:'0 0 10px'}}><b>Overall Reconciliation:</b> {result.summary.reconciliationPercent}%<br/><b>Total Physical Movements:</b> {result.summary.totalWeighments}</p>
    <p style={{margin:'0 0 10px'}}>Purchase: {result.summary.purchase} · Sales: {result.summary.sales} · Job Work: {result.summary.jobWork} · Others: {result.summary.others}</p>
    <p style={{margin:'0 0 10px'}}>Fully Reconciled: {result.summary.fullyReconciled} · AI Reconciled: {result.summary.aiReconciled} · Partial: {result.summary.partial}<br/>Exceptions: {result.summary.exceptions} · Manual Review: {result.summary.review}</p>
    <p style={{margin:0}}><b>Average Match Confidence:</b> {result.summary.averageConfidence}%</p>
   </div>
   <div className="modal-actions" style={{marginTop:16}}><button className="btn btn-outline" onClick={()=>setShowPopup(false)}>View Results</button><button className="btn btn-primary" onClick={download} disabled={downloading}>Download Excel</button></div>
  </div></div>:null}
  {detail?<div className="mobile-nav-backdrop" style={{display:'block'}} onClick={()=>setDetail(null)}><div className="mobile-nav-drawer" style={{marginLeft:'auto',width:'min(94vw,620px)'}} onClick={e=>e.stopPropagation()}><button className="btn btn-outline" onClick={()=>setDetail(null)}>Close</button><AuditTrail t={detail}/></div></div>:null}
 </>;
}

function ResultTable({tab,rows,onOpen}:{tab:Tab;rows:any[];onOpen:(row:any)=>void}){
 const [page,setPage]=useState(0);const pageSize=50;
 if(!rows.length)return <div className="empty">No entries in this view.</div>;
 const pages=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.min(page,pages-1),slice=rows.slice(current*pageSize,(current+1)*pageSize);
 return <>
  <div className="sub" style={{margin:'12px 0'}}>{rows.length} entries{pages>1?` · Page ${current+1} of ${pages}`:''}</div>
  <div className="table-wrap"><table><thead><tr><th>S.No</th><th>Date</th><th>Vehicle</th><th>Party</th><th>Material</th><th>Net Weight</th><th>WB Ref</th><th>Category</th><th>Gate Pass</th><th>PO/SO</th><th>Tally Ref</th><th>Confidence %</th><th>Status</th><th>Comments</th></tr></thead>
   <tbody>{slice.map((r,i)=><tr key={r.weighmentId||i} className="row-clickable" onClick={()=>onOpen(r)} style={{cursor:'pointer'}}>
    <td>{r.serialNo}</td><td>{r.date}</td><td>{r.vehicle}</td><td>{r.party}</td><td>{r.material}</td><td>{show(r.netWeight)}</td><td>{r.weighBridgeRef}</td><td>{r.category}</td><td>{show(r.gate?.gp)}</td><td>{show(r.gate?.order)}</td><td>{show(r.tallySelected?.map((v:any)=>v.vchNo))}</td><td>{r.confidence}%</td><td><span className={`pill ${statusTone(r.status)}`}>{r.status}</span></td><td style={{whiteSpace:'pre-wrap',minWidth:220,maxWidth:420}}>{r.comments}</td>
   </tr>)}</tbody></table></div>
  {pages>1?<div style={{display:'flex',gap:12,marginTop:12}}><button className="btn" disabled={!current} onClick={()=>setPage(current-1)}>Previous</button><button className="btn" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Next</button></div>:null}
 </>;
}

function Metric({l,v}:{l:string;v:unknown}){return <div className="sub" style={{display:'flex',justifyContent:'space-between',gap:10,padding:'3px 0'}}><span>{l}</span><b style={{textAlign:'right'}}>{show(v)}</b></div>;}
function AuditTrail({t}:{t:any}){
 return <div style={{padding:'56px 8px 20px'}}>
  <div className="section-kicker">AUDIT TRAIL</div><h2>{t.weighBridgeRef} · {t.vehicle}</h2>
  <div className="grid" style={{gap:12}}>
   <div className="card tight"><b>1. Physical Movement (Weighment)</b><Metric l="Date" v={t.date}/><Metric l="Party" v={t.party}/><Metric l="Material" v={t.material}/><Metric l="Material family" v={t.materialFamily}/><Metric l="Net Weight" v={t.netWeight}/><Metric l="Category" v={t.category}/><Metric l="Category reason" v={t.categoryReason}/></div>
   <div className="card tight"><b>2. Gate Record</b>{t.gate?<><Metric l="Gate Pass" v={t.gate.gp}/><Metric l="Direction" v={t.gate.direction}/><Metric l="Party" v={t.gate.party}/><Metric l="Material" v={t.gate.material}/><Metric l="Order Ref" v={t.gate.order}/><Metric l="Invoice" v={t.gate.invoice}/><Metric l="Date" v={t.gate.date}/><div className="sub" style={{marginTop:6}}>{t.gateEvidence?.join('; ')}</div></>:<p className="sub">No Gate record selected.</p>}
    <div className="sub" style={{marginTop:8}}>{t.gateCandidatesAll?.length||0} candidate(s) considered, {t.gateRejectedCount||0} rejected.</div></div>
   <div className="card tight"><b>3. Business Document / Tally Voucher</b>{t.tallySelected?.length?t.tallySelected.map((v:any,i:number)=><div key={i} style={{marginBottom:8}}><Metric l="Voucher No." v={v.vchNo}/><Metric l="Order Ref" v={v.orderRef}/><Metric l="Type" v={v.vchType}/><Metric l="Register" v={v.sheetRole}/><Metric l="Date" v={v.date}/></div>):<p className="sub">No Tally voucher selected.</p>}
    <div className="sub" style={{marginTop:6}}>{t.tallyEvidence?.join('; ')}</div>
    {t.consolidatedWith?.length?<div className="notice info" style={{marginTop:8}}>Consolidated voucher — also covers weighment(s): {t.consolidatedWith.join(', ')}</div>:null}
    <div className="sub" style={{marginTop:8}}>{t.tallyCandidatesAll?.length||0} candidate(s) considered, {t.tallyRejectedCount||0} rejected.</div></div>
   <div className="card tight"><b>4. AI Decision</b><Metric l="Confidence" v={`${t.confidence}%`}/><Metric l="Band source" v={t.aiSource==='AI'?'AI second-pass reasoning':'Deterministic scoring'}/><Metric l="Status" v={t.status}/><Metric l="Exception code" v={t.exceptionCode}/><div className="notice" style={{marginTop:8}}>{t.comments}</div></div>
  </div>
 </div>;
}
