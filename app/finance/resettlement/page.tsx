'use client';
import {useEffect,useMemo,useState} from 'react';
import {Download,Search} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import type {ResettlementData,ResettledLot} from '@/lib/outstanding/resettlement';

const inr=(n:number|null|undefined)=>n==null?'—':`${n<0?'-':''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const signed=(n:number|null|undefined)=>n==null?'—':`${n>0?'+':''}${inr(n)}`;
const day=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)?new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'}):d;
const check=(l:ResettledLot)=>l.billRef&&l.tallySettlement==null?{t:'Upload the Day Book again to compare with Tally',tone:'sub'}:l.tallyDifference==null?{t:'No open Tally bill (paid, older than the Day Book, or not matched)',tone:'sub'}:Math.abs(l.tallyDifference)<2?{t:'Tally agrees with the final settlement',tone:'ok'}:{t:`Tally differs by ${inr(l.tallyDifference)} — the final note is not posted in Tally yet, or an old note is still there`,tone:'warn'};

export default function Resettlement(){
 const [data,setData]=useState<ResettlementData|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[tab,setTab]=useState<'lots'|'cn'>('lots'),[q,setQ]=useState('');
 useEffect(()=>{fetch('/api/finance/resettlement',{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Could not load (HTTP ${r.status}).`);setData(j)}).catch(e=>setError(e instanceof Error?e.message:'Could not load.')).finally(()=>setLoading(false))},[]);
 const t=q.trim().toLowerCase();
 const lots=useMemo(()=>(data?.lots||[]).filter(l=>!t||[l.supplier,l.tallyParty,l.lot,l.product,...l.notes.map(n=>n.ref)].join(' ').toLowerCase().includes(t)),[data,t]);
 const cns=useMemo(()=>(data?.creditNotes||[]).filter(c=>!t||[c.supplier,c.tallyParty,c.lot,c.product,c.note].join(' ').toLowerCase().includes(t)),[data,t]);
 async function download(){
  if(!data)return;const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(lots.map(l=>({Supplier:l.tallyParty||l.supplier,Lot:l.lot,Product:l.product,'Original bill value (incl GST)':l.originalBill,'First note':l.first.ref,'First note date':l.first.date,'First deduction':l.firstDeduction,'First settlement value':l.first.net,'Final note':l.last.ref,'Final note date':l.last.date,'Final deduction':l.finalDeduction,'Final settlement value':l.last.net,'Loss because of resettlement (negative = gain)':l.loss,'Tally settlement value':l.tallySettlement??'','Tally difference':l.tallyDifference??'','Outstanding now':l.outstanding??'','Notes in total':l.notes.length}))),'Re-settled lots');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(cns.map(c=>({Supplier:c.tallyParty||c.supplier,Lot:c.lot,Product:c.product,'Credit note':c.note,Date:c.date,'Credit note amount (extra payable)':c.amount,'Re-settled lot':c.resettled?'Yes':'No'}))),'Credit notes');
  XLSX.writeFile(wb,`Resettlement_data_${new Date().toISOString().slice(0,10)}.xlsx`);
 }
 const s=data?.summary;
 return <>
  <PageHeader title="Resettlement data" subtitle="Lots whose debit / credit note was replaced by a later settlement — what changed, and what we pay extra" backHref="/finance" backLabel="Finance"/>
  {error?<div className="notice danger" style={{marginTop:10}}>{error}</div>:null}
  {loading?<div className="empty" style={{marginTop:14}}>Loading…</div>:null}
  {data&&s?<>
   <div className="card tight" style={{marginTop:6}}>
    <div style={{display:'flex',gap:28,flexWrap:'wrap'}}>
     <div><div className="kpi-label">Re-settled lots</div><b style={{fontSize:22}}>{s.resettledLots}</b><div className="sub">{s.suppliers} suppliers</div></div>
     <div><div className="kpi-label">Original bill value</div><b style={{fontSize:22}}>{inr(s.originalBill)}</b><div className="sub">supplier bills of these lots, incl. GST</div></div>
     <div><div className="kpi-label">Deducted at first settlement</div><b style={{fontSize:22}}>{inr(s.firstDeduction)}</b></div>
     <div><div className="kpi-label">Deducted at final settlement</div><b style={{fontSize:22}}>{inr(s.finalDeduction)}</b></div>
     <div><div className="kpi-label">Loss because of resettlement</div><b style={{fontSize:22,color:'#b42318'}}>{inr(s.loss)}</b><div className="sub">deduction given back on lots that now pay more</div></div>
     <div><div className="kpi-label">Gain because of resettlement</div><b style={{fontSize:22,color:'#067647'}}>{inr(-s.gain)}</b><div className="sub">extra deduction on lots that now pay less</div></div>
     <div><div className="kpi-label">Net loss</div><b style={{fontSize:22,color:s.netLoss>0?'#b42318':'#067647'}}>{inr(s.netLoss)}</b></div>
     <div><div className="kpi-label">Credit notes — extra we pay</div><b style={{fontSize:22}}>{inr(s.creditNoteAmount)}</b><div className="sub">{s.creditNotes} current credit notes</div></div>
    </div>
    <div className="sub" style={{marginTop:10}}>A lot is settled with one debit or credit note. When the settlement is revised the ERP issues another note for the same lot and the first is replaced: the FIRST note is the initial settlement, the LATEST is the final one. Original bill value = the supplier's bill including GST. Settlement value = bill value less the deductions (debit note and journal), before any advance already paid; a credit note adds to what is payable, so its amount is extra we pay. Loss because of resettlement = final settlement value − first settlement value, i.e. the deduction first taken and later given back; a negative figure is a gain.</div>
   </div>
   <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap',alignItems:'center'}}>
    <button type="button" className={`btn ${tab==='lots'?'btn-primary':'btn-outline'}`} onClick={()=>setTab('lots')}>Re-settled lots • {data.lots.length}</button>
    <button type="button" className={`btn ${tab==='cn'?'btn-primary':'btn-outline'}`} onClick={()=>setTab('cn')}>Credit notes (extra payable) • {data.creditNotes.length}</button>
    <div className="field compact-field" style={{flex:'1 1 260px',display:'flex',alignItems:'center',gap:6}}><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search supplier, lot or note number" style={{flex:1}}/></div>
    <button type="button" className="btn btn-outline" onClick={()=>void download()}><Download size={16}/>Download Excel</button>
   </div>
   <div className="card" style={{marginTop:10,padding:0}}><div className="table-wrap" style={{maxHeight:'66vh',overflow:'auto'}}>
    {tab==='lots'?<table><thead><tr><th>Supplier</th><th>Lot</th><th style={{textAlign:'right'}}>Original bill value</th><th>First note</th><th style={{textAlign:'right'}}>First deduction</th><th style={{textAlign:'right'}}>First settlement value</th><th>Final note</th><th style={{textAlign:'right'}}>Final deduction</th><th style={{textAlign:'right'}}>Final settlement value</th><th style={{textAlign:'right'}}>Loss / (gain) because of resettlement</th><th>Tally check</th></tr></thead><tbody>
     {lots.map(l=>{const c=check(l);return <tr key={l.lot}>
      <td><b>{l.tallyParty||l.supplier}</b><div className="sub">{l.product}</div></td><td>{l.lot}{l.notes.length>2?<div className="sub">{l.notes.length} notes in all</div>:null}</td>
      <td style={{textAlign:'right',fontWeight:600}}>{inr(l.originalBill)}</td><td>{l.first.ref}<div className="sub">{day(l.first.date)} • {l.first.kind}</div></td><td style={{textAlign:'right'}}>{inr(l.firstDeduction)}</td><td style={{textAlign:'right'}}>{inr(l.first.net)}</td>
      <td>{l.last.ref}<div className="sub">{day(l.last.date)} • {l.last.kind}</div></td><td style={{textAlign:'right'}}>{inr(l.finalDeduction)}</td><td style={{textAlign:'right',fontWeight:600}}>{inr(l.last.net)}</td>
      <td style={{textAlign:'right',fontWeight:600,color:(l.loss||0)>0?'#b42318':(l.loss||0)<0?'#067647':undefined}}>{l.loss==null?'—':(l.loss>0?inr(l.loss):`(${inr(-l.loss)})`)}<div className="sub">{(l.loss||0)>0?'loss':(l.loss||0)<0?'gain':''}</div></td>
      <td style={{maxWidth:260}}><span className={c.tone==='ok'?'':'sub'} style={{color:c.tone==='ok'?'#067647':c.tone==='warn'?'#b54708':undefined}}>{c.t}</span>{l.outstanding!=null?<div className="sub">Outstanding now {inr(l.outstanding)}</div>:null}</td></tr>})}
     {!lots.length?<tr><td colSpan={11}><div className="empty">No re-settled lots match.</div></td></tr>:null}</tbody></table>
    :<table><thead><tr><th>Supplier</th><th>Lot</th><th>Credit note</th><th>Date</th><th style={{textAlign:'right'}}>Credit note amount (extra payable)</th><th>Re-settled lot</th></tr></thead><tbody>
     {cns.map(c=><tr key={c.note+c.lot}><td><b>{c.tallyParty||c.supplier}</b><div className="sub">{c.product}</div></td><td>{c.lot}</td><td>{c.note}</td><td>{day(c.date)}</td><td style={{textAlign:'right',fontWeight:600}}>{inr(c.amount)}</td><td>{c.resettled?'Yes':'—'}</td></tr>)}
     {!cns.length?<tr><td colSpan={6}><div className="empty">No credit notes match.</div></td></tr>:null}
     {cns.length?<tr><td colSpan={4} style={{textAlign:'right'}}><b>Total</b></td><td style={{textAlign:'right'}}><b>{inr(cns.reduce((a,c)=>a+c.amount,0))}</b></td><td/></tr>:null}</tbody></table>}
   </div></div>
  </>:null}
 </>;
}
