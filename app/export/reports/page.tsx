'use client';
import {useEffect,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {EXPORT_STATUS_LABELS} from '@/lib/trade';

function inr(n:number){return `₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`}

export default function ExportReportsPage(){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{fetch('/api/export/reports',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.error)setError(j.error);else setData(j)}).catch(()=>setError('Unable to load report'))},[]);
 return <>
  <PageHeader title="Export Reports" subtitle="The same Export Monitoring Summary the desk already tracked by hand, now live." backHref="/export" backLabel="Export"/>
  {error?<div className="notice danger">{error}</div>:null}
  {!data?<div className="empty">Loading…</div>:<>
   <div className="grid four" style={{marginBottom:16}}>
    <div className="card"><span className="kpi-label">Total Contract Value</span><div className="kpi-value">{data.summary.totalContractValue.toLocaleString('en-IN')}</div></div>
    <div className="card"><span className="kpi-label">Advance Received</span><div className="kpi-value">{data.summary.totalAdvanceReceived.toLocaleString('en-IN')}</div></div>
    <div className="card"><span className="kpi-label">Total Realised</span><div className="kpi-value">{data.summary.totalRealisedAmount.toLocaleString('en-IN')}</div></div>
    <div className="card"><span className="kpi-label">Outstanding Bills</span><div className="kpi-value">{data.summary.outstandingExportBills.toLocaleString('en-IN')}</div></div>
   </div>
   <div className="grid four" style={{marginBottom:16}}>
    <div className="card"><span className="kpi-label">Total Interest</span><div className="kpi-value">{inr(data.summary.totalInterest)}</div></div>
    <div className="card"><span className="kpi-label">Total Bank Charges</span><div className="kpi-value">{inr(data.summary.totalBankCharges)}</div></div>
    <div className="card"><span className="kpi-label">Total IGST Refund</span><div className="kpi-value">{inr(data.summary.totalIgstRefund)}</div></div>
    <div className="card"><span className="kpi-label">Overdue Bills</span><div className="kpi-value">{data.summary.overdueBillsCount}</div></div>
   </div>

   <div className="card" style={{marginBottom:16}}>
    <div className="section-title">Overdue realisation ageing</div>
    <div className="table-wrap" style={{marginTop:10}}><table><thead><tr><th>Ref Code</th><th>Customer</th><th>Due Date</th><th>Outstanding</th><th>Days Overdue</th><th>Reason</th></tr></thead><tbody>
     {data.overdueAgeing.map((r:any)=><tr key={r.id}><td><a href={`/export/${r.id}`}>{r.refCode}</a></td><td>{r.party}</td><td>{r.dueDate}</td><td>{r.currency} {Number(r.outstandingFcy||0).toLocaleString('en-IN')}</td><td><span className="pill danger">{r.daysOverdue}d</span></td><td>{r.reasonForDelay||'—'}</td></tr>)}
     {!data.overdueAgeing.length?<tr><td colSpan={6} className="sub">Nothing overdue.</td></tr>:null}
    </tbody></table></div>
   </div>

   <div className="card">
    <div className="section-title">Status funnel</div>
    <div style={{display:'grid',gap:8,marginTop:10}}>
     {data.statusFunnel.map((s:any)=><div key={s.status} className="split-header"><span className="sub">{EXPORT_STATUS_LABELS[s.status]||s.status}</span><b>{s.count}</b></div>)}
    </div>
   </div>
  </>}
 </>;
}
