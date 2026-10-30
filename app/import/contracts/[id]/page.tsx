'use client';
import {Fragment,useCallback,useEffect,useMemo,useState} from 'react';
import {useParams} from 'next/navigation';
import {Download,Plus,Trash2} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {StatusBadge} from '@/components/StatusBadge';
import {DayBookUpload} from '../../DayBookUpload';
import type {Cell,Settlement,Suggestion,LoadSuggestion,Invoice} from '@/lib/importSettlement/engine';

// Settlement sheet of one import contract. Figures come from the contract / invoice, the Tally Day Book (matched through the BOE number),
// the Bill of Entry and the ERP receipts; the dot on each figure says which. Click any figure to type over it.
type Payload={contract:any;record:{id:string;refCode:string}|null;invoices:Invoice[];settlement:Settlement;dayBook:{from:string|null;to:string|null;vouchers:number;searched:{from:string;to:string}};keyDates:Record<string,string|null>;canEdit:boolean};
const BLOCKS:{title:string;cols:[string,number,string][]}[]=[
 {title:'Invoice',cols:[['invNo',6,'Inv. no'],['invQty',7,'Inv. qty'],['ratePerTon',8,'R.P. ton']]},
 {title:'Expenses — from Tally, against the BOE number',cols:[['insurance',9,'Insurance'],['invValueInr',10,'Inv. value INR'],['bankChgs',11,'Bank chgs'],['boeNo',12,'BOE no'],['duty',13,'Duty'],['igst',14,'IGST'],['dutyInterest',15,'Duty interest'],['linerFees',16,'Liner fees'],['pqFees',17,'PQ fees'],['cfs',18,'CFS'],['chaFees',19,'CHA fees'],['fssai',20,'FSSAI'],['handCharges',21,'Hand charges'],['surveyor',22,'Surveyor'],['demurrage',23,'Demurrage'],['freight',24,'Freight'],['comFees',25,'Com. fees'],['totValue',26,'Tot. value']]},
 {title:'Settlement, debit & credit note',cols:[['invValueUsd',30,'Inv. value USD'],['advPaidUsd',31,'Adv. paid USD'],['balanceUsd',32,'Balance USD'],['advPaidInr',33,'Adv. paid INR'],['balanceInr',34,'Balance INR'],['assValue',35,'Ass. value (BOE)'],['purchaseValue',36,'Purchase value'],['setValue',37,'Set value'],['diffValue',38,'Diff value']]},
];
const TEXT_KEYS=new Set(['invNo','boeNo']);
const DOT:Record<string,{c:string;t:string}>={contract:{c:'#2b6fec',t:'Contract / invoice'},tally:{c:'#1f9d6b',t:'Tally Day Book / ERP'},boe:{c:'#7b5cc4',t:'Bill of Entry'},formula:{c:'#9aa3b2',t:'Calculated'},manual:{c:'#d98c1f',t:'Typed over'},blank:{c:'transparent',t:''}};
const inr=(n:unknown,d=2)=>n==null||n===''?'—':Number(n).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:d});
const day=(d?:string|null)=>d?new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'—';

