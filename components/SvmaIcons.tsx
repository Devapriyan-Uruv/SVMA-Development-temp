import type {SVGProps,ReactNode} from 'react';

type Props=SVGProps<SVGSVGElement>&{size?:number};
function Base({size=20,children,...p}:Props&{children:ReactNode}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>}
export function OverviewIcon(p:Props){return <Base {...p}><path d="M4 11.5 12 5l8 6.5v7.5H4z"/><path d="M8 19v-5h8v5"/></Base>}
export function CeoIcon(p:Props){return <Base {...p}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 15v-3M12 15V8M16 15v-5"/><path d="M7 18h10"/></Base>}
export function SolventIcon(p:Props){return <Base {...p}><path d="M5 20V9h4V5h6v4h4v11"/><path d="M3 20h18M8 12h2M14 12h2M8 16h2M14 16h2"/></Base>}
export function QualityIcon(p:Props){return <Base {...p}><path d="M9 3h6M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 17l-5-9V3"/><path d="M7.5 15h9M9 12h6"/></Base>}
export function FinanceIcon(p:Props){return <Base {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 14h3M15.5 12v4M13.5 14h4"/></Base>}
export function SolventInputIcon(p:Props){return <Base {...p}><path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h3"/><path d="m15 15 1.5 1.5L19 14"/></Base>}
export function QualityInputIcon(p:Props){return <Base {...p}><path d="M12 3 5 6v5c0 4.5 2.6 7.8 7 10 4.4-2.2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></Base>}
export function ReportsIcon(p:Props){return <Base {...p}><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6M9 19h4"/></Base>}
export function AdminIcon(p:Props){return <Base {...p}><circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2M18 5l2-1M18 11l2 1M6 5 4 4M6 11l-2 1"/></Base>}
