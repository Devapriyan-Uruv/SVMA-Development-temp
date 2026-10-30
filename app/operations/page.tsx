import Link from 'next/link';
import {ArrowRight, Boxes, CircleAlert, FlaskConical, Factory, Scale, Settings, ShoppingCart, Ticket, Truck, UploadCloud} from 'lucide-react';
import {PageHeader} from '@/components/PageHeader';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function OpsIntelligenceHub() {
  let openExceptions = 0, criticalExceptions = 0, openTickets = 0, asOfDate: string | null = null;
  try {
    const db = supabaseAdmin();
    const { data: summary } = await db.from('ops_daily_control_summary').select('*').order('report_date', { ascending: false }).limit(1).maybeSingle();
    if (summary) { openExceptions = (summary as any).open_exceptions_count || 0; criticalExceptions = (summary as any).critical_exceptions_count || 0; openTickets = (summary as any).open_erp_tickets_count || 0; asOfDate = (summary as any).report_date; }
  } catch {}
  return <>
    <PageHeader title="Operations Intelligence" subtitle="" backHref="/" backLabel="Home"/>
    <div className="module-grid" style={{ marginTop: 6 }}>
      <Link href="/operations/upload" className="module-card accent-indigo"><div className="module-icon"><UploadCloud size={17}/></div><div className="module-copy"><h2>Operations Data Hub</h2><p>Upload Feeding, Production, Stock Summary and Raw Material Batch Stock reports.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/production" className="module-card accent-green"><div className="module-icon"><Factory size={17}/></div><div className="module-copy"><h2>Production Intelligence</h2><p>Daily/shift production by product.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/supply" className="module-card accent-amber"><div className="module-icon"><Truck size={17}/></div><div className="module-copy"><h2>Supply Intelligence</h2><p>Purchase Order → Gate → Weighment → Lot.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/quality-settlement" className="module-card accent-rose"><div className="module-icon"><FlaskConical size={17}/></div><div className="module-copy"><h2>Quality &amp; Settlement</h2><p>Inward QC lab results vs commercial settlement.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/sales" className="module-card accent-indigo"><div className="module-icon"><ShoppingCart size={17}/></div><div className="module-copy"><h2>Sales &amp; Fulfilment</h2><p>Dispatch vs invoicing, and Free-to-Sell availability.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/reconciliation" className="module-card accent-amber"><div className="module-icon"><Scale size={17}/></div><div className="module-copy"><h2>Inventory &amp; Material Flow</h2><p>Production-to-Stock and Raw Material reconciliation.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/exceptions" className="module-card accent-rose"><div className="module-icon"><CircleAlert size={17}/></div><div className="module-copy"><h2>Exceptions &amp; Actions</h2><p>Deterministic deviations flagged for review.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/tickets" className="module-card accent-indigo"><div className="module-icon"><Ticket size={17}/></div><div className="module-copy"><h2>Operations Tickets</h2><p>Tickets auto-created from Operations exceptions.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/products" className="module-card accent-green"><div className="module-icon"><Boxes size={17}/></div><div className="module-copy"><h2>Products &amp; Mapping</h2><p>Product master and AI-suggested alias approval.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
      <Link href="/operations/erp-config" className="module-card accent-amber"><div className="module-icon"><Settings size={17}/></div><div className="module-copy"><h2>ERP Configuration</h2><p>Uruv.ai ERP Data Push report catalogue and navigation.</p></div><ArrowRight className="module-arrow" size={15}/></Link>
    </div>
    <div className="ticket-counts" style={{ marginTop: 16 }}>
      <div><Factory size={14}/><span>Data as of</span><b>{asOfDate || 'No data yet'}</b></div>
      <div><CircleAlert size={14}/><span>Open exceptions</span><b>{openExceptions}</b></div>
      <div><CircleAlert size={14}/><span>Critical</span><b>{criticalExceptions}</b></div>
      <div><Ticket size={14}/><span>Open tickets</span><b>{openTickets}</b></div>
    </div>
  </>;
}
