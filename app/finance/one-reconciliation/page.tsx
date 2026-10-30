'use client';
import {Fragment,useMemo,useRef,useState} from 'react';
import {CircleAlert,Download,FileUp,GitBranch,Play,RefreshCw,Sparkles} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {COLUMNS,columnsFor,SECTION_COLORS,STATUS_PRIORITY,type Col,type OneReconResult,type MasterRow} from '@/lib/oneReconciliation/master';

type Files={weighment:File[];gateIn:File[];gateOut:File[];tally:File[]};
const emptyFiles:Files={weighment:[],gateIn:[],gateOut:[],tally:[]};
const CARD_STATUSES=['FULLY MATCHED','PARTIAL MATCH','QC MISSING','ERP MISSING','TALLY MISSING','SETTLEMENT PENDING','CN/DN PENDING','AMOUNT MISMATCH','QUANTITY MISMATCH','OIL MISMATCH','REVIEW REQUIRED','NOT MATCHED'] as const;
const TYPES=['Direct Purchase','Indirect Purchase','Purchase','Sales','Inter/Job Work','Others'] as const;
const TYPE_LABEL:Record<string,string>={Purchase:'Purchase (type not identified)'};
const TEXT_FILTERS:{key:string;label:string}[]=[{key:'party',label:'Supplier / Customer'},{key:'material',label:'Material'},{key:'vehicle',label:'Vehicle'},{key:'supplierInvoice',label:'Supplier Invoice'},{key:'po',label:'PO'},{key:'so',label:'SO'},{key:'lot',label:'Lot'},{key:'erpInvoice',label:'ERP Invoice'}];
const FROZEN_LEFT=[0,150,290]; // px offsets of the three frozen key columns
const FROZEN_W=[150,140,120];
const LBL:React.CSSProperties={display:'grid',gap:4};
const KEYS=COLUMNS.filter(c=>c.freeze).map(c=>c.key);

function tone(status:string){if(status==='FULLY MATCHED')return 'ok';if(status==='PARTIAL MATCH'||status.endsWith('PENDING')||status.endsWith('MISSING'))return 'warn';return 'danger';}
function fmtCell(col:Col,v:string|number|undefined):{text:string;flag:'nf'|'na'|null}{
 if(v===undefined||v===null||v==='')return {text:'Not Found',flag:'nf'};
 if(v==='Not Found')return {text:'Not Found',flag:'nf'};
 if(v==='N/A')return {text:'N/A',flag:'na'};
 if(typeof v==='number'){
  if(col.fmt==='money')return {text:`${v<0?'-':''}₹${Math.abs(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`,flag:null};
  if(col.fmt==='qty')return {text:v.toLocaleString('en-IN',{maximumFractionDigits:3}),flag:null};
  if(col.fmt==='pct')return {text:`${v.toFixed(2)}%`,flag:null};
  return {text:String(v),flag:null};
 }
 if(col.fmt==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(v)){const d=new Date(`${v}T00:00:00Z`);return {text:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).replace(/ /g,'-'),flag:null};}
 return {text:v,flag:null};
}

