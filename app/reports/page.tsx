import Link from 'next/link';
import {PageHeader} from '@/components/PageHeader';
import {QualityIcon,SolventIcon,FinanceIcon} from '@/components/SvmaIcons';

const cards=[
 {href:'/quality/reports',title:'Quality Reports',Icon:QualityIcon,accent:'purple'},
 {href:'/solvent/reports',title:'Solvent Reports',Icon:SolventIcon,accent:'blue'},
 {href:'/finance/history',title:'Purchase & Sales',Icon:FinanceIcon,accent:'green'},
 {href:'/finance/history?type=vendor_payment',title:'Vendor Payments',Icon:FinanceIcon,accent:'amber'},
];
export default function Reports(){return <><PageHeader title="Reports" subtitle="Your shift and daily reports, ready to download." backHref="/" backLabel="Home"/><div className="overview-grid" style={{marginTop:14}}>{cards.map(({href,title,Icon,accent})=><Link href={href} className={`overview-tile tone-${accent}`} key={title}><span className="overview-tile-icon"><Icon size={22}/></span><b>{title}</b></Link>)}</div></>}
