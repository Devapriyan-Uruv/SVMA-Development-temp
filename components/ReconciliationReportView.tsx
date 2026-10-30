'use client';
import {useEffect,useMemo,useState} from 'react';
import {Download} from 'lucide-react';
import {PageHeader} from './PageHeader';
import {StatusBadge} from './StatusBadge';

const TRANSACTION_CATEGORIES=['Purchase','Sales','Others','Job Work'];
const VENDOR_STATUS_GROUPS:{key:string;label:string;match:(s:string,r?:any)=>boolean}[]=[
 {key:'all',label:'All',match:()=>true},
 {key:'matched',label:'Matched',match:s=>s==='MATCHED — CORRECT AMOUNT'},
 {key:'mismatch',label:'Mismatch',match:s=>['POSSIBLE OVERPAYMENT','POSSIBLE UNDERPAYMENT','UNEXPLAINED ADJUSTMENT'].includes(s)},
 {key:'review',label:'Needs review',match:s=>['NEEDS REVIEW','AMBIGUOUS LOT MATCH','VENDOR MISMATCH','RULE REVIEW REQUIRED','ON ACCOUNT PAYMENT','NO REFERENCE ALLOCATION','VENDOR FOUND — LOT UNCONFIRMED','NEEDS VALIDATION'].includes(s)},
 {key:'ai_diff',label:'AI differences',match:(_s,r)=>r?.creditComparison==='AI differs'},
 {key:'missing',label:'Source missing',match:s=>s==='CREDIT/DEBIT RECORD NOT FOUND'},
];

