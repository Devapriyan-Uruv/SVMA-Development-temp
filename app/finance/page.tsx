import Link from 'next/link';
import { ArrowRight, BadgeIndianRupee, CheckCircle2, CircleAlert, GitBranch, ReceiptText, Scale } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { currentUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const defaultFinanceRoles=new Set(['super_admin','admin','ceo','management','finance_user','finance_manager']);

export default async function FinanceDashboard() {
  let latestTransaction:any=null,latestVendor:any=null,exceptions=0;let canTransaction=false,canVendor=false;
  try {
    const user=await currentUser();const db=supabaseAdmin();
    if(user){
      const roleRows=(await db.from('user_roles').select('role').eq('user_id',user.id)).data||[];const roles=roleRows.map((x:any)=>String(x.role));
      let access:any[]=[];try{access=(await db.from('user_module_access').select('module,can_view').eq('user_id',user.id)).data||[]}catch{}
      if(roles.includes('super_admin')){canTransaction=true;canVendor=true}
      else if(access.length){canTransaction=access.some(x=>x.module==='finance_transaction'&&x.can_view);canVendor=access.some(x=>x.module==='finance_vendor_payment'&&x.can_view)}
      else{const roleAllows=roles.some((r:string)=>defaultFinanceRoles.has(r));canTransaction=roleAllows;canVendor=roleAllows}
    }
    latestTransaction=(await db.from('reconciliation_runs').select('*').eq('reconciliation_type','transaction').eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
    latestVendor=(await db.from('reconciliation_runs').select('*').eq('reconciliation_type','vendor_payment').eq('status','completed').order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
    exceptions=(await db.from('reconciliation_exceptions').select('id',{count:'exact',head:true}).eq('status','open')).count||0;
  } catch {}
  const t=latestTransaction?.summary||{};const v=latestVendor?.summary||{};
  const physical=t.physicalMovements??t.weighments??'—';
  const financeReview=(Number(t.needsReview||0)+Number(v.needsReview||0)+Number(v.sourceMissing||0));
  return <>
    <PageHeader title="Finance" subtitle="Transaction Reconciliation and Purchase Payment Reconciliation" backHref="/" backLabel="Home"/>
    <div className="module-grid" style={{marginTop:6}}>
      {canTransaction?<Link href="/finance/transaction" className="module-card accent-indigo"><div className="module-icon"><Scale size={17}/></div><div className="module-copy"><h2>Transaction Reconciliation</h2><p>Compare purchases and sales with Tally.</p></div><ArrowRight className="module-arrow" size={15}/></Link>:null}
      {canTransaction?<Link href="/finance/one-reconciliation" className="module-card accent-violet"><div className="module-icon"><GitBranch size={17}/></div><div className="module-copy"><h2>One Reconciliation</h2><p>One engine, one Recon ID per transaction: Weighment → ERP → QC → Settlement → Tally, driven by the Product Master.</p></div><ArrowRight className="module-arrow" size={15}/></Link>:null}
      {canTransaction?<Link href="/finance/outstanding" className="module-card accent-amber"><div className="module-icon"><BadgeIndianRupee size={17}/></div><div className="module-copy"><h2>Creditors / Debtors</h2><p>Upload the Tally Day Book — outstanding by party and lot, split into Local and International.</p></div><ArrowRight className="module-arrow" size={15}/></Link>:null}
      {canTransaction?<Link href="/finance/resettlement" className="module-card accent-violet"><div className="module-icon"><GitBranch size={17}/></div><div className="module-copy"><h2>Resettlement data</h2><p>Lots whose debit / credit note was replaced by a later settlement, what changed, and the credit notes we pay extra.</p></div><ArrowRight className="module-arrow" size={15}/></Link>:null}
      {canTransaction?<Link href="/finance/day-summary" className="module-card accent-green"><div className="module-icon"><ReceiptText size={17}/></div><div className="module-copy"><h2>Day Summary Ledger</h2><p>Upload a day's Tally Day Book: purchases, sales, receipts and bank payments (firewood separate), checked against the ERP with an Excel.</p></div><ArrowRight className="module-arrow" size={15}/></Link>:null}
      {canVendor?<Link href="/finance/amount" className="module-card accent-green"><div className="module-icon"><ReceiptText size={17}/></div><div className="module-copy"><h2>Purchase Payment Reconciliation</h2><p>Compare vendor payments and review amount differences.</p></div><ArrowRight className="module-arrow" size={15}/></Link>:null}
      <Link href="/finance/exceptions" className="module-card accent-amber"><div className="module-icon"><CircleAlert size={17}/></div><div className="module-copy"><h2>Exception Centre</h2><p>ERP missing, Tally missing, ambiguous matches and payment exceptions requiring Finance action.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
    </div>
    <div className="ticket-counts" style={{marginTop:16}}>
      <div><Scale size={14}/><span>Physical{latestTransaction?.reconciliation_date?` • ${latestTransaction.reconciliation_date}`:' • no run yet'}</span><b>{physical}</b></div>
      <div><CircleAlert size={14}/><span>ERP missing</span><b>{t.erpMissing??'—'}</b></div>
      <div><ReceiptText size={14}/><span>Tally missing</span><b>{t.tallyMissing??'—'}</b></div>
      <div><CheckCircle2 size={14}/><span>Payments verified</span><b>{v.correct??'—'}</b></div>
      <div><BadgeIndianRupee size={14}/><span>Overpaid{typeof v.netVariance==='number'?` • ₹${Math.round(v.netVariance).toLocaleString('en-IN')} net`:''}</span><b>{v.overpayments??'—'}</b></div>
      <div><BadgeIndianRupee size={14}/><span>Underpaid • {v.sourceMissing??0} source missing</span><b>{v.underpayments??'—'}</b></div>
      <div><CircleAlert size={14}/><span>Needs review</span><b>{financeReview||0}</b></div>
      <div><BadgeIndianRupee size={14}/><span>Open exception{exceptions===1?'':'s'}</span><b>{exceptions}</b></div>
    </div>
  </>;
}