export default function OneReconciliationPage(){
 const [files,setFiles]=useState<Files>(emptyFiles),[extra,setExtra]=useState<File[]>([]),[busy,setBusy]=useState(false),[downloading,setDownloading]=useState(false),[error,setError]=useState('');
 const [result,setResult]=useState<(OneReconResult&{savedRunId?:string|null;dates?:{date:string;runCode:string;transactions:number}[]})|null>(null),[date,setDate]=useState('');
 const [status,setStatus]=useState<string>('ALL'),[type,setType]=useState<string>('ALL'),[dateFilter,setDateFilter]=useState(''),[text,setText]=useState<Record<string,string>>({});
 const [detail,setDetail]=useState<MasterRow|null>(null),[page,setPage]=useState(0);
 const [pmBusy,setPmBusy]=useState(false),[pmMsg,setPmMsg]=useState('');
 const [view,setView]=useState<'latest'|'ledger'>('latest'),[ledgerBusy,setLedgerBusy]=useState(false);
 const uploadRef=useRef<HTMLDivElement>(null);
 const ready=Object.values(files).every(v=>v.length);
 const setFile=(key:keyof Files,list:FileList|null)=>{setFiles(o=>({...o,[key]:Array.from(list||[])}));setResult(null);setError('');};

 async function run(){
  if(!ready)return setError('Upload the Weighment, Gate In, Gate Out and Tally Day Book reports first.');
  setBusy(true);setError('');setResult(null);
  try{
   const form=new FormData();
   for(const key of Object.keys(files) as (keyof Files)[])if(key!=='tally')for(const f of files[key])form.append(key,f);
   // The Day Book is the big file (a full year is 8 MB+ and needs ~500 MB to open): read it here and send only the parsed vouchers.
   const t=files.tally[0],XLSX=await import('xlsx'),[{parseTallyUpload},{parseTallyLedger}]=await Promise.all([import('@/lib/reconciliation/parsers'),import('@/lib/oneReconciliation/tallyLedger')]);
   let book;try{book=XLSX.read(await t.arrayBuffer(),{type:'array',cellDates:true});}catch{throw new Error('The Tally Day Book could not be opened. Upload it as .xlsx/.xls.');}
   const parsed={file:t.name,sheet:book.SheetNames[0]||'',vouchers:parseTallyUpload(book,t.name).vouchers.map(v=>({...v,details:[],sources:v.sources.slice(0,1)})), // the engine reads neither the detail lines nor more than the first source row
   ledger:parseTallyLedger(book,t.name)};
   const json=JSON.stringify(parsed);
   const zipped=typeof CompressionStream!=='undefined'?await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob():null;
   if(!zipped)throw new Error('This browser cannot compress the Day Book — please use a current Chrome, Edge or Safari.');
   form.append('tallyParsed',new File([zipped],'tally.json.gz'));
   for(const f of extra)form.append('reports',f);
   if(date)form.append('reconciliationDate',date);
   const r=await fetch('/api/reconcile/one',{method:'POST',body:form});
   // Read the body as text first: a stopped/restarted server returns an empty or non-JSON body, and r.json()
   // would only say "Unexpected end of JSON input". Say what actually happened instead.
   const raw=await r.text();let payload:any=null;try{payload=raw?JSON.parse(raw):null}catch{payload=null}
   if(!payload)throw new Error(`The server did not return a result (HTTP ${r.status}${raw?'':', empty response'}). The run may have been too large for the server or it restarted — please try again, or upload a shorter period.`);
   if(!r.ok)throw new Error(payload.error||'Reconciliation failed.');
   setResult(payload);setStatus('ALL');setType('ALL');setDateFilter('');setText({});setPage(0);setView('latest');
  }catch(e){setError(e instanceof Error?e.message:'Reconciliation failed.');}finally{setBusy(false);}
 }
 async function loadLedger(){
  setLedgerBusy(true);setError('');
  try{
   const r=await fetch('/api/reconcile/one/history');
   const payload=await r.json();
   if(!r.ok)throw new Error(payload.error||'Unable to load the consolidated ledger.');
   setResult(payload);setStatus('ALL');setType('ALL');setDateFilter('');setText({});setPage(0);setView('ledger');
  }catch(e){setError(e instanceof Error?e.message:'Unable to load the consolidated ledger.');}finally{setLedgerBusy(false);}
 }
 async function download(){
  if(!result)return;
  setDownloading(true);setError('');
  try{
   // The export posts back the whole on-screen result. A multi-week or multi-month run is many MB of JSON and the
   // server only buffers the first 10 MB of a request body, so it is gzip-compressed first (JSON shrinks ~10x).
   const json=JSON.stringify(result);
   let body:BodyInit=json;const headers:Record<string,string>={'Content-Type':'application/json'};
   if(typeof CompressionStream!=='undefined'){body=await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();headers['Content-Type']='application/octet-stream';headers['X-Body-Encoding']='gzip';}
   const r=await fetch('/api/reconcile/one/export',{method:'POST',headers,body});
   if(!r.ok){const raw=await r.text();let d:any=null;try{d=raw?JSON.parse(raw):null}catch{d=null}throw new Error(d?.error||`The export did not complete (HTTP ${r.status}${raw?'':', empty response'}). Please try again.`);}
   const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='SVMA_One_Reconciliation.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:'Export failed.');}finally{setDownloading(false);}
 }
 async function refreshMaster(list:FileList|null){
  const f=list?.[0];if(!f)return;
  setPmBusy(true);setPmMsg('');
  try{
   const form=new FormData();form.append('productMaster',f);
   const r=await fetch('/api/reconcile/one/product-master',{method:'POST',body:form}),d=await r.json();
   if(!r.ok)throw new Error(d.error||'Product Master refresh failed.');
   setPmMsg(`Product Master refreshed — ${d.processed} products read. Re-run the reconciliation to apply.`);
  }catch(e){setPmMsg(e instanceof Error?e.message:'Product Master refresh failed.');}finally{setPmBusy(false);}
 }

 const baseRows=result?.rows||[];
 // The Sales view also lists sales to group companies (Inter/Job Work rows that carry an ERP sales invoice, laid out as sales) and ERP sales invoices with no weighment row. Every other view is unchanged.
 const rows=useMemo(()=>type==='Sales'?[...baseRows.filter(r=>r.transactionType==='Sales'),...baseRows.filter(r=>r.salesView).map(r=>({...r,transactionType:'Sales' as const,v:r.salesView!})),...(result?.salesNoWeighment||[])]:baseRows,[baseRows,type,result]);
 const filtered=useMemo(()=>rows.filter(r=>{
  if(status!=='ALL'&&!r.statuses.includes(status as any))return false;
  if(type!=='ALL'&&r.transactionType!==type)return false;
  if(dateFilter&&r.v.date!==dateFilter)return false;
  for(const [k,q] of Object.entries(text)){if(q&&!String(r.v[k]??'').toLowerCase().includes(q.toLowerCase()))return false;}
  return true;
 }),[rows,status,type,dateFilter,text]);
 const pageSize=50,pages=Math.max(1,Math.ceil(filtered.length/pageSize)),current=Math.min(page,pages-1),slice=filtered.slice(current*pageSize,(current+1)*pageSize);

 // Contiguous section spans for the header band.
 // Direct / Indirect Purchase show their own Finance template layout.
 const cols=columnsFor(type);
 const bands=useMemo(()=>{const out:{section:Col['section'];span:number}[]=[];for(const c of cols){const last=out[out.length-1];if(last&&last.section===c.section)last.span++;else out.push({section:c.section,span:1});}return out;},[cols]);
 const stickyStyle=(i:number,head=false):React.CSSProperties=>i<3?{position:'sticky',left:FROZEN_LEFT[i],minWidth:FROZEN_W[i],maxWidth:FROZEN_W[i],zIndex:head?4:2,background:head?'#edf4fb':'#fff',boxShadow:i===2?'2px 0 0 var(--line)':undefined}:{};

 return <>
  <PageHeader title="One Reconciliation System" subtitle="One engine, one Recon ID and one consolidated row per transaction — Weighment → ERP → QC → Settlement → Resettlement → Tally → Variance." backHref="/finance" backLabel="Finance"/>
  <div className="card tight" style={{marginTop:6,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
   <button className="btn btn-outline" onClick={()=>uploadRef.current?.scrollIntoView({behavior:'smooth'})}><FileUp size={15}/>Upload Reports</button>
   <button className="btn btn-primary" disabled={busy||!ready} onClick={run}><Play size={15}/>{busy?'Running Reconciliation…':'Run Reconciliation'}</button>
   <button className="btn btn-outline" disabled={!result||downloading} onClick={download}><Download size={15}/>{downloading?'Preparing Excel…':'Export Excel'}</button>
   <button className="btn btn-outline" disabled={busy||!ready||!result} onClick={run}><RefreshCw size={15}/>Re-run</button>
   <span style={{width:1,alignSelf:'stretch',background:'var(--line)'}}/>
   <button className={`btn ${view==='ledger'?'btn-secondary':'btn-outline'}`} disabled={ledgerBusy} onClick={loadLedger}><GitBranch size={15}/>{ledgerBusy?'Loading Ledger…':'Consolidated Ledger (All Days)'}</button>
   {result?<span className="sub" style={{marginLeft:'auto'}}>{view==='ledger'?'Ledger':`Run ${result.runId}`} · {result.reconciliationDate}</span>:null}
  </div>

  <div ref={uploadRef} className="card" style={{marginTop:14}}>
   <div className="section-title">Upload reports</div>
   <div className="grid four upload-grid">{([['weighment','1. Weighment Register','Vehicle, material, weights, Lot No'],['gateIn','2. Gate In','Supplier, vehicle, PO, supplier invoice'],['gateOut','3. Gate Out','Customer, vehicle, SO / invoice'],['tally','4. Tally Day Book','Vouchers with New Ref / Agst Ref lines']] as const).map(([key,label,hint])=><label key={key} className={`upload modern-upload ${files[key].length?'good':''}`}><b>{label}</b><span className="sub">{hint}</span><input aria-label={label} disabled={busy} type="file" accept=".xls,.xlsx" multiple={key==='gateIn'||key==='gateOut'} onChange={e=>setFile(key,e.target.files)}/><span className="file-name">{files[key].map(f=>f.name).join(', ')||'Choose Excel file'}</span></label>)}</div>
   <div className="grid two" style={{marginTop:14}}>
    <label className={`upload modern-upload ${extra.length?'good':''}`}><b>Additional reports (optional, any number)</b><span className="sub">ERP Purchase Register, Inward QC, Settlement, Credit/Debit Note (also the source for the GST/charges columns), Sales Register, Time Office In… Each file is identified automatically.</span><input aria-label="Additional reports" disabled={busy} type="file" accept=".xls,.xlsx" multiple onChange={e=>{setExtra(Array.from(e.target.files||[]));setResult(null);}}/><span className="file-name">{extra.length?`${extra.length} file(s): ${extra.map(f=>f.name).join(', ')}`:'Choose Excel files'}</span></label>
    <label className="upload modern-upload"><b>Refresh Product Master (optional)</b><span className="sub">Upload an updated ProductList (FG / RM / PM sheets). Adds and updates products; never deletes any.</span><input aria-label="Refresh Product Master" disabled={pmBusy||busy} type="file" accept=".xls,.xlsx" onChange={e=>refreshMaster(e.target.files)}/><span className="file-name">{pmBusy?'Updating Product Master…':pmMsg||'Choose ProductList file'}</span></label>
   </div>
   <div className="split-header" style={{marginTop:14,gap:16}}><label className="sub">Date override (only if needed)<input aria-label="Reconciliation date override" type="date" value={date} disabled={busy} onChange={e=>{setDate(e.target.value);setResult(null);}}/></label><span className="sub">Uploaded reports take priority; anything not uploaded is read from the Operations database.</span></div>
  </div>

  {error?<div role="alert" className="notice danger" style={{marginTop:14}}>{error}</div>:null}
  {busy?<div className="notice" role="status" style={{marginTop:14}}>Reading every report, matching products to the Product Master and walking each transaction through ERP, QC, Settlement and Tally — this can take up to a minute.</div>:null}

  {result?<>
   {result.warnings.map((w,i)=><div key={i} className="notice warn" role="status" style={{marginTop:10}}>{w}</div>)}
   <details className="card tight" style={{marginTop:14}}><summary style={{cursor:'pointer',fontWeight:800}}><Sparkles size={14} style={{verticalAlign:'-2px'}}/> Reports understood ({result.understanding.filter(u=>u.status==='used').length} used of {result.understanding.length})</summary>
    <div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>File</th><th>Identified as</th><th>How</th><th>Rows</th><th>Status</th><th>Note</th></tr></thead><tbody>{result.understanding.map((u,i)=><tr key={i}><td>{u.file}</td><td>{u.label}</td><td>{u.method}</td><td>{u.rows}</td><td><span className={`pill ${u.status==='used'?'ok':u.status==='error'?'danger':'warn'}`}>{u.status.toUpperCase()}</span></td><td style={{whiteSpace:'normal',minWidth:260}}>{u.note}</td></tr>)}</tbody></table></div>
   </details>
   {view==='latest'&&result.unlinked?.length?<details className="card tight" style={{marginTop:14}}><summary style={{cursor:'pointer',fontWeight:800}}><CircleAlert size={14} style={{verticalAlign:'-2px'}}/> ERP receipts / Tally bookings with no weighment ({result.unlinked.length}) <span className="sub" style={{fontWeight:400}}>— ERP {result.summary.unlinkedErp??0} · Tally {result.summary.unlinkedTally??0}. Also on the UNLINKED RECORDS sheet of the download.</span></summary>
    <div className="table-wrap" style={{marginTop:10,maxHeight:420,overflow:'auto'}}><table><thead><tr><th>Source</th><th>Date</th><th>Reference</th><th>Lot</th><th>Party</th><th>Vehicle</th><th>Qty (MT)</th><th>Amount</th><th>Tally</th><th>Nearest weighments</th><th>Why it may be unlinked</th></tr></thead><tbody>{result.unlinked.slice(0,300).map((u,i)=><tr key={i}><td>{u.source}</td><td>{u.date}</td><td>{u.reference}</td><td>{u.lot}</td><td>{u.party}</td><td>{u.vehicle}</td><td>{u.quantityMt??''}</td><td>{u.amount??''}</td><td>{u.tallyVoucher}</td><td style={{whiteSpace:'normal',minWidth:220}}>{u.nearestWeighments}</td><td style={{whiteSpace:'normal',minWidth:300}}>{u.reason}</td></tr>)}</tbody></table></div>
    {result.unlinked.length>300?<div className="sub" style={{marginTop:6}}>Showing the first 300 — the downloaded workbook has all {result.unlinked.length}.</div>:null}
   </details>:null}

   <div className="card" style={{marginTop:14}}>
    <div className="section-title" style={{display:'flex',alignItems:'center',gap:8}}><GitBranch size={17}/>{view==='ledger'?`One Reconciliation – Consolidated Ledger (${result.dates?.length||0} day${result.dates?.length===1?'':'s'})`:'One Reconciliation – Consolidated View'}</div>
    {view==='ledger'&&result.dates?.length?<div className="sub" style={{marginBottom:10}}>{result.dates.map((d:any)=>`${d.date} (${d.transactions})`).join(' · ')}</div>:null}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10}}>
     <button className={`mini-stat ${status==='ALL'?'selected':''}`} style={{textAlign:'left',cursor:'pointer',borderColor:status==='ALL'?'var(--navy)':undefined}} onClick={()=>{setStatus('ALL');setPage(0);}}><span className="kpi-label">All Transactions</span><b>{result.summary.total}</b></button>
     {CARD_STATUSES.map(s=><button key={s} className="mini-stat" style={{textAlign:'left',cursor:'pointer',borderColor:status===s?'var(--navy)':undefined,boxShadow:status===s?'inset 0 0 0 1px var(--navy)':undefined}} onClick={()=>{setStatus(status===s?'ALL':s);setPage(0);}}><span className="kpi-label">{s}</span><b>{result.summary.byStatus[s]??0}</b></button>)}
    </div>
    <div className="sub" style={{margin:'10px 0'}}>A transaction can carry several statuses, so cards can overlap. Cards, filters and the table all read the same dataset.</div>

    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:8,marginBottom:12}}>
     <label className="sub" style={LBL}>Date<input type="date" value={dateFilter} onChange={e=>{setDateFilter(e.target.value);setPage(0);}}/></label>
     <label className="sub" style={LBL}>Type<select value={type} onChange={e=>{setType(e.target.value);setPage(0);}}><option value="ALL">All types</option>{TYPES.map(t=><option key={t} value={t}>{TYPE_LABEL[t]||t}</option>)}</select></label>
     <label className="sub" style={LBL}>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="ALL">All statuses</option>{STATUS_PRIORITY.map(s=><option key={s}>{s}</option>)}</select></label>
     {TEXT_FILTERS.map(f=><label key={f.key} className="sub" style={LBL}>{f.label}<input value={text[f.key]||''} onChange={e=>{setText(o=>({...o,[f.key]:e.target.value}));setPage(0);}} placeholder="Contains…"/></label>)}
    </div>

    <div className="sub" style={{marginBottom:8}}>{filtered.length} of {rows.length} transactions{pages>1?` · Page ${current+1} of ${pages}`:''} · click a row for source records and audit trail</div>
    {!filtered.length?<div className="empty">No transactions match these filters.</div>:
    <div className="table-wrap" style={{maxHeight:'68vh'}}><table style={{width:'max-content',minWidth:'100%'}}>
     <thead>
      <tr>{bands.map((b,i)=><th key={i} colSpan={b.span} style={{background:`#${SECTION_COLORS[b.section]}`,color:'#fff',textAlign:'center',top:0,zIndex:3,position:'sticky',left:i===0?0:undefined}}>{b.section}</th>)}</tr>
      <tr>{cols.map((c,i)=><th key={c.key} style={{top:32,minWidth:c.width*7,...stickyStyle(i,true)}}>{c.label}</th>)}</tr>
     </thead>
     <tbody>{slice.map(r=><tr key={r.reconId} onClick={()=>setDetail(r)} style={{cursor:'pointer'}}>{cols.map((c,i)=>{
      const vk=c.src??c.key;const f=c.blank||(c.allowEmpty&&(r.v[vk]===undefined||r.v[vk]===null||r.v[vk]===''))?{text:'',flag:null}:fmtCell(c,r.v[vk]);const num=typeof r.v[vk]==='number';
      const isStatus=vk==='reconStatus';
      return <td key={c.key} style={{...stickyStyle(i),minWidth:c.width*7,textAlign:num?'right':'left',whiteSpace:vk==='aiComment'?'normal':'nowrap',...(vk==='aiComment'?{minWidth:520}:{}),color:f.flag==='nf'?'var(--danger)':f.flag==='na'?'var(--muted)':undefined,fontStyle:f.flag?'italic':undefined}}>
       {isStatus?<span className={`pill ${tone(f.text)}`}>{f.text}</span>:f.text}
      </td>;})}</tr>)}</tbody>
    </table></div>}
    {pages>1?<div style={{display:'flex',gap:12,marginTop:12}}><button className="btn btn-outline" disabled={!current} onClick={()=>setPage(current-1)}>Previous</button><button className="btn btn-outline" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Next</button></div>:null}
   </div></>:null}

  {detail?<div style={{position:'fixed',inset:0,background:'rgba(16,24,40,.45)',zIndex:60,display:'flex',justifyContent:'flex-end'}} onClick={()=>setDetail(null)}><div style={{width:'min(96vw,760px)',height:'100%',overflow:'auto',background:'#fff',padding:'16px 18px',boxShadow:'-10px 0 30px rgba(0,0,0,.18)'}} onClick={e=>e.stopPropagation()}><button className="btn btn-outline" onClick={()=>setDetail(null)}>Close</button><Detail row={detail}/></div></div>:null}
 </>;
}

