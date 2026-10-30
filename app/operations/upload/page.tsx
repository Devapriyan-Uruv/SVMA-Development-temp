'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {UploadCloud,Sparkles,Settings} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {OperationsNav} from '@/components/ops/OperationsNav';

const REPORT_TYPES:{value:string;label:string}[]=[
 {value:'feeding',label:'Feeding Details'},
 {value:'production',label:'Production Report'},
 {value:'stock_snapshot',label:'Stock Summary'},
 {value:'rm_batch_stock',label:'Raw Material Batch Wise Stock'},
 {value:'purchase_order_pending',label:'Purchase Order Pending'},
 {value:'purchase_details',label:'Purchase Details'},
 {value:'gate_in',label:'Gate In Entry'},
 {value:'gate_out',label:'Gate Out Entry'},
 {value:'time_office_in',label:'Time Office In (Inward Weighment)'},
 {value:'time_office_out',label:'Time Office Out (Outward Weighment)'},
 {value:'inward_qc',label:'Inward QC Report'},
 {value:'settlement_pending',label:'Settlement Pending Lot'},
 {value:'sale_order_details',label:'Sale Order Details'},
 {value:'sales_register',label:'Sales Register'},
 {value:'purchase_receipts',label:'Purchase Register (Lot Wise)'},
 {value:'brokerage',label:'Brokerage'},
 {value:'consumable_issue',label:'Consumable Issue'},
 {value:'eb_power_reading',label:'EB Power Reading'},
 {value:'freight_summary',label:'Freight Summary'},
 {value:'qc_pending_lots',label:'QC Pending Lots'},
 {value:'shut_down',label:'Shut Down'},
 {value:'solvent_daily_report',label:'Solvent Daily Report'},
 {value:'contract_pending',label:'Contract List Pending'},
 {value:'inward_payment',label:'Inward Payment'},
 {value:'purchase_summary',label:'Purchase Summary'},
 {value:'credit_debit_note',label:'Credit / Debit Note'},
];
const LABEL_OF:Record<string,string>=Object.fromEntries(REPORT_TYPES.map(t=>[t.value,t.label]));

type QueuedFile={
 file:File;id:string;status:'classifying'|'ready'|'needs_confirmation'|'uploading'|'done'|'failed';
 reportType:string;confidence:number;reason:string;result?:any;error?:string;
};

const REPORT_RUN_STATUS_TONE:Record<string,string>={PENDING:'neutral',NAVIGATING:'info',PAGE_FOUND:'info',DATE_APPLIED:'info',GENERATING:'info',DOWNLOADING:'info',DOWNLOADED:'info',VALIDATING:'info',PROCESSED:'ok',NEW_VERSION:'ok',PARTIALLY_NEW:'ok',DUPLICATE_SKIPPED:'neutral',NO_DATA:'neutral',NEEDS_NAVIGATION_REVIEW:'warn',REPORT_MISMATCH:'danger',FAILED:'danger'};
const REPORT_RUN_STATUS_LABEL:Record<string,string>={PENDING:'Waiting',NAVIGATING:'Navigating…',PAGE_FOUND:'Page found',DATE_APPLIED:'Date applied',GENERATING:'Generating…',DOWNLOADING:'Downloading…',DOWNLOADED:'Downloaded',VALIDATING:'Validating…',PROCESSED:'Processed',NEW_VERSION:'New version',PARTIALLY_NEW:'Partially new',DUPLICATE_SKIPPED:'Duplicate skipped',NO_DATA:'No data',NEEDS_NAVIGATION_REVIEW:'Needs navigation review',REPORT_MISMATCH:'Report mismatch',FAILED:'Failed'};
const RUN_ACTIVE=new Set(['PENDING','RUNNING']);