export default function SettlementPage(){
 const {id}=useParams<{id:string}>();
 const [d,setD]=useState<Payload|null>(null),[err,setErr]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const [inv,setInv]=useState<Invoice[]>([]),[dates,setDates]=useState<Record<string,string>>({}),[erp,setErp]=useState({supplier:'',product:''}),[filter,setFilter]=useState(''),[editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState('');
 const [pick,setPick]=useState<Record<string,string>>({});

 const load=useCallback(async()=>{
  try{const r=await fetch(`/api/import-contracts/${id}/settlement`,{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error);setD(j);setInv(j.invoices.map((x:Invoice)=>({...x})));setDates(Object.fromEntries(['shipment_end_date','eta_date','delivery_date','settlement_due_date','settled_at'].map(k=>[k,j.keyDates[k]||''])));setErp({supplier:j.contract.erpSupplier||'',product:j.contract.erpProduct||''});setErr('')}
  catch(e){setErr(e instanceof Error?e.message:'Unable to load the settlement sheet.')}
 },[id]);
 useEffect(()=>{void load();fetch('/api/import-contracts/alerts').catch(()=>{})},[load]);

 async function save(body:Record<string,unknown>,ok:string){
  setBusy(true);setMsg('');setErr('');
  try{const r=await fetch(`/api/import-contracts/${id}/settlement`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.error);setMsg(ok);await load()}
  catch(e){setErr(e instanceof Error?e.message:'Unable to save.')}finally{setBusy(false)}
 }
 const setLink=(kind:'tally'|'erp',refKey:string,status:'confirmed'|'excluded'|null,colKey?:string|null)=>save({links:[{kind,refKey,status,colKey:colKey||null}]},status==null?'Reset.':status==='confirmed'?'Confirmed.':'Excluded.');
 const saveCell=(invoiceId:string|null,colKey:string)=>{const v=draft.trim().replace(/,/g,'');setEditing(null);void save({overrides:[{invoiceId,colKey,value:v===''?null:Number(v)}]},v===''?'Typed value removed.':'Saved.')};

 const s=d?.settlement,saved=!!d&&d.invoices.every(x=>x.id!=='new'),canEdit=!!d?.canEdit;
 const cellEl=(c:Cell|undefined,invoiceId:string|null,key:string,text?:boolean)=>{
  const k=`${invoiceId}|${key}`,dot=DOT[c?.source||'blank'];
  if(editing===k)return <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>saveCell(invoiceId,key)} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape')setEditing(null)}} style={{width:96}}/>;
  const val=c?.value;
  return <span title={dot.t} onClick={()=>{if(text||!canEdit||(invoiceId&&invoiceId==='new'))return;setEditing(k);setDraft(val==null?'':String(val))}} style={{cursor:text||!canEdit?'default':'text',whiteSpace:'nowrap'}}>{dot.t?<i style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:dot.c,marginRight:5,verticalAlign:1}}/>:null}{text?(val??'—'):inr(val)}</span>;
 };
 const rows=s?.suggestions||[];
 const shown=useMemo(()=>rows.filter(x=>!filter||`${x.ledger} ${x.vchNo} ${x.narration} ${x.vchType}`.toLowerCase().includes(filter.toLowerCase())),[rows,filter]);
 const candidates=shown.filter(x=>x.status==='candidate'),matched=shown.filter(x=>x.status==='auto'||x.status==='confirmed'),excluded=shown.filter(x=>x.status==='excluded');

 async function excel(){
  if(!d||!s)return;const XLSX=await import('xlsx'),wb=XLSX.utils.book_new(),c=d.contract;
  const head=[['SETTLEMENT SHEET — '+c.supplierName],[`Contract ${s.header.contractNo} • ${s.header.commodity} • ${s.header.contractQty} • rate ${s.header.ratePerTon}`],[]];
  const cols=BLOCKS.flatMap(b=>b.cols);const aoa:any[][]=[...head,['Col no.',...cols.map(x=>x[1])],['',...cols.map(x=>x[2])]];
  for(const r of s.rows)aoa.push(['',...cols.map(([k])=>r.cells[k]?.value??'')]);aoa.push(['Total',...cols.map(([k])=>TEXT_KEYS.has(k)?'':s.totals[k]??'')],[]);
  aoa.push(['Per ton cost'],['Party amount',s.perTon.partyAmount.value??''],['Total expenses',s.perTon.totalExp.value??''],['Received tons',s.perTon.receivedTons.value??''],['Per ton cost',s.perTon.perTonCost.value??'']);
  const w1=XLSX.utils.aoa_to_sheet(aoa);w1['!cols']=[{wch:14},...cols.map(()=>({wch:15}))];XLSX.utils.book_append_sheet(wb,w1,'Settlement');
  const w2=XLSX.utils.aoa_to_sheet([['RECEIVED QTY LOAD-WISE DETAILS (from the ERP)'],[],['Date','RN no','Vehicle no','Loading ton','LF per ton','Tot. freight','Pur. value'],...s.loads.map(l=>[l.date,l.rnNo,l.vehicleNo,l.loadingTon.value,l.lfPerTon.value??'',l.totFreight.value??'',l.purValue.value??'']),['Total','','',s.loadTotals.tons,'',s.loadTotals.freight,s.loadTotals.purValue]]);w2['!cols']=[{wch:12},{wch:16},{wch:14},{wch:12},{wch:12},{wch:12},{wch:14}];XLSX.utils.book_append_sheet(wb,w2,'Received loads');
  const w3=XLSX.utils.aoa_to_sheet([['DAY BOOK LINES BEHIND THE FIGURES'],[],['Date','Voucher type','Voucher no','Ledger','Amount','Counted as','Status','Evidence','Narration'],...s.suggestions.map(x=>[x.date,x.vchType,x.vchNo,x.ledger,x.amount,x.colKey||'',x.status,x.evidence.join('; '),x.narration])]);w3['!cols']=[{wch:12},{wch:18},{wch:14},{wch:34},{wch:14},{wch:14},{wch:11},{wch:30},{wch:50}];XLSX.utils.book_append_sheet(wb,w3,'Day Book lines');
  XLSX.writeFile(wb,`Import_Settlement_${String(c.contractNumber).replace(/[^A-Za-z0-9]+/g,'_')}.xlsx`);
 }

 if(!d)return <><PageHeader title="Settlement sheet" subtitle="" backHref="/import/contracts" backLabel="Import contracts"/>{err?<div className="notice danger">{err}</div>:<div className="empty">Loading…</div>}</>;
 const c=d.contract,dateField=(k:string,label:string)=><div className="field" key={k}><label>{label}</label><input type="date" disabled={!canEdit} value={dates[k]||''} onChange={e=>setDates({...dates,[k]:e.target.value})}/></div>;
 const th:React.CSSProperties={fontSize:11,whiteSpace:'nowrap',textAlign:'right'};

 return <>
  <PageHeader title={`Settlement — ${c.contractNumber}`} subtitle="" backHref="/import/contracts" backLabel="Import contracts" action={<div className="action-row"><StatusBadge status={c.status==='Confirmed'?'ok':'warn'} label={c.status}/><button className="btn btn-outline" onClick={excel}><Download size={15}/> Excel</button></div>}/>
  {err?<div className="notice danger" style={{marginTop:10}}>{err}</div>:null}{msg?<div className="notice" role="status" style={{marginTop:10}}>{msg}</div>:null}
  {d.record?<div className="notice" style={{marginTop:10}}>Invoice, advance, Bill of Entry and assessable value are read from import record <a href={`/import/${d.record.id}`}><b>{d.record.refCode}</b></a> — fill them there once.</div>:c.status==='Confirmed'?<div className="notice warn" style={{marginTop:10}}>No import record is linked to this contract yet. {canEdit?<button className="btn btn-outline" style={{marginLeft:8}} disabled={busy} onClick={()=>save({createRecord:true},'Import record created.')}>Create import record</button>:null}</div>:null}
  {c.status!=='Confirmed'?<div className="notice warn" style={{marginTop:10}}>This contract is still <b>{c.status}</b> — confirm it on the Contracts page so its alerts start.</div>:null}

  <section className="card" style={{marginTop:14}}>
   <div className="grid two" style={{gap:'6px 24px'}}>
    <div><span className="sub">1 · Contract no</span><div><b>{s!.header.contractNo}</b></div></div><div><span className="sub">2 · Party</span><div><b>{s!.header.party}</b></div></div>
    <div><span className="sub">3 · Commodity</span><div>{s!.header.commodity||'—'}</div></div><div><span className="sub">4 · Contract qty • 5 · Rate per ton</span><div>{s!.header.contractQty||'—'} • {s!.header.ratePerTon||'—'}</div></div>
   </div>
  </section>

  <section className="card" style={{marginTop:14}}>
   <div className="section-title">Key dates — the alerts run on these</div>
   <div className="grid two" style={{marginTop:8}}>
    {dateField('shipment_end_date','Shipment period ends')}{dateField('eta_date','Arrival (ETA at port)')}{dateField('delivery_date','Contract delivery date')}{dateField('settlement_due_date','Settlement due date')}{dateField('settled_at','Settled on (stops the alerts)')}
   </div>
   {d.keyDates.suggestedShipmentEnd&&!dates.shipment_end_date?<p className="sub" style={{margin:'4px 0'}}>Contract shipment period “{c.shipmentPeriod}” suggests {day(d.keyDates.suggestedShipmentEnd)} — <button className="btn btn-outline" style={{padding:'2px 8px'}} onClick={()=>setDates({...dates,shipment_end_date:d.keyDates.suggestedShipmentEnd!})}>use it</button></p>:null}
   <div className="grid two" style={{marginTop:8}}>
    <div className="field"><label>Name of the supplier in the ERP (if different)</label><input disabled={!canEdit} value={erp.supplier} onChange={e=>setErp({...erp,supplier:e.target.value})} placeholder={c.supplierName}/></div>
    <div className="field"><label>Name of the product in the ERP (if different)</label><input disabled={!canEdit} value={erp.product} onChange={e=>setErp({...erp,product:e.target.value})} placeholder={c.product||''}/></div>
   </div>
   {canEdit?<button className="btn btn-primary" style={{marginTop:10}} disabled={busy} onClick={()=>save({dates:{...dates,erpSupplier:erp.supplier,erpProduct:erp.product}},'Dates saved.')}>Save dates and ERP names</button>:null}
  </section>

  <section className="card" style={{marginTop:14}}>
   <div className="section-title">Tally Day Book</div>
   <p className="sub" style={{margin:'4px 0 8px'}}>Upload the Day Book (detailed layout) separately from the contract. Expenses are found through the Bill of Entry number{d.dayBook.vouchers?`; this sheet reads ${day(d.dayBook.searched.from)} onward of what is saved (${day(d.dayBook.from)} to ${day(d.dayBook.to)})`:''}.</p>
   <DayBookUpload onDone={load}/>
  </section>

  <section className="card" style={{marginTop:14}}>
   <div className="section-title">Invoices and Bills of Entry</div>
   <div className="table-wrap" style={{border:0,marginTop:8}}><table><thead><tr><th>Invoice no</th><th>Qty (MT)</th><th>Rate / MT</th><th>Adv. paid USD</th><th>BOE no</th><th>BOE date</th><th>Assessable value (BOE)</th><th/></tr></thead><tbody>
    {inv.map((x,i)=><tr key={x.id+i}>
     <td><input value={x.invNo} disabled={!canEdit} onChange={e=>setInv(inv.map((y,j)=>j===i?{...y,invNo:e.target.value}:y))} style={{width:130}}/></td>
     <td><input type="number" step="any" value={x.invQty??''} disabled={!canEdit} onChange={e=>setInv(inv.map((y,j)=>j===i?{...y,invQty:e.target.value===''?null:Number(e.target.value)}:y))} style={{width:90}}/></td>
     <td><input type="number" step="any" value={x.ratePerTon??''} disabled={!canEdit} onChange={e=>setInv(inv.map((y,j)=>j===i?{...y,ratePerTon:e.target.value===''?null:Number(e.target.value)}:y))} style={{width:90}}/></td>
     <td><input type="number" step="any" value={x.advPaidUsd??''} disabled={!canEdit} onChange={e=>setInv(inv.map((y,j)=>j===i?{...y,advPaidUsd:e.target.value===''?null:Number(e.target.value)}:y))} style={{width:100}}/></td>
     <td><input value={x.boeNo||''} disabled={!canEdit} onChange={e=>setInv(inv.map((y,j)=>j===i?{...y,boeNo:e.target.value}:y))} style={{width:110}}/></td>
     <td><input type="date" value={x.boeDate||''} disabled={!canEdit} onChange={e=>setInv(inv.map((y,j)=>j===i?{...y,boeDate:e.target.value}:y))}/></td>
     <td><input type="number" step="any" value={x.assessableValue??''} disabled={!canEdit} onChange={e=>setInv(inv.map((y,j)=>j===i?{...y,assessableValue:e.target.value===''?null:Number(e.target.value)}:y))} style={{width:130}}/></td>
     <td>{canEdit?<button className="btn btn-outline" title="Remove" onClick={()=>x.id==='new'||!x.id?setInv(inv.filter((_,j)=>j!==i)):void save({invoices:[{id:x.id,delete:true}]},'Invoice removed.')}><Trash2 size={14}/></button>:null}</td>
    </tr>)}
   </tbody></table></div>
   {canEdit?<div className="action-row" style={{marginTop:8}}><button className="btn btn-outline" onClick={()=>setInv([...inv,{id:'new',invNo:'',invQty:null,ratePerTon:c.unitPrice==null?null:Number(c.unitPrice),invValueUsd:null,advPaidUsd:null,boeNo:null,boeDate:null,assessableValue:null}])}><Plus size={14}/> Add invoice</button><button className="btn btn-primary" disabled={busy} onClick={()=>save({invoices:inv.map(x=>({...x}))},'Invoices saved.')}>Save invoices</button></div>:null}
  </section>

  <section className="card" style={{marginTop:14,padding:0}}>
   <div style={{padding:'14px 16px 0'}}><div className="section-title">Settlement sheet</div>
    <p className="sub" style={{margin:'4px 0 8px'}}>{Object.entries(DOT).filter(([k])=>k!=='blank').map(([k,v])=><span key={k} style={{marginRight:14}}><i style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:v.c,marginRight:5}}/>{v.t}</span>)}{canEdit&&saved?'• click a figure to type over it':''}</p>
    {!saved?<div className="notice warn" style={{marginBottom:8}}>Save the invoice row first — then the sheet fills from the Day Book and figures can be typed over.</div>:null}
    {s!.notes.map((n,i)=><div key={i} className="notice" style={{marginBottom:6}}>{n}</div>)}</div>
   {BLOCKS.map(b=><div key={b.title} style={{marginTop:6}}><div className="sub" style={{padding:'0 16px',fontWeight:600}}>{b.title}</div><div className="table-wrap" style={{border:0}}><table><thead><tr>{b.cols.map(([k,no,l])=><th key={k} style={th}><span className="sub">{no}</span><br/>{l}</th>)}</tr></thead><tbody>
    {s!.rows.map(r=><tr key={r.invoiceId}>{b.cols.map(([k])=><td key={k} style={{textAlign:TEXT_KEYS.has(k)?'left':'right'}}>{cellEl(r.cells[k],r.invoiceId,k,TEXT_KEYS.has(k))}</td>)}</tr>)}
    {s!.rows.length>1?<tr style={{fontWeight:600}}>{b.cols.map(([k])=><td key={k} style={{textAlign:'right'}}>{TEXT_KEYS.has(k)?'Total':inr(s!.totals[k])}</td>)}</tr>:null}
   </tbody></table></div></div>)}
   <div className="grid two" style={{padding:'12px 16px 16px',gap:'6px 24px'}}>
    {([['partyAmount','39 · Party amount (set value)'],['totalExp','40 · Total expenses'],['receivedTons','41 · Received tons'],['perTonCost','42 · Per ton cost']] as const).map(([k,l])=><div key={k}><span className="sub">{l}</span><div><b>{cellEl(s!.perTon[k],null,k)}</b></div></div>)}
    <p className="sub" style={{gridColumn:'1/-1',margin:0}}>Per ton cost = (party amount + total expenses) ÷ received tons. Total expenses exclude IGST (recoverable), as on your sheet.</p>
   </div>
  </section>

  <section className="card" style={{marginTop:14,padding:0}}>
   <div style={{padding:'14px 16px 0'}}><div className="section-title">Received quantity — load-wise (ERP)</div></div>
   <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Date</th><th>RN no</th><th>Vehicle</th><th style={th}>Loading ton</th><th style={th}>LF per ton</th><th style={th}>Tot. freight</th><th style={th}>Pur. value</th></tr></thead><tbody>
    {!s!.loads.length?<tr><td colSpan={7} className="sub">No ERP receipts confirmed yet — confirm them below.</td></tr>:s!.loads.map(l=><tr key={l.rnNo}><td>{day(l.date)}</td><td>{l.rnNo}</td><td>{l.vehicleNo}</td><td style={{textAlign:'right'}}>{inr(l.loadingTon.value,3)}</td>
     {(['lfPerTon','totFreight','purValue'] as const).map(f=>{const k=`load:${l.rnNo}:${f}`;return <td key={f} style={{textAlign:'right'}}>{cellEl(l[f],null,k)}</td>})}</tr>)}
    {s!.loads.length?<tr style={{fontWeight:600}}><td colSpan={3}>Total</td><td style={{textAlign:'right'}}>{inr(s!.loadTotals.tons,3)}</td><td/><td style={{textAlign:'right'}}>{inr(s!.loadTotals.freight,0)}</td><td style={{textAlign:'right'}}>{inr(s!.loadTotals.purValue,0)}</td></tr>:null}
   </tbody></table></div>
   <div style={{padding:'10px 16px 16px'}}>
    <div className="section-title" style={{fontSize:13}}>ERP receipts that look like this contract — confirm each</div>
    <p className="sub" style={{margin:'4px 0 8px'}}>Matched on supplier, product and arrival window. Only confirmed receipts count.</p>
    {!s!.loadSuggestions.length?<p className="sub">No matching ERP receipts found. Set the supplier / product name as it appears in the ERP above.</p>:<>
     {canEdit&&s!.loadSuggestions.some(x=>x.status==='suggested')?<button className="btn btn-outline" disabled={busy} style={{marginBottom:8}} onClick={()=>save({links:s!.loadSuggestions.filter(x=>x.status==='suggested').map(x=>({kind:'erp',refKey:x.rnNo,status:'confirmed'}))},'All suggested receipts confirmed.')}>Confirm all {s!.loadSuggestions.filter(x=>x.status==='suggested').length} suggested</button>:null}
     <div className="table-wrap" style={{border:0}}><table><thead><tr><th>Date</th><th>RN no</th><th>Vehicle</th><th>Supplier</th><th>Product</th><th style={th}>MT</th><th>Status</th><th/></tr></thead><tbody>
      {s!.loadSuggestions.map((x:LoadSuggestion)=><tr key={x.rnNo}><td>{day(x.date)}</td><td>{x.rnNo}</td><td>{x.vehicleNo}</td><td>{x.supplier}</td><td>{x.product}</td><td style={{textAlign:'right'}}>{inr(x.qty,3)}</td><td><StatusBadge status={x.status==='confirmed'?'ok':x.status==='excluded'?'danger':'warn'} label={x.status}/></td>
       <td>{canEdit?<span className="action-row">{x.status!=='confirmed'?<button className="btn btn-outline" disabled={busy} onClick={()=>setLink('erp',x.rnNo,'confirmed')}>Confirm</button>:null}{x.status!=='excluded'?<button className="btn btn-outline" disabled={busy} onClick={()=>setLink('erp',x.rnNo,'excluded')}>Exclude</button>:null}{x.status!=='suggested'?<button className="btn btn-outline" disabled={busy} onClick={()=>setLink('erp',x.rnNo,null)}>Reset</button>:null}</span>:null}</td></tr>)}
     </tbody></table></div></>}
   </div>
  </section>

  <section className="card" style={{marginTop:14,padding:0}}>
   <div style={{padding:'14px 16px 0'}}><div className="section-title">Day Book lines behind the figures</div>
    <p className="sub" style={{margin:'4px 0 8px'}}>Lines carrying this contract's BOE, invoice or contract number are counted automatically. Lines inside the shipment window without such a number are only <b>candidates</b> — pick the column and confirm, or exclude them.</p>
    <input placeholder="Filter by ledger, voucher no or narration" value={filter} onChange={e=>setFilter(e.target.value)} style={{minWidth:280,marginBottom:8}}/></div>
   {([['To confirm',candidates,true],['Counted',matched,false],['Excluded',excluded,false]] as [string,Suggestion[],boolean][]).map(([title,list,open])=><Fragment key={title}>
    <details open={open||undefined} style={{padding:'0 16px 12px'}}><summary style={{cursor:'pointer',fontWeight:600}}>{title} ({list.length})</summary>
     {!list.length?<p className="sub">None.</p>:<div className="table-wrap" style={{border:0,marginTop:6}}><table><thead><tr><th>Date</th><th>Voucher</th><th>Ledger</th><th style={th}>Amount</th><th>Counted as</th><th>Why</th><th/></tr></thead><tbody>
      {list.slice(0,300).map(x=><tr key={x.key}><td>{day(x.date)}</td><td>{x.vchType} {x.vchNo}<div className="sub" style={{maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.narration}</div></td><td>{x.ledger}</td><td style={{textAlign:'right'}}>{inr(x.amount)}</td>
       <td>{canEdit&&x.status!=='excluded'?<select value={pick[x.key]??x.colKey??''} onChange={e=>setPick({...pick,[x.key]:e.target.value})}><option value="">— choose —</option>{[...BLOCKS[1].cols.filter(c=>!['invValueInr','boeNo','totValue'].includes(c[0])).map(c=>[c[0],c[2]]),['purchaseValue','Purchase value (36)'],['advPaidInr','Adv. paid INR (33)'],['balanceInr','Balance INR (34)']].map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>:x.colKey||'—'}</td>
       <td className="sub">{x.evidence.join('; ')}</td>
       <td>{canEdit?<span className="action-row">{x.status!=='excluded'?<button className="btn btn-outline" disabled={busy||!(pick[x.key]??x.colKey)} onClick={()=>setLink('tally',x.key,'confirmed',pick[x.key]??x.colKey)}>Confirm</button>:null}{x.status!=='excluded'?<button className="btn btn-outline" disabled={busy} onClick={()=>setLink('tally',x.key,'excluded')}>Exclude</button>:<button className="btn btn-outline" disabled={busy} onClick={()=>setLink('tally',x.key,null)}>Reset</button>}</span>:null}</td></tr>)}
     </tbody></table>{list.length>300?<p className="sub">Showing the first 300 — use the filter.</p>:null}</div>}
    </details></Fragment>)}
  </section>
 </>;
}