function Detail({row}:{row:MasterRow}){
 const sections=[...new Set(COLUMNS.map(c=>c.section))];
 return <div style={{padding:'20px 8px'}}>
  <div className="section-kicker">TRANSACTION DRILL-DOWN</div><h2 style={{margin:'0 0 6px'}}>{row.reconId}</h2>
  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>{row.statuses.map(s=><span key={s} className={`pill ${tone(s)}`}>{s}</span>)}</div>
  <div className="notice" style={{marginBottom:14}}><CircleAlert size={13} style={{verticalAlign:'-2px'}}/> {String(row.v.aiComment)}</div>
  {sections.map(sec=><Fragment key={sec}>
   <div className="section-kicker" style={{marginTop:14}}>{sec}</div>
   {COLUMNS.filter(c=>c.section===sec&&c.key!=='aiComment').map(c=>{const f=fmtCell(c,row.v[c.key]);return <div key={c.key} className="sub" style={{display:'flex',justifyContent:'space-between',gap:12,padding:'3px 0',borderBottom:'1px solid #f0f2f5'}}><span>{c.label}</span><b style={{textAlign:'right',color:f.flag==='nf'?'var(--danger)':f.flag==='na'?'var(--muted)':undefined}}>{f.text}</b></div>;})}
  </Fragment>)}
  <div className="section-kicker" style={{marginTop:18}}>AUDIT TRAIL — SOURCE OF EVERY MATCHED VALUE</div>
  {row.audit.length?<div className="table-wrap"><table><thead><tr><th>Stage</th><th>Field</th><th>Raw</th><th>Normalized</th><th>Source</th><th>Rule</th><th>Conf.</th></tr></thead><tbody>{row.audit.map((a,i)=><tr key={i}><td>{a.stage}</td><td>{a.field}</td><td>{a.rawValue||'—'}</td><td>{a.normalizedValue||'—'}</td><td style={{whiteSpace:'normal',minWidth:200}}>{a.origin==='upload'?'Uploaded':a.origin==='operations_db'?'Operations DB':'Derived'} · {a.sourceFile} · {a.sourceSheet} · row {a.sourceRow}</td><td style={{whiteSpace:'normal',minWidth:200}}>{a.rule}</td><td>{Math.round(a.confidence*100)}%</td></tr>)}</tbody></table></div>:<div className="empty">No matched values to trace.</div>}
  <div className="sub" style={{marginTop:8}}>Run {row.runId}. Uploaded-file rows read by the shared Operations parsers show as “parsed row N” (order within the sheet).</div>
 </div>;
}