function ErpPushCard(){
 const [summary,setSummary]=useState<any>(null);
 const [erpDate,setErpDate]=useState('');
 const [pickingDate,setPickingDate]=useState(false);
 const [syncRunId,setSyncRunId]=useState<string|null>(null);
 const [run,setRun]=useState<any>(null);
 const [reportRuns,setReportRuns]=useState<any[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 function loadSummary(){fetch('/api/ops/erp-push').then(r=>r.json()).then(j=>{setSummary(j);setErpDate(d=>d||j.dataDate)}).catch(()=>{})}
 useEffect(loadSummary,[]);

 useEffect(()=>{
  if(!syncRunId)return;
  let cancelled=false;
  const poll=async()=>{
   try{
    const r=await fetch(`/api/ops/erp-push/status?syncRunId=${syncRunId}`);
    const j=await r.json();
    if(cancelled)return;
    setRun(j.run);setReportRuns(j.reportRuns||[]);
    if(j.run&&RUN_ACTIVE.has(j.run.status)){if(!cancelled)setTimeout(poll,3000)}else{loadSummary()}
   }catch{if(!cancelled)setTimeout(poll,3000)}
  };
  poll();
  return ()=>{cancelled=true};
 },[syncRunId]);

 async function startPush(){
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/ops/erp-push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reportDate:erpDate})});
   const j=await r.json();
   if(!r.ok)throw new Error(j.error||'Could not start the push');
   setSyncRunId(j.syncRunId);setRun({status:'PENDING'});setReportRuns([]);
  }catch(e){setError(e instanceof Error?e.message:'Could not start the push')}
  finally{setBusy(false)}
 }

 if(!summary)return null;
 const notSetUp=(summary.verifiedReports||0)===0;
 const isRunning=run&&RUN_ACTIVE.has(run.status);
 const bySection=reportRuns.reduce((acc:Record<string,any[]>,r:any)=>{const s=r.ops_erp_report_catalog?.erp_section||'OTHER';(acc[s]=acc[s]||[]).push(r);return acc},{});

 return <section className="card" style={{marginTop:16}}>
  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><Sparkles size={16}/><b>Uruv ERP DATA PUSH</b><span className="pill neutral">Automatic — separate from manual upload</span></div>
  {notSetUp?<div className="notice" style={{marginBottom:10}}>This automatic pull from the ERP is not set up yet, so it cannot fetch any reports. <b>To load your files, use "Upload files manually" above</b> and click <b>Process All</b>.</div>:<p className="sub" style={{marginBottom:6}}>{summary.verifiedReports} of {summary.requiredReports+summary.optionalReports} ERP reports are set up for automatic pull.</p>}

  {!isRunning?<>
   <div className="split-header" style={{alignItems:'flex-end'}}>
    <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
     <div>
      <div className="sub">Data Date</div>
      {pickingDate?<input type="date" value={erpDate} onChange={e=>setErpDate(e.target.value)} onBlur={()=>setPickingDate(false)} autoFocus/>:<div style={{fontSize:18,fontWeight:600}}>{erpDate}</div>}
      <button className="text-link" style={{fontSize:11,marginTop:2}} onClick={()=>setPickingDate(v=>!v)}>{pickingDate?'Done':'Select Different Date'}</button>
     </div>
     <div><div className="sub">Source</div><div>SVMA ERP</div></div>
     <div><div className="sub">Required Reports</div><div>{summary.requiredReports}</div></div>
     <div><div className="sub">Optional Reports</div><div>{summary.optionalReports}</div></div>
     <div><div className="sub">Last Successful Push</div><div>{summary.lastSuccessfulPush?`${summary.lastSuccessfulPush.reportDate} · ${new Date(summary.lastSuccessfulPush.completedAt).toLocaleString('en-IN')}`:'Never'}</div></div>
    </div>
    <button className="btn btn-primary" disabled={busy||notSetUp} title={notSetUp?'Not set up yet — upload the files manually instead':undefined} onClick={startPush}>{busy?'Starting…':'Push Operations Data'}</button>
   </div>
   <p className="sub" style={{marginTop:8}}>The SVMA team updates the previous day's ERP data, so AIX3 has selected yesterday automatically.</p>
   <Link href="/operations/erp-config" className="text-link" style={{display:'inline-flex',alignItems:'center',gap:4,marginTop:6,fontSize:11}}><Settings size={12}/>ERP Configuration</Link>
  </>:null}

  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}

  {run?<div style={{marginTop:14}}>
   <div className="section-title">{isRunning?`AIX3 is connecting to SVMA ERP — ${erpDate}`:run.status==='FAILED'?'Push failed':'Push complete'}</div>
   {!isRunning&&run.status==='FAILED'&&run.metadata?.error?<div className="notice danger" style={{marginTop:8}}>{run.metadata.error}</div>:null}
   {Object.entries(bySection).map(([section,rows])=><div key={section} style={{marginTop:10}}>
    <div className="sub" style={{textTransform:'uppercase',fontSize:10,letterSpacing:'.05em',marginBottom:4}}>{section} REPORTS</div>
    <table style={{width:'100%'}}><tbody>
     {rows.map((r:any)=><tr key={r.id}><td style={{padding:'3px 0'}}>{r.ops_erp_report_catalog?.report_name}</td><td style={{textAlign:'right'}}><StatusBadge status={REPORT_RUN_STATUS_TONE[r.status]||'neutral'} label={REPORT_RUN_STATUS_LABEL[r.status]||r.status}/></td></tr>)}
    </tbody></table>
   </div>)}

   {!isRunning&&run?<div style={{marginTop:16,padding:'12px 14px',background:'var(--panel-soft,#f6f8fb)',borderRadius:12}}>
    <b>OPERATIONS DATA PUSH {run.status==='FAILED'?'FAILED':'COMPLETE'}</b>
    <div className="ceo-health-row" style={{marginTop:8}}>
     <div><span>Requested</span><b>{run.reports_requested}</b></div>
     <div><span>Downloaded</span><b>{run.reports_success}</b></div>
     <div><span>Duplicate</span><b>{run.reports_duplicate}</b></div>
     <div><span>No Data</span><b>{run.reports_no_data}</b></div>
     <div><span>Needs Review</span><b>{run.reports_need_review}</b></div>
     <div><span>Failed</span><b>{run.reports_failed}</b></div>
    </div>
    <div className="ceo-health-row" style={{marginTop:8}}>
     <div><span>New Records</span><b>{run.new_record_count}</b></div>
     <div><span>Changed Records</span><b>{run.changed_record_count}</b></div>
     <div><span>Exceptions</span><b>{run.exception_count}</b></div>
     <div><span>Tickets Created</span><b>{run.ticket_count}</b></div>
    </div>
    <div style={{display:'flex',gap:10,marginTop:12,flexWrap:'wrap'}}>
     <Link className="btn btn-outline" href="/ceo">View Control Tower</Link>
     <Link className="btn btn-outline" href="/operations/exceptions">View Exceptions</Link>
     {(run.reports_failed>0||run.reports_need_review>0||run.status==='FAILED')?<Link className="btn btn-outline" href="/operations/erp-config">Review Navigation</Link>:null}
    </div>
   </div>:null}
  </div>:null}
 </section>;
}

