'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import type {ComponentType} from 'react';

type Item={href:string;label:string;icon:ComponentType<{size?:number}>};

// A slim, always-at-the-top link row for a module's own sub-pages
// (Analytics, Reports, Tickets, …) — replaces the old big tile-grid
// section that used to sit at the bottom of the page.
export function SubNav({items}:{items:Item[]}){
 const pathname=usePathname();
 return <div className="sub-nav">{items.map(it=>{const I=it.icon,active=pathname===it.href;return <Link key={it.href} href={it.href} className={active?'active':''}><I size={14}/>{it.label}</Link>})}</div>;
}