export function ReconciliationReportView({type,id}:{type:'transaction'|'vendor_payment'|'ai_transaction';id:string}){
 const [report,setReport]=useState<any>(null),[error,setError]=useState('');
 const [statusFilter,setStatusFilter]=useState('all');
 useEffect(()=>{setReport(null);setError('');fetch(`/api/reconcile/history?type=${type}&id=${encodeURIComponent(id)}`,{cache:'no-store'}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to load report');return j}).then(setReport).catch(e=>setError(e instanceof Error?e.message:'Unable to load report'))},[type,id]);

 const backHref='/finance/history'+(type==='transaction'?'':`?type=${type}`);
 if(error)return <><PageHeader title="Reconciliation report" backHref={backHref} backLabel="Reports"/><div className="notice danger" style={{marginTop:12}}>{error}</div></>;
 if(!report)return <><PageHeader title="Reconciliation report" backHref={backHref} backLabel="Reports"/><div className="empty" style={{marginTop:12}}>Loading report…</div></>;

 if(type==='ai_transaction')return <AiTransactionView report={report} backHref={backHref} statusFilter={statusFilter} setStatusFilter={setStatusFilter}/>;
 return type==='transaction'?<TransactionView report={report} id={id} backHref={backHref} statusFilter={statusFilter} setStatusFilter={setStatusFilter}/>:<VendorPaymentView report={report} id={id} backHref={backHref} statusFilter={statusFilter} setStatusFilter={setStatusFilter}/>;
}

async function downloadExcel(type:'transaction'|'vendor_payment'|'ai_transaction',report:any,date:string){
 const endpoint=type==='transaction'?'export-transaction':type==='ai_transaction'?'ai-transaction/export':'export-amount';
 const r=await fetch(`/api/reconcile/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
 if(!r.ok)return;
 const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`SVMA_${type}_${date}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function TransactionView({report,backHref,statusFilter,setStatusFilter}:{report:any;id:string;backHref:string;statusFilter:string;setStatusFilter:(s:string)=>void}){
 const rows:any[]=Array.isArray(report.svmaCR)?report.svmaCR:[];
 const summary=useMemo(()=>TRANSACTION_CATEGORIES.map(c=>{const cr=rows.filter(r=>r.status===c);return{category:c,total:cr.length,matched:cr.filter(r=>r.evidence?.length).length,notFound:cr.filter(r=>!r.evidence?.length).length}}),[rows]);
 const visible=statusFilter==='all'?rows:rows.filter(r=>r.status===statusFilter);
 return <>
  <PageHeader title="Purchase & sales reconciliation" subtitle={`${report.reconciliationDate||''} — view only. Download for the full multi-sheet detail (name evidence, gate mapping, tally check).`} backHref={backHref} backLabel="Reports" action={<button className="btn btn-primary" onClick={()=>downloadExcel('transaction',report,report.reconciliationDate)}><Download size={16}/> Download Excel</button>}/>
  <section className="card" style={{marginTop:14}}>
   <div className="table-wrap"><table><thead><tr><th>Category</th><th>Weighments</th><th>Matching with Tally</th><th>Not found</th></tr></thead><tbody>
    {summary.map(s=><tr key={s.category}><td><b>{s.category}</b></td><td>{s.total}</td><td>{s.matched}</td><td>{s.notFound}</td></tr>)}
    <tr><td><b>Total</b></td><td>{rows.length}</td><td>{rows.filter(r=>r.evidence?.length).length}</td><td>{rows.filter(r=>!r.evidence?.length).length}</td></tr>
   </tbody></table></div>
  </section>
  <div className="tabs" style={{marginTop:16}}>
   <button className={`tab ${statusFilter==='all'?'active':''}`} onClick={()=>setStatusFilter('all')}>All ({rows.length})</button>
   {TRANSACTION_CATEGORIES.map(c=><button key={c} className={`tab ${statusFilter===c?'active':''}`} onClick={()=>setStatusFilter(c)}>{c} ({rows.filter(r=>r.status===c).length})</button>)}
  </div>
  <section className="card" style={{marginTop:12,padding:0}}>
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>S.No</th><th>Lorry NO</th><th>Party Name</th><th>Material</th><th>Net Weight</th><th>Weigh Bridge Ref</th><th>ERP GP NO</th><th>Tally Ref NO</th><th>Status</th></tr></thead><tbody>
    {visible.map((r,i)=><tr key={r.weighmentId||i}><td>{r.serialNo??i+1}</td><td>{r.lorryNo}</td><td>{r.partyName}</td><td>{r.material}</td><td>{r.netWeight??'—'}</td><td>{r.weighBridgeRef}</td><td>{r.erpGpNo||'—'}</td><td>{r.tallyRefNo||'—'}</td><td><StatusBadge status={r.evidence?.length?'ok':'warn'} label={r.status}/></td></tr>)}
    {!visible.length?<tr><td colSpan={9} className="sub">No rows in this category.</td></tr>:null}
   </tbody></table></div>
  </section>
 </>;
}

function VendorPaymentView({report,backHref,statusFilter,setStatusFilter}:{report:any;id:string;backHref:string;statusFilter:string;setStatusFilter:(s:string)=>void}){
 const rows:any[]=Array.isArray(report.vendorPayments)?report.vendorPayments:[];
 const s=report.summary||{};
 const group=VENDOR_STATUS_GROUPS.find(g=>g.key===statusFilter)||VENDOR_STATUS_GROUPS[0];
 const visible=rows.filter(r=>group.match(r.status,r));
 return <>
  <PageHeader title="Vendor payment reconciliation" subtitle={`${report.reconciliationDate||''} — view only. Download for the full multi-sheet detail (name evidence, voucher control).`} backHref={backHref} backLabel="Reports" action={<button className="btn btn-primary" onClick={()=>downloadExcel('vendor_payment',report,report.reconciliationDate)}><Download size={16}/> Download Excel</button>}/>
  <section className="card" style={{marginTop:14}}>
   <div className="grid four" style={{gap:10}}>
    <SummaryStat label="Payment allocations" value={String(s.purchasePayments??rows.length)}/>
    <SummaryStat label="Correct" value={String(s.correct??0)}/>
    <SummaryStat label="Needs review" value={String(s.needsReview??0)}/>
    <SummaryStat label="Net variance" value={typeof s.netVariance==='number'?`₹${Math.round(s.netVariance).toLocaleString('en-IN')}`:'—'}/>
   </div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
    <span className="pill ok">{s.overpayments??0} overpaid</span>
    <span className="pill danger">{s.underpayments??0} underpaid</span>
    <span className="pill neutral">{s.sourceMissing??0} source missing</span>
    <span className="pill neutral">{s.onAccount??0} on account</span>
   </div>
  </section>
  <div className="tabs" style={{marginTop:16}}>
   {VENDOR_STATUS_GROUPS.map(g=><button key={g.key} className={`tab ${statusFilter===g.key?'active':''}`} onClick={()=>setStatusFilter(g.key)}>{g.label} ({rows.filter(r=>g.match(r.status,r)).length})</button>)}
  </div>
  <section className="card" style={{marginTop:12,padding:0}}>
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Seq</th><th>Payment Date</th><th>Vendor</th><th>Payment Voucher</th><th>Product</th><th>Bill Value</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Status</th></tr></thead><tbody>
    {visible.map((r,i)=><tr key={i}><td>{r.sequence??i+1}</td><td>{r.paymentDate||'—'}</td><td>{r.vendor||'—'}</td><td>{r.paymentVoucher||'—'}</td><td>{r.product||'—'}</td><td>{r.billValue??'—'}</td><td>{r.expected??'—'}</td><td>{r.actual??'—'}</td><td>{r.variance??'—'}</td><td><StatusBadge status={r.status?.startsWith('MATCHED')?'ok':r.status?.includes('OVER')||r.status?.includes('UNDER')?'danger':'warn'} label={r.status}/></td></tr>)}
    {!visible.length?<tr><td colSpan={10} className="sub">No rows in this category.</td></tr>:null}
   </tbody></table></div>
  </section>
 </>;
}
function SummaryStat({label,value}:{label:string;value:string}){return <div><div className="kpi-label">{label}</div><div className="kpi-value" style={{fontSize:16}}>{value}</div></div>}

const AI_CATEGORIES=['Purchase','Sales','Job Work','Others'];
function aiStatusTone(status:string){if(status==='Reconciled')return 'ok';if(status==='Reconciled (AI)')return 'info';if(status==='Partial')return 'warn';if(status==='Not Found')return 'danger';if(status==='Review')return 'warn';return 'neutral';}

function AiTransactionView({report,backHref,statusFilter,setStatusFilter}:{report:any;backHref:string;statusFilter:string;setStatusFilter:(s:string)=>void}){
 const rows:any[]=Array.isArray(report.transactions)?report.transactions:[];
 const s=report.summary||{};
 const groups=useMemo(()=>[
  {key:'all',label:'All',match:()=>true},
  ...AI_CATEGORIES.map(c=>({key:c,label:c,match:(r:any)=>r.category===c})),
  {key:'exceptions',label:'Exceptions',match:(r:any)=>r.status!=='Reconciled'&&r.status!=='Reconciled (AI)'&&r.category!=='Others'},
 ],[]);
 const group=groups.find(g=>g.key===statusFilter)||groups[0];
 const visible=rows.filter(r=>group.match(r));
 return <>
  <PageHeader title="AI transaction reconciliation" subtitle={`${report.reconciliationDate||''} — view only. Download for the full multi-sheet detail (name evidence, gate mapping, tally evidence).`} backHref={backHref} backLabel="Reports" action={<button className="btn btn-primary" onClick={()=>downloadExcel('ai_transaction',report,report.reconciliationDate)}><Download size={16}/> Download Excel</button>}/>
  <section className="card" style={{marginTop:14}}>
   <div className="grid four" style={{gap:10}}>
    <SummaryStat label="Total weighments" value={String(s.totalWeighments??rows.length)}/>
    <SummaryStat label="Reconciled" value={String((s.fullyReconciled??0)+(s.aiReconciled??0))}/>
    <SummaryStat label="Reconciliation %" value={typeof s.reconciliationPercent==='number'?`${s.reconciliationPercent.toFixed(1)}%`:'—'}/>
    <SummaryStat label="Automation %" value={typeof s.automationPercent==='number'?`${s.automationPercent.toFixed(1)}%`:'—'}/>
   </div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
    <span className="pill ok">{s.fullyReconciled??0} reconciled</span>
    <span className="pill info">{s.aiReconciled??0} reconciled (AI)</span>
    <span className="pill neutral">{s.partial??0} partial</span>
    <span className="pill warn">{s.review??0} review</span>
    <span className="pill danger">{s.exceptions??0} exceptions</span>
   </div>
  </section>
  <div className="tabs" style={{marginTop:16}}>
   {groups.map(g=><button key={g.key} className={`tab ${statusFilter===g.key?'active':''}`} onClick={()=>setStatusFilter(g.key)}>{g.label} ({rows.filter(g.match).length})</button>)}
  </div>
  <section className="card" style={{marginTop:12,padding:0}}>
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>S.No</th><th>Date</th><th>Vehicle</th><th>Party</th><th>Material</th><th>Category</th><th>Weigh Bridge Ref</th><th>Confidence</th><th>Status</th></tr></thead><tbody>
    {visible.map((r,i)=><tr key={r.weighmentId||i}><td>{r.serialNo??i+1}</td><td>{r.date||'—'}</td><td>{r.vehicle||'—'}</td><td>{r.party||'—'}</td><td>{r.material||'—'}</td><td>{r.category||'—'}</td><td>{r.weighBridgeRef||'—'}</td><td>{typeof r.confidence==='number'?`${r.confidence}%`:'—'}</td><td><StatusBadge status={aiStatusTone(r.status)} label={r.status}/></td></tr>)}
    {!visible.length?<tr><td colSpan={9} className="sub">No rows in this category.</td></tr>:null}
   </tbody></table></div>
  </section>
 </>;
}