export default function OpsUploadPage(){
 const [queue,setQueue]=useState<QueuedFile[]>([]);
 const [dragOver,setDragOver]=useState(false);
 const [browseType,setBrowseType]=useState('feeding');
 const [batches,setBatches]=useState<any[]>([]);
 const inputRef=useRef<HTMLInputElement>(null);
 // canProcess (below) stays true for the whole duration of a run — it only
 // checks each item's own status, and processAll only flips ONE item to
 // 'uploading' at a time, so every other still-'ready' item keeps the button
 // enabled. A second click during a run was confirmed live to start a second
 // independent sequential loop over the same file list, doubling server load
 // and racing the same files' dedup checks against each other. A ref (not
 // state) guards re-entry synchronously, before React even re-renders the
 // disabled button.
 const processingRef=useRef(false);
 const [isProcessing,setIsProcessing]=useState(false);

 function loadBatches(){fetch(`/api/ops/batches?reportType=${browseType}`).then(r=>r.json()).then(j=>setBatches(j.batches||[])).catch(()=>{})}
 useEffect(()=>{loadBatches()},[browseType]);

 async function classify(item:QueuedFile){
  try{
   const fd=new FormData();fd.append('file',item.file);
   const r=await fetch('/api/ops/classify',{method:'POST',body:fd});
   const j=await r.json();
   if(!r.ok)throw new Error(j.error||'Classification failed');
   setQueue(q=>q.map(x=>x.id===item.id?{...x,status:j.needsConfirmation?'needs_confirmation':'ready',reportType:j.reportType||'',confidence:j.confidence||0,reason:j.reason||''}:x));
  }catch(e){
   setQueue(q=>q.map(x=>x.id===item.id?{...x,status:'needs_confirmation',reason:e instanceof Error?e.message:'Classification failed — choose the report type manually.'}:x));
  }
 }

 function addFiles(files:FileList|File[]){
  const arr=Array.from(files).filter(f=>/\.xlsx?$/i.test(f.name));
  const items:QueuedFile[]=arr.map(f=>({file:f,id:`${f.name}-${f.size}-${Date.now()}-${Math.random()}`,status:'classifying',reportType:'',confidence:0,reason:''}));
  setQueue(q=>[...q,...items]);
  for(const item of items)classify(item);
 }

 function setReportType(id:string,type:string){setQueue(q=>q.map(x=>x.id===id?{...x,reportType:type}:x))}

 async function processAll(){
  if(processingRef.current)return;
  processingRef.current=true;setIsProcessing(true);
  try{
   for(const item of queue){
    if(item.status==='done'||item.status==='uploading'||!item.reportType)continue;
    setQueue(q=>q.map(x=>x.id===item.id?{...x,status:'uploading'}:x));
    try{
     const fd=new FormData();fd.append('reportType',item.reportType);fd.append('file',item.file);
     const r=await fetch('/api/ops/upload',{method:'POST',body:fd});
     const j=await r.json();
     if(!r.ok)throw new Error(j.error||'Upload failed');
     setQueue(q=>q.map(x=>x.id===item.id?{...x,status:'done',result:j}:x));
    }catch(e){
     setQueue(q=>q.map(x=>x.id===item.id?{...x,status:'failed',error:e instanceof Error?e.message:'Upload failed'}:x));
    }
   }
   loadBatches();
  }finally{processingRef.current=false;setIsProcessing(false)}
 }

 const identified=queue.filter(x=>x.reportType).length;
 const autoReadyOrDone=queue.filter(x=>x.status==='ready'||x.status==='done').length;
 const needsConfirm=queue.filter(x=>x.status==='needs_confirmation').length;
 const canProcess=queue.some(x=>x.reportType&&x.status!=='done'&&x.status!=='uploading');

 return <>
  <PageHeader title="Operations Data Hub" subtitle="Drop today's operations files together — AIX3 identifies each report; confirm anything it's unsure about. Every upload is checked for exact-duplicate files and, where relevant, versioned by date." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>

  <section className="card" style={{marginTop:16}}>
   <div className="split-header">
    <div>
     <div className="section-title">Upload files manually</div>
     <p className="sub" style={{marginTop:2}}>1. Choose the ERP files &nbsp;›&nbsp; 2. Check each report type &nbsp;›&nbsp; 3. Click <b>Process All</b> to load them into the database.</p>
    </div>
    <button className="btn btn-primary" onClick={()=>inputRef.current?.click()}><UploadCloud size={16}/> Upload Files</button>
   </div>
   <div className={`${dragOver?'drag-over':''}`} style={{marginTop:12,padding:24,textAlign:'center',border:'2px dashed var(--border-color,#d0d5dd)',borderRadius:12,cursor:'pointer'}}
    onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)}
    onDrop={e=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files?.length)addFiles(e.dataTransfer.files)}}
    onClick={()=>inputRef.current?.click()}>
    <UploadCloud size={26}/>
    <p style={{marginTop:6,marginBottom:2}}><b>Or drag and drop multiple files here</b></p>
    <p className="sub">.xls or .xlsx — Production, Stock, Feeding, Raw Material, Purchase, Gate, QC, Sales and more</p>
    <input ref={inputRef} type="file" accept=".xls,.xlsx" multiple style={{display:'none'}} onClick={e=>e.stopPropagation()} onChange={e=>{if(e.target.files?.length)addFiles(e.target.files);e.target.value=''}}/>
   </div>
  </section>

  {queue.length?<section className="card" style={{marginTop:16}}>
   <div className="split-header">
    <div className="sub">{identified} report{identified===1?'':'s'} identified. {autoReadyOrDone} processed automatically or ready. {needsConfirm} need{needsConfirm===1?'s':''} confirmation.</div>
    <button className="btn btn-primary" onClick={processAll} disabled={!canProcess||isProcessing}>{isProcessing?'Processing…':'Process All'}</button>
   </div>
   <div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>File</th><th>AIX3 classification</th><th>Confidence</th><th>Report type</th><th>Status</th></tr></thead><tbody>
    {queue.map(item=><tr key={item.id}>
     <td>{item.file.name}</td>
     <td style={{minWidth:220}}>{item.status==='classifying'?'Classifying…':(item.reason||(item.reportType?`Identified as ${LABEL_OF[item.reportType]}`:'Could not classify'))}</td>
     <td>{item.confidence?`${Math.round(item.confidence*100)}%`:'—'}</td>
     <td><select value={item.reportType} onChange={e=>setReportType(item.id,e.target.value)} disabled={item.status==='uploading'||item.status==='done'}><option value="">— choose —</option>{REPORT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></td>
     <td>{item.status==='done'?<span className="pill ok">{item.result?.message||'Done'}</span>:item.status==='failed'?<span className="pill danger">{item.error}</span>:item.status==='uploading'?<span className="pill neutral">Uploading…</span>:item.status==='needs_confirmation'?<span className="pill warn">Needs confirmation</span>:item.status==='classifying'?<span className="pill neutral">Classifying…</span>:<span className="pill info">Ready</span>}</td>
    </tr>)}
   </tbody></table></div>
  </section>:null}


  <ErpPushCard/>

  <section className="card" style={{marginTop:16}}>
   <div className="split-header"><div className="section-title">Recent uploads</div><select value={browseType} onChange={e=>setBrowseType(e.target.value)}>{REPORT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
   <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Date</th><th>File</th><th>Status</th><th>Version</th><th>New / Dup / Corrections</th><th>Uploaded</th></tr></thead><tbody>
    {batches.map(b=><tr key={b.id}><td>{b.report_date||'—'}</td><td>{b.file_name}</td><td><span className={`pill ${b.status==='completed'?'ok':b.status==='duplicate_file'?'warn':b.status==='failed'?'danger':'neutral'}`}>{b.status}</span>{!b.is_active?<span className="pill neutral" style={{marginLeft:4}}>superseded</span>:null}</td><td>v{b.version_no}</td><td>{b.new_row_count}/{b.duplicate_row_count}/{b.correction_flagged_count}</td><td>{new Date(b.created_at).toLocaleString('en-IN')}</td></tr>)}
    {!batches.length?<tr><td colSpan={6} className="sub">No uploads yet for this report type.</td></tr>:null}
   </tbody></table></div>
  </section>
 </>;
}
