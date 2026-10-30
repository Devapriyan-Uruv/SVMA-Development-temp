'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UploadCloud, Factory, Truck, FlaskConical, ShoppingCart, Scale, CircleAlert, Ticket, Boxes, Settings } from 'lucide-react';

// Same 10 modules as the /operations hub cards, as a compact icon strip so
// moving between modules doesn't require going back to the hub each time.
const MODULES = [
 { href: '/operations/upload', icon: UploadCloud, label: 'Upload' },
 { href: '/operations/production', icon: Factory, label: 'Production' },
 { href: '/operations/supply', icon: Truck, label: 'Supply' },
 { href: '/operations/quality-settlement', icon: FlaskConical, label: 'Quality & Settlement' },
 { href: '/operations/sales', icon: ShoppingCart, label: 'Sales' },
 { href: '/operations/reconciliation', icon: Scale, label: 'Inventory' },
 { href: '/operations/exceptions', icon: CircleAlert, label: 'Exceptions' },
 { href: '/operations/tickets', icon: Ticket, label: 'Tickets' },
 { href: '/operations/products', icon: Boxes, label: 'Products' },
 { href: '/operations/erp-config', icon: Settings, label: 'ERP Config' },
];

export function OperationsNav() {
 const pathname = usePathname();
 return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
  {MODULES.map(m => {
   const active = pathname === m.href;
   const Icon = m.icon;
   return <Link key={m.href} href={m.href} className="icon-link" title={m.label}
    style={active ? { background: '#eef5fb', borderColor: '#d9e5f2', color: 'var(--navy)', fontWeight: 850 } : undefined}>
    <Icon size={15} /><span>{m.label}</span>
   </Link>;
  })}
 </div>;
}
