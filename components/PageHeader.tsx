import Link from 'next/link';
import type { ReactNode } from 'react';
import {ChevronLeft} from 'lucide-react';
export function PageHeader({ title, subtitle, action, backHref, backLabel='Back', eyebrow }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode; backHref?: string; backLabel?: string }) {
  return <div className="topbar page-heading"><div className="page-heading-copy">{backHref?<Link className="back-link" href={backHref}><ChevronLeft size={15}/>{backLabel}</Link>:null}{eyebrow?<div className="v3-eyebrow">{eyebrow}</div>:null}<div className="title">{title}</div>{subtitle ? <div className="sub">{subtitle}</div> : null}</div>{action?<div className="page-heading-action">{action}</div>:null}</div>;
}
