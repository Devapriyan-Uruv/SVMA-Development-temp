'use client';
import {Fragment,Suspense,useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {OperationsInsight} from '@/components/ops/OperationsInsight';
import {OperationsNav} from '@/components/ops/OperationsNav';

function today(){return new Date().toISOString().slice(0,10)}

export default function OpsReconciliationPage(){return <Suspense><OpsReconciliationPageInner/></Suspense>}

function OpsReconciliationPageInner(){
 const searchParams=useSearchParams();
 const deepLinkDate=searchParams.get('date')||'';
 const [tab,setTab]=useState<'production_stock'|'raw_material'|'consumable'|'ebPower'|'shutdown'|'solvent'>(searchParams.get('tab')==='raw_material'?'raw_material':'production_stock');
 const [date,setDate]=useState(deepLinkDate||today());
 const [dateInitialized,setDateInitialized]=useState(!!deepLinkDate);
 const [rows,setRows]=useState<any[]>([]);
 const [rmProductRows,setRmProductRows]=useState<any[]>([]);
 const [rmLotRows,setRmLotRows]=useState<any[]>([]);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [utilities,setUtilities]=useState<any>(null);

 useEffect(()=>{
  fetch('/api/ops/reconciliation/utilities').then(r=>r.json()).then(setUtilities).catch(()=>{});
 },[]);

 // Reconciliation is inherently "as of one date" — defaulting that date to
 // today() silently shows nothing whenever the most recent upload is for an
 // earlier date (confirmed by real usage: an operator uploaded for
 // 2026-09-21 two days later and every ERP page defaulted to "today" with
 // no hint why it looked empty). Default instead to the latest date any
 // ERP report has data for, falling back to today() only if nothing has
 // been uploaded yet — unless a ticket or other page deep-linked here with
 // an explicit ?date=, which always wins.
 useEffect(()=>{
  if(deepLinkDate)return;
  fetch('/api/ops/batches').then(r=>r.json()).then(j=>{
   const latest=(j.batches||[]).map((b:any)=>b.report_date).filter(Boolean).sort().pop();
   if(latest)setDate(latest);
  }).catch(()=>{}).finally(()=>setDateInitialized(true));
 },[deepLinkDate]);

 useEffect(()=>{
  if(!dateInitialized||(tab!=='production_stock'&&tab!=='raw_material'))return;
  const c=new AbortController();setBusy(true);setError('');
  if(tab==='production_stock'){
   fetch(`/api/ops/reconciliation/production-stock?date=${date}`,{signal:c.signal})
    .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j})
    .then(j=>setRows(j.rows||[])).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});
  }else{
   fetch(`/api/ops/reconciliation/raw-material?date=${date}`,{signal:c.signal})
    .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j})
    .then(j=>{setRmProductRows(j.productRows||[]);setRmLotRows(j.lotRows||[]);}).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});
  }
  return()=>c.abort();
 },[tab,date,dateInitialized]);

 return <>
  <PageHeader title="Inventory &amp; Material Flow" subtitle="Deterministic Production-to-Stock and Raw Material reconciliation, as of a single date." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  <OperationsInsight module="production"/>
  <div className="card" style={{marginTop:14,padding:'12px 14px',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
   {/* rows/busy are reset synchronously on click, in the same render as the
       tab switch — otherwise the OLD tab's rows (a different row shape,
       e.g. Production→Stock rows have no openingQty) render for one frame
       under the NEW table component before the fetch effect below resets
       them, throwing on the mismatched field. Caught live by actually
       clicking the tab, not by static review. */}
   <div className="tabs">
    <button className={`tab ${tab==='production_stock'?'active':''}`} onClick={()=>{setTab('production_stock');setRows([]);setBusy(true);}}>Production → Stock</button>
    <button className={`tab ${tab==='raw_material'?'active':''}`} onClick={()=>{setTab('raw_material');setRmProductRows([]);setRmLotRows([]);setBusy(true);}}>Raw Material</button>
    <button className={`tab ${tab==='consumable'?'active':''}`} onClick={()=>setTab('consumable')}>Consumable Issue</button>
    <button className={`tab ${tab==='ebPower'?'active':''}`} onClick={()=>setTab('ebPower')}>EB Power Reading</button>
    <button className={`tab ${tab==='shutdown'?'active':''}`} onClick={()=>setTab('shutdown')}>Shut Down</button>
    <button className={`tab ${tab==='solvent'?'active':''}`} onClick={()=>setTab('solvent')}>Solvent Daily Report</button>
   </div>
   {tab==='production_stock'||tab==='raw_material'?<div className="field" style={{marginBottom:0}}><label htmlFor="recon-date">As of date</label><input id="recon-date" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>:null}
  </div>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}

  {tab==='production_stock'||tab==='raw_material'?<section className="card" style={{marginTop:14,padding:0}}>
   {busy?<div className="empty">Loading…</div>:tab==='production_stock'?<ProductionStockTable rows={rows}/>:<RawMaterialProductTable productRows={rmProductRows} lotRows={rmLotRows}/>}
  </section>:null}

  {utilities?<>
   {tab==='consumable'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Consumable Issue (recent)</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Issue Date</th><th>Reference No</th><th>Department</th><th>Product</th><th>Weight</th></tr></thead><tbody>
     {utilities.consumableIssues.map((r:any,i:number)=><tr key={i}><td>{r.issueDate||'—'}</td><td>{r.referenceNo}</td><td>{r.department||'—'}</td><td>{r.productRaw}</td><td>{r.weight!=null?r.weight.toFixed(2):'—'}</td></tr>)}
     {!utilities.consumableIssues.length?<tr><td colSpan={5} className="sub">No Consumable Issue upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='ebPower'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">EB Power Reading (recent)</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Date</th><th>Department</th><th>Particulars</th><th>Opening KWH</th><th>Closing KWH</th><th>Consumption</th></tr></thead><tbody>
     {utilities.ebPowerReadings.map((r:any,i:number)=><tr key={i}><td>{r.reportDate||'—'}</td><td>{r.department||'—'}</td><td>{r.particulars}</td><td>{r.openingKwh!=null?r.openingKwh.toLocaleString('en-IN'):'—'}</td><td>{r.closingKwh!=null?r.closingKwh.toLocaleString('en-IN'):'—'}</td><td>{r.consumptionUnits!=null?r.consumptionUnits.toLocaleString('en-IN'):'—'}</td></tr>)}
     {!utilities.ebPowerReadings.length?<tr><td colSpan={6} className="sub">No EB Power Reading upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='shutdown'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Shut Down (recent)</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Effective Date</th><th>Reason</th><th>From</th><th>To</th><th>Minutes</th><th>Remarks</th></tr></thead><tbody>
     {utilities.shutdowns.map((r:any,i:number)=><tr key={i}><td>{r.effectiveDate}</td><td>{r.reason||'—'}</td><td>{r.fromTime||'—'}</td><td>{r.toTime||'—'}</td><td>{r.minutes!=null?r.minutes.toFixed(0):'—'}</td><td>{r.remarks||'—'}</td></tr>)}
     {!utilities.shutdowns.length?<tr><td colSpan={6} className="sub">No Shut Down upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}

   {tab==='solvent'?<section className="card" style={{marginTop:14}}>
    <div className="section-title">Solvent Daily Report (recent)</div>
    <div className="sub" style={{marginTop:2}}>Independent cross-check log from the ERP's Solvent Daily Report export — separate from the Solvent module's own manual shift entries and Quality's Process Lab Report.</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Date</th><th>Shift</th><th>Time</th><th>DOB&amp;DOC %OIL</th><th>Miscella</th><th>Prod. %FFA</th><th>IV</th><th>M/V</th><th>Fl.Pt</th></tr></thead><tbody>
     {utilities.solventDaily.map((r:any,i:number)=><tr key={i}><td>{r.reportDate}</td><td>{r.shift||'—'}</td><td>{r.timeSlot}</td><td>{r.dobDocOilPct!=null?r.dobDocOilPct.toFixed(2):'—'}</td><td>{r.miscella!=null?r.miscella.toFixed(2):'—'}</td><td>{r.productionOilFfa!=null?r.productionOilFfa.toFixed(2):'—'}</td><td>{r.iv!=null?r.iv.toFixed(2):'—'}</td><td>{r.mv!=null?r.mv.toFixed(2):'—'}</td><td>{r.flashPoint!=null?r.flashPoint.toFixed(2):'—'}</td></tr>)}
     {!utilities.solventDaily.length?<tr><td colSpan={9} className="sub">No Solvent Daily Report upload found yet.</td></tr>:null}
    </tbody></table></div>
   </section>:null}
  </>:null}
 </>;
}

function ProductionStockTable({rows}:{rows:any[]}){
 if(!rows.length)return <div className="empty">No production or stock data found for this date — upload both Production Report and Stock Summary first.</div>;
 return <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Product</th><th>Production (MT)</th><th>Stock Inward (MT)</th><th>Variance</th><th>Variance %</th><th>Status</th></tr></thead><tbody>
  {rows.map((r:any)=><tr key={r.productId}><td>{r.productName}</td><td>{r.productionQty.toFixed(3)}</td><td>{r.stockInwardQty.toFixed(3)}</td><td>{r.variance.toFixed(3)}</td><td>{r.variancePct===null?'—':`${r.variancePct.toFixed(1)}%`}</td><td><StatusBadge status={r.status==='matched'?'ok':'danger'} label={r.status==='matched'?'Matched':'Deviation'}/></td></tr>)}
 </tbody></table></div>;
}

const RM_STATUS_LABEL:Record<string,string>={matched:'Matched',deviation:'Deviation',partial:'Needs lot mapping'};
const RM_STATUS_TONE:Record<string,string>={matched:'ok',deviation:'danger',partial:'warn'};

/** Product/day is the primary Raw Material view — a lot-wise table was too
 * granular to read at a glance (dozens of rows, mostly "unmapped" until a
 * human approves a lot alias). Each product row expands to its own lots. */
function RawMaterialProductTable({productRows,lotRows}:{productRows:any[];lotRows:any[]}){
 const [expanded,setExpanded]=useState<Set<string>>(new Set());
 if(!productRows.length)return <div className="empty">No feeding data found for this date.</div>;
 function toggle(key:string){setExpanded(s=>{const n=new Set(s);n.has(key)?n.delete(key):n.add(key);return n;})}
 return <div className="table-wrap" style={{border:0}}><table><thead><tr><th/><th>Product</th><th>Lots</th><th>Opening (MT)</th><th>Feeding (MT)</th><th>Computed Closing</th><th>ERP Closing</th><th>Variance</th><th>Status</th></tr></thead><tbody>
  {productRows.map((r:any)=>{
   const key=r.productId||r.productName;
   const isOpen=expanded.has(key);
   const lots=lotRows.filter((l:any)=>(l.productId||l.productName)===key);
   return <Fragment key={key}>
    <tr className="clickable-row" onClick={()=>toggle(key)}>
     <td style={{width:24}}>{isOpen?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</td>
     <td>{r.productName}</td>
     <td>{r.lotCount}{r.unmappedLotCount?` (${r.unmappedLotCount} unmapped)`:''}</td>
     <td>{r.openingQty.toFixed(3)}</td><td>{r.feedingQty.toFixed(3)}</td><td>{r.computedClosing.toFixed(3)}</td>
     <td>{r.erpClosing===null?'—':r.erpClosing.toFixed(3)}</td><td>{r.variance===null?'—':r.variance.toFixed(3)}</td>
     <td><StatusBadge status={RM_STATUS_TONE[r.status]||'neutral'} label={RM_STATUS_LABEL[r.status]||r.status}/></td>
    </tr>
    {isOpen?<tr><td/><td colSpan={8} style={{padding:0}}>
     <table style={{width:'100%'}}><thead><tr><th>Feeding Lot</th><th>Opening (MT)</th><th>Feeding (MT)</th><th>Computed Closing</th><th>ERP Closing</th><th>Variance</th><th>Status</th></tr></thead><tbody>
      {lots.map((l:any)=><tr key={l.lotNo}><td>{l.lotNo}</td><td>{l.openingQty.toFixed(3)}</td><td>{l.feedingQty.toFixed(3)}</td><td>{l.computedClosing.toFixed(3)}</td><td>{l.erpClosing===null?'—':l.erpClosing.toFixed(3)}</td><td>{l.variance===null?'—':l.variance.toFixed(3)}</td><td><StatusBadge status={l.status==='matched'?'ok':l.status==='unmapped'?'warn':'danger'} label={l.status==='matched'?'Matched':l.status==='unmapped'?'Unmapped lot':'Deviation'}/></td></tr>)}
     </tbody></table>
    </td></tr>:null}
   </Fragment>;
  })}
 </tbody></table></div>;
}
