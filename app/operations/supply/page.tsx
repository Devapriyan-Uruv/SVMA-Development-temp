'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {Kpi} from '@/components/Kpi';
import {StatusBadge} from '@/components/StatusBadge';
import {OperationsInsight} from '@/components/ops/OperationsInsight';
import {OperationsNav} from '@/components/ops/OperationsNav';
import {ErpApiPanel} from '@/components/ops/ErpApiPanel';
import {Drawer} from '@/components/Drawer';
import {Truck,PackageCheck,Boxes,Timer,Download} from 'lucide-react';

const LOT_STATUS_LABEL:Record<string,string>={AWAITING_MATERIAL:'Awaiting Material',AT_GATE:'At Gate',WEIGHED:'Weighed',RECEIPT_CREATED:'Receipt Created',LOT_CREATED:'Lot Created',QC_PENDING:'QC Pending',QC_COMPLETED:'QC Completed',SETTLEMENT_PENDING:'Settlement Pending',STOCK_POSTED:'Stock Posted',COMPLETED:'Completed'};
const LOT_STATUS_TONE:Record<string,string>={AWAITING_MATERIAL:'neutral',AT_GATE:'info',WEIGHED:'info',RECEIPT_CREATED:'info',LOT_CREATED:'info',QC_PENDING:'warn',QC_COMPLETED:'ok',SETTLEMENT_PENDING:'warn',STOCK_POSTED:'ok',COMPLETED:'ok'};

