'use client';
import {useEffect,useState} from 'react';

type Line={categoryId:number;categoryName:string;sortOrder:number;value:number;gst:number;note:string};

function money(n:number){return `₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`}

// The landed-cost breakdown every commodity sheet in the source data
// shares: one row per configured cost category (see trade_cost_categories
// — commodity-specific extras like "Fumigation" on Soya Bean only show up
// here because the category itself is scoped that way, no code change
// needed), each with Value + GST -> Total, and a Rate/Ton computed from
// whatever quantity the caller passes in.
export function CostLinesEditor({apiBase,quantity,unit,canEdit}:{apiBase:string;quantity:number;unit:string;canEdit:boolean}){
 const [lines,setLines]=useState<Line[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 function load(){setLoading(true);fetch(apiBase,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setLines(j.lines||[])}).catch(()=>{}).finally(()=>setLoading(false))}
 useEffect(()=>{load()},[apiBase]);
 function update(categoryId:number,field:'value'|'gst',v:string){
  setLines(x=>x.map(l=>l.categoryId===categoryId?{...l,[field]:Number(v)||0}:l));
 }
 async function save(){
  setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch(apiBase,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({lines:lines.map(l=>({categoryId:l.categoryId,value:l.value,gst:l.gst,note:l.note}))})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setNotice('Costing saved.');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save costing')}finally{setBusy(false)}
 }
 if(loading)return <div className="empty">Loading costing…</div>;
 const totalValue=lines.reduce((s,l)=>s+Number(l.value||0),0);
 const totalGst=lines.reduce((s,l)=>s+Number(l.gst||0),0);
 const grandTotal=totalValue+totalGst;
 const rateIncGst=quantity>0?grandTotal/quantity:0;
 const rateExGst=quantity>0?totalValue/quantity:0;
 return <div className="card">
  {error?<div className="notice danger" style={{marginBottom:10}}>{error}</div>:null}
  {notice?<div className="notice" style={{marginBottom:10}}>{notice}</div>:null}
  <div className="table-wrap"><table><thead><tr><th>Particulars</th><th>Value</th><th>GST</th><th>Total</th></tr></thead><tbody>
   {lines.map(l=><tr key={l.categoryId}>
    <td>{l.categoryName}</td>
    <td><input type="number" className="matrix-input" disabled={!canEdit} value={l.value} onChange={e=>update(l.categoryId,'value',e.target.value)}/></td>
    <td><input type="number" className="matrix-input" disabled={!canEdit} value={l.gst} onChange={e=>update(l.categoryId,'gst',e.target.value)}/></td>
    <td>{money(l.value+l.gst)}</td>
   </tr>)}
   <tr><td><b>Total</b></td><td><b>{money(totalValue)}</b></td><td><b>{money(totalGst)}</b></td><td><b>{money(grandTotal)}</b></td></tr>
   <tr><td colSpan={3} className="sub">Rate per {unit} (incl. GST)</td><td>{money(rateIncGst)}</td></tr>
   <tr><td colSpan={3} className="sub">Rate per {unit} (excl. GST)</td><td>{money(rateExGst)}</td></tr>
  </tbody></table></div>
  {canEdit?<button className="btn btn-primary" style={{marginTop:14}} disabled={busy} onClick={save}>{busy?'Saving…':'Save costing'}</button>:null}
 </div>;
}
