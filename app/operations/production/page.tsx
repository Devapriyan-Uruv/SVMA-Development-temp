'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {Kpi} from '@/components/Kpi';
import {Factory,Layers,Package} from 'lucide-react';
import {OpsPeriodFilter,defaultOpsPeriod,type OpsPeriod} from '@/components/OpsPeriodFilter';
import {OperationsNav} from '@/components/ops/OperationsNav';
import {BarCompare} from '@/components/IntelligenceCharts';

export default function ProductionIntelligencePage(){
 const [period,setPeriod]=useState<OpsPeriod>(defaultOpsPeriod());
 const [data,setData]=useState<any>(null);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');

 useEffect(()=>{
  const c=new AbortController();setBusy(true);setError('');
  fetch(`/api/ops/production/dashboard?from=${period.from}&to=${period.to}`,{signal:c.signal})
   .then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j})
   .then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});
  return()=>c.abort();
 },[period]);

 return <>
  <PageHeader title="Production Intelligence" subtitle="Feeding, shift and product-level production from uploaded ERP Production Reports." backHref="/operations" backLabel="Operations Intelligence"/>
  <OperationsNav/>
  <div className="card" style={{marginTop:14,padding:'12px 14px'}}><OpsPeriodFilter period={period} onChange={setPeriod}/></div>
  {error?<div className="notice danger" style={{marginTop:12}}>{error}</div>:null}
  {busy?<div className="empty" style={{marginTop:14}}>Loading…</div>:data?<>
   <div className="grid kpis" style={{marginTop:14}}>
    <Kpi icon={Factory} tone="blue" label="Total production (MT)" value={data.totalWeightMt.toFixed(2)} foot={`${period.label}: ${period.from} to ${period.to}`}/>
    <Kpi icon={Layers} tone="green" label="Products with output" value={data.byProduct.length}/>
    <Kpi icon={Package} tone="purple" label="Shift/day rows" value={data.byShift.length}/>
   </div>
   <section className="card" style={{marginTop:14}}>
    <div className="section-title">By product (MT packings are matched against Stock Summary's own unit per product; bag/unit-count packings are informational only, not reconciled numerically)</div>
    <div className="table-wrap" style={{marginTop:8}}><table><thead><tr><th>Product</th><th>Weight (MT)</th><th>Count packing (units)</th></tr></thead><tbody>
     {data.byProduct.map((p:any)=><tr key={p.productKey}><td>{p.name}</td><td>{p.weightQty.toFixed(3)}</td><td>{p.countQty.toFixed(1)}</td></tr>)}
     {!data.byProduct.length?<tr><td colSpan={3} className="sub">No production rows for this period.</td></tr>:null}
    </tbody></table></div>
   </section>
   <section className="card" style={{marginTop:14}}>
    <div className="section-title">Production by shift — which shift performs best</div>
    <p className="sub" style={{marginTop:2}}>Total MT across the selected period, summed per shift (not broken down by day).</p>
    <div style={{marginTop:8}}><BarCompare bars={data.byShiftTotal.map((s:any)=>({label:s.shift,value:s.weightQty}))}/></div>
   </section>
  </>:null}
 </>;
}