export default function SupplyIntelligencePage(){
 const [data,setData]=useState<any>(null);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [tab,setTab]=useState<'orders'|'gate'|'lots'|'purchaseSummary'|'payments'|'erpApi'>('orders');
 const [downloading,setDownloading]=useState(false);
 const [traceFor,setTraceFor]=useState<string|null>(null);
 const [trace,setTrace]=useState<any>(null);
 const [traceBusy,setTraceBusy]=useState(false);
 const [traceError,setTraceError]=useState('');

 useEffect(()=>{
  fetch('/api/ops/supply/dashboard').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(setData).catch(e=>setError(e instanceof Error?e.message:'Unable to load')).finally(()=>setBusy(false));
 },[]);

 function openTrace(poNo:string){
  setTraceFor(poNo);setTrace(null);setTraceError('');setTraceBusy(true);
  fetch(`/api/ops/supply/po-trace?poNo=${encodeURIComponent(poNo)}`).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(setTrace).catch(e=>setTraceError(e instanceof Error?e.message:'Unable to trace this PO')).finally(()=>setTraceBusy(false));
 }

 async function downloadReport(){
  setDownloading(true);
  try{
   const r=await fetch('/api/ops/supply/export',{cache:'no-store'});
   if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Unable to download.')}
   const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');
   a.href=url;a.download=`SVMA_Supply_Intelligence_${new Date().toISOString().slice(0,10)}.xlsx`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:'Unable to download report.')}finally{setDownloading(false)}
 }

 return <>
  <PageHeader title="Supply Intelligence" subtitle="Purchase Order → Gate → Weighment → Lot, from uploaded ERP Supply reports." backHref="/operations" backLabel="Operations Intelligence"
   action={<button type="button" className="btn btn-outline" disabled={downloading} onClick={downloadReport}><Download size={16}/>{downloading?'Downloading…':'Download report'}</button>}/>
  <OperationsNav/>
  <OperationsInsight module="supply"/>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}
  {busy?<div className="empty" style={{marginTop:14}}>Loading…</div>:data?<>
   <div className="tabs" style={{marginTop:14}}>
    <button className={`tab ${tab==='orders'?'active':''}`} onClick={()=>setTab('orders')}>Purchase Orders</button>
    <button className={`tab ${tab==='gate'?'active':''}`} onClick={()=>setTab('gate')}>Gate &amp; Weighment</button>
    <button className={`tab ${tab==='lots'?'active':''}`} onClick={()=>setTab('lots')}>Lots</button>
    <button className={`tab ${tab==='purchaseSummary'?'active':''}`} onClick={()=>setTab('purchaseSummary')}>Purchase Summary</button>
    <button className={`tab ${tab==='payments'?'active':''}`} onClick={()=>setTab('payments')}>Payments</button>
    <button className={`tab ${tab==='erpApi'?'active':''}`} onClick={()=>setTab('erpApi')}>ERP API (live)</button>
   </div>

   {tab==='erpApi'?<ErpApiPanel/>:null}

   {tab==='orders'?<>
    <div className="grid kpis" style={{marginTop:14}}>
     <Kpi icon={PackageCheck} tone="blue" label="Open POs" value={data.kpis.openPoCount} foot={data.asOf?`As of ${data.asOf}`:'No Purchase Order Pending upload yet'}/>
     <Kpi icon={Boxes} tone="purple" label="Pending quantity" value={data.kpis.totalPendingQty.toFixed(2)} foot="MT across all open POs"/>
     <Kpi icon={Truck} tone="orange" label="Vehicles awaiting weighment" value={data.kpis.vehiclesAwaitingWeighment} foot="Gate In recorded, no inward weighment yet"/>
     <Kpi icon={Timer} tone="green" label="Lots in progress" value={data.kpis.lotsInProgress} foot="Not yet stock-posted / completed"/>
    </div>
    <section className="card" style={{marginTop:14}}>
     <div className="section-title">Open purchase orders (pending quantity)</div>
     <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>PO No</th><th>Order Date</th><th>Days</th><th>Product</th><th>Supplier</th><th>Broker</th><th>Ordered</th><th>Received</th><th>Pending</th><th></th></tr></thead><tbody>
      {data.openPos.map((p:any,i:number)=><tr key={i}><td>{p.poNo}</td><td>{p.poDate||'—'}</td><td>{p.daysSinceOrder===null?'—':p.daysSinceOrder}</td><td>{p.productName}</td><td>{p.supplierName||'—'}</td><td>{p.brokerName||'—'}</td><td>{p.orderedQty.toFixed(2)}</td><td>{p.receivedQty.toFixed(2)}</td><td>{p.pendingQty.toFixed(2)}</td><td><button className="btn btn-outline btn-sm" onClick={()=>openTrace(p.poNo)}>Trace</button></td></tr>)}
      {!data.openPos.length?<tr><td colSpan={10} className="sub">No Purchase Order Pending upload found — upload "PurchaseOrder Pending" to see open POs.</td></tr>:null}
     </tbody></table></div>
    </section>
   </>:null}

   {tab==='gate'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Recent gate activity</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Gate Pass</th><th>Direction</th><th>Date</th><th>Party</th><th>Material</th><th>Vehicle</th><th>In / Out Time</th><th>Weighment</th></tr></thead><tbody>
     {data.gateActivity.map((g:any,i:number)=><tr key={i}><td>{g.gatePassNo}</td><td><StatusBadge status={g.direction==='IN'?'info':'neutral'} label={g.direction}/></td><td>{g.movementDate||'—'}</td><td>{g.partyName||'—'}</td><td>{g.materialRaw||'—'}</td><td>{g.vehicleNo||'—'}</td><td>{g.inTime||'—'} / {g.outTime||'—'}</td><td>{g.direction==='IN'?<StatusBadge status={g.hasWeighment?'ok':'warn'} label={g.hasWeighment?'Weighed':'Awaiting'}/>:'—'}</td></tr>)}
     {!data.gateActivity.length?<tr><td colSpan={8} className="sub">No gate movements uploaded yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='lots'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Lot lifecycle</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Lot No</th><th>Status</th><th>PO No</th><th>Supplier</th><th>Product</th><th>Updated</th><th></th></tr></thead><tbody>
     {data.lots.map((l:any)=><tr key={l.lotNo}><td>{l.lotNo}</td><td><StatusBadge status={LOT_STATUS_TONE[l.status]||'neutral'} label={LOT_STATUS_LABEL[l.status]||l.status}/></td><td>{l.poNo||'—'}</td><td>{l.supplierName||'—'}</td><td>{l.productName||'—'}</td><td>{new Date(l.updatedAt).toLocaleString('en-IN')}</td><td>{l.poNo?<button className="btn btn-outline btn-sm" onClick={()=>openTrace(l.poNo)}>Trace</button>:null}</td></tr>)}
     {!data.lots.length?<tr><td colSpan={7} className="sub">No lots tracked yet — lots are created automatically as Gate In / Weighment / QC / Settlement data arrives.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='purchaseSummary'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Purchase Summary (recent)</div>
    <div className="sub" style={{marginTop:2}}>Independent cross-check log from the Purchase Summary ERP report — not merged with the Purchase Order/Purchase Register data above.</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Reference No</th><th>PO No</th><th>Inward Date</th><th>Supplier</th><th>Product</th><th>Value</th><th>Gross Amount</th><th>Payable</th><th>Paid</th></tr></thead><tbody>
     {data.purchaseSummary.map((r:any,i:number)=><tr key={i}><td>{r.referenceNo}</td><td>{r.poNo||'—'}</td><td>{r.inwardDate||'—'}</td><td>{r.supplierName||'—'}</td><td>{r.productRaw||'—'}</td><td>{r.value!=null?r.value.toLocaleString('en-IN'):'—'}</td><td>{r.grossAmount!=null?r.grossAmount.toLocaleString('en-IN'):'—'}</td><td>{r.payableAmount!=null?r.payableAmount.toLocaleString('en-IN'):'—'}</td><td>{r.paidAmount!=null?r.paidAmount.toLocaleString('en-IN'):'—'}</td></tr>)}
     {!data.purchaseSummary.length?<tr><td colSpan={9} className="sub">No Purchase Summary upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='payments'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Inward Payments (recent)</div>
    <div className="sub" style={{marginTop:2}}>Independent supplier payment log from the Inward Payment ERP report — separate from the PO Trace drawer's own vendor-payment reconciliation match.</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Reference No</th><th>Payment Date</th><th>Supplier</th><th>Bank</th><th>Lot / Bill No</th><th>Amount</th><th>Total Amount</th></tr></thead><tbody>
     {data.inwardPayments.map((r:any,i:number)=><tr key={i}><td>{r.referenceNo}</td><td>{r.paymentDate||'—'}</td><td>{r.supplierName||'—'}</td><td>{r.bankName||'—'}</td><td>{r.lotOrBillNo}</td><td>{r.amount!=null?r.amount.toLocaleString('en-IN'):'—'}</td><td>{r.totalAmount!=null?r.totalAmount.toLocaleString('en-IN'):'—'}</td></tr>)}
     {!data.inwardPayments.length?<tr><td colSpan={7} className="sub">No Inward Payment upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}
  </>:null}

  <Drawer open={!!traceFor} onClose={()=>setTraceFor(null)} title={`Trace ${traceFor||''}`} subtitle="Purchase Order → Gate In → Weighment → Lot → QC → Settlement → Feeding → Payment" wide>
   {traceBusy?<div className="empty">Loading…</div>:traceError?<div className="notice danger">{traceError}</div>:trace?<>
    <div className="section-title">Purchase order</div>
    <div className="table-wrap" style={{marginTop:6}}><table><thead><tr><th>Product</th><th>Supplier</th><th>Ordered</th><th>Received</th><th>Pending</th><th>Status</th></tr></thead><tbody>
     {trace.po.map((p:any,i:number)=><tr key={i}><td>{p.product_raw}</td><td>{p.supplier_name||'—'}</td><td>{Number(p.ordered_qty||0).toFixed(2)}</td><td>{Number(p.received_qty||0).toFixed(2)}</td><td>{Number(p.pending_qty||0).toFixed(2)}</td><td>{p.status||'—'}</td></tr>)}
     {!trace.po.length?<tr><td colSpan={6} className="sub">No Purchase Order Pending/Details row found for this PO number.</td></tr>:null}
    </tbody></table></div>

    <div className="section-title" style={{marginTop:16}}>Gate In movements ({trace.gateMovements.length})</div>
    <div className="table-wrap" style={{marginTop:6}}><table><thead><tr><th>Gate Pass</th><th>Direction</th><th>Date</th><th>Vehicle</th><th>Weighment</th></tr></thead><tbody>
     {trace.gateMovements.map((g:any,i:number)=><tr key={i}><td>{g.gatePassNo}</td><td>{g.direction}</td><td>{g.movementDate||'—'}</td><td>{g.vehicleNo||'—'}</td><td>{g.direction==='IN'?<StatusBadge status={g.hasWeighment?'ok':'warn'} label={g.hasWeighment?`Weighed (${Number(g.netWeight||0).toFixed(2)} MT)`:'Awaiting'}/>:'—'}</td></tr>)}
     {!trace.gateMovements.length?<tr><td colSpan={5} className="sub">No Gate In/Out movement carries this PO number yet.</td></tr>:null}
    </tbody></table></div>

    <div className="section-title" style={{marginTop:16}}>Lots ({trace.lots.length})</div>
    {trace.lots.map((l:any)=><div key={l.lotNo} className="card tight" style={{marginTop:8}}>
     <div className="split-header"><b>{l.lotNo}</b><StatusBadge status={LOT_STATUS_TONE[l.status]||'neutral'} label={LOT_STATUS_LABEL[l.status]||l.status}/></div>
     <div className="sub" style={{marginTop:4}}>Supplier: {l.supplierName||'—'}</div>
     <div style={{marginTop:8,fontSize:12.5}}>
      <div>QC results: <b>{l.qcResults.length}</b>
       {l.qcResults.length?<ul style={{margin:'4px 0 0',paddingLeft:18}}>{l.qcResults.map((q:any,i:number)=><li key={i}>Sample {q.sample_code||'—'}: oil {q.oil??'—'}{q.report_date?` (${q.report_date})`:''}</li>)}</ul>:null}
      </div>
      <div style={{marginTop:6}}>Settlement: <b>{l.settlements.length?`Recorded (${l.settlements.length})${l.settlements[0]?.inward_date?` — ${l.settlements[0].inward_date}`:''}`:'Pending'}</b></div>
      <div style={{marginTop:6}}>Fed into production: <b>{l.fed?`Yes${l.fedDate?` (${l.fedDate})`:''}`:'Not yet'}</b></div>
      <div style={{marginTop:6}}>Credit/Debit Note (Operations upload): {l.creditDebitNotes.length?<ul style={{margin:'4px 0 0',paddingLeft:18}}>{l.creditDebitNotes.map((c:any,i:number)=><li key={i}>{c.reference_number}: net {c.net_value??'—'} / bill {c.bill_value??'—'}{c.date?` (${c.date})`:''}</li>)}</ul>:<b>None uploaded yet</b>}</div>
     </div>
    </div>)}
    {!trace.lots.length?<p className="sub" style={{marginTop:8}}>No lot has been created under this PO yet — a lot is created once a weighment/receipt/QC row references it.</p>:null}

    <div className="section-title" style={{marginTop:16}}>Payment (Finance reconciliation)</div>
    {trace.payment.matched?<div className="card tight" style={{marginTop:8}}>
     <div>Matched against lot <b>{trace.payment.matchedLot}</b> in the latest Purchase Payment Reconciliation run.</div>
     <div style={{marginTop:6,display:'flex',gap:16,flexWrap:'wrap',fontSize:12.5}}>
      <span>Vendor: <b>{trace.payment.vendor||'—'}</b></span>
      <span>Status: <b>{trace.payment.status||'—'}</b></span>
      <span>Actual: <b>{trace.payment.actual!=null?Number(trace.payment.actual).toFixed(2):'—'}</b></span>
      <span>Payment date: <b>{trace.payment.paymentDate||'—'}</b></span>
     </div>
    </div>:<p className="sub" style={{marginTop:8}}>No Purchase Payment Reconciliation run has matched any of this PO's lots yet. <a href="/finance/amount">Check Finance → Purchase Payment Reconciliation</a>.</p>}
   </>:null}
  </Drawer>
 </>;
}
