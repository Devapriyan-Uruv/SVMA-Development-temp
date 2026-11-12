'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {DuoIcon} from '@/components/DuoIcons';

// The module's own pages as one tab strip under the top bar. Presentation only: every tab is a plain link to a page that already exists, shown only
// when the signed-in user can already see that page (the same checks the old dock and the Home tiles use). Nothing is navigated for the user.
type Tab={label:string;href:string;perm?:string;badge?:string};
type Mod={key:string;title:string;icon:string;color:string;prefixes:string[];tabs:Tab[]};

const MODS:Mod[]=[
 {key:'ceo',title:'Management',icon:'mgmt',color:'#3D4FC4',prefixes:['/ceo'],tabs:[{label:'Cockpit',href:'/ceo',perm:'ceo'}]},
 {key:'solvent',title:'Solvent',icon:'solvent',color:'#0A6CE0',prefixes:['/solvent'],tabs:[
  {label:'Dashboard',href:'/solvent',perm:'solvent_management'},{label:'Data entry',href:'/solvent/data-entry',perm:'solvent_management'},{label:'Boiler',href:'/solvent/boiler',perm:'solvent_management'},
  {label:'Analytics',href:'/solvent/analytics',perm:'solvent_management'},{label:'Deviations',href:'/solvent/deviations',perm:'solvent_management'},{label:'Tickets',href:'/solvent/tickets',perm:'solvent_management'},
  {label:'Uruv.ai Insight',href:'/solvent/ai-inference',perm:'solvent_management'},{label:'Reports',href:'/solvent/reports',perm:'solvent_management'}]},
 {key:'input',title:'Solvent input',icon:'entry',color:'#0A6CE0',prefixes:['/input'],tabs:[
  {label:'Entry',href:'/input',perm:'input'},{label:'Hourly',href:'/input/hourly',perm:'input'},{label:'Boiler',href:'/input/boiler',perm:'input'},{label:'Inspection',href:'/input/inspection',perm:'input'}]},
 {key:'quality',title:'Quality',icon:'quality',color:'#7A3FA1',prefixes:['/quality'],tabs:[
  {label:'Dashboard',href:'/quality',perm:'quality_management'},{label:'Analytics',href:'/quality/analytics',perm:'quality_management'},{label:'Uruv.ai Insight',href:'/quality/ai-inference',perm:'quality_management'},
  {label:'Deviations',href:'/quality/deviations',perm:'quality_management'},{label:'Tickets',href:'/quality/tickets',perm:'quality_management'},{label:'Reports',href:'/quality/reports',perm:'quality_management'}]},
 {key:'quality_input',title:'Quality input',icon:'qentry',color:'#7A3FA1',prefixes:['/quality-input'],tabs:[
  {label:'Entry',href:'/quality-input',perm:'quality_input'},{label:'Lab',href:'/quality-input/lab',perm:'quality_input'},{label:'Shift',href:'/quality-input/shift',perm:'quality_input'}]},
 {key:'finance',title:'Finance',icon:'finance',color:'#0B8A57',prefixes:['/finance'],tabs:[
  {label:'Overview',href:'/finance',perm:'finance'},{label:'Transactions',href:'/finance/transaction',perm:'finance_transaction'},{label:'One reconciliation',href:'/finance/one-reconciliation',perm:'finance_transaction'},
  {label:'Creditors / Debtors',href:'/finance/outstanding',perm:'finance_transaction'},{label:'Resettlement',href:'/finance/resettlement',perm:'finance_transaction'},{label:'Day summary',href:'/finance/day-summary',perm:'finance_transaction'},
  {label:'Payments',href:'/finance/amount',perm:'finance_vendor_payment'},{label:'Exceptions',href:'/finance/exceptions',perm:'finance'},{label:'History',href:'/finance/history',perm:'finance'}]},
 {key:'import',title:'Import',icon:'import',color:'#0092D4',prefixes:['/import'],tabs:[
  {label:'Contracts and settlement',href:'/import/contracts',perm:'import'},{label:'Status',href:'/import/status',perm:'import'}]},
 {key:'export',title:'Export',icon:'export',color:'#5B6B80',prefixes:['/export'],tabs:[]},
 {key:'operations',title:'Operations',icon:'plant',color:'#BD7800',prefixes:['/operations'],tabs:[
  {label:'Overview',href:'/operations',perm:'operations_intelligence'},{label:'Control room',href:'/operations/control-room',perm:'operations_intelligence'},{label:'ERP data',href:'/operations/erp-data',perm:'operations_intelligence'},
  {label:'Data hub',href:'/operations/upload',perm:'operations_intelligence'},{label:'Production',href:'/operations/production',perm:'operations_intelligence'},{label:'Supply',href:'/operations/supply',perm:'operations_intelligence'},
  {label:'Sales',href:'/operations/sales',perm:'operations_intelligence'},{label:'Quality and settlement',href:'/operations/quality-settlement',perm:'operations_intelligence'},{label:'Inventory flow',href:'/operations/reconciliation',perm:'operations_intelligence'},
  {label:'Exceptions',href:'/operations/exceptions',perm:'operations_intelligence'},{label:'Tickets',href:'/operations/tickets',perm:'operations_intelligence'},{label:'Products',href:'/operations/products',perm:'operations_intelligence'},{label:'ERP settings',href:'/operations/erp-config',perm:'operations_intelligence'}]},
 {key:'work',title:'Work',icon:'work',color:'#C34872',prefixes:['/tickets','/approvals','/reports','/announcements'],tabs:[
  {label:'Tickets',href:'/tickets',perm:'tickets'},{label:'Approvals',href:'/approvals',perm:'approvals',badge:'pendingApprovalsCount'},{label:'Reports',href:'/reports',perm:'reports'},{label:'Announcements',href:'/announcements',perm:'announcements',badge:'unreadAnnouncementCount'}]},
 {key:'people',title:'People',icon:'people',color:'#6D4CC7',prefixes:['/hr','/assets'],tabs:[
  {label:'My HR',href:'/hr/my',perm:'hr_self',badge:'pendingLeaveApprovalsCount'},{label:'HR console',href:'/hr',perm:'hr'},{label:'Assets',href:'/assets',perm:'assets'}]},
 {key:'admin',title:'Admin',icon:'admin',color:'#475569',prefixes:['/admin','/ai-credits'],tabs:[
  {label:'Users and setup',href:'/admin',perm:'admin'},{label:'Access requests',href:'/admin/access-requests',perm:'access_requests',badge:'pendingAccessRequestsCount'},{label:'Tally Connect',href:'/admin/tally',perm:'tally_connect'},{label:'URUV credits',href:'/ai-credits',perm:'ai_credits'}]},
];

// Your own live data-entry shift: name, time left and a segmented progress bar. Shown only while you have a shift running.
function ShiftClock({shift}:{shift:any}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(t)},[]);
 const end=Date.parse(shift?.scheduled_end||''),start=Date.parse(shift?.scheduled_start||'');
 if(!Number.isFinite(end))return null;
 const left=Math.max(0,Math.round((end-now)/60000)),h=Math.floor(left/60),m=left%60;
 const total=Number.isFinite(start)&&end>start?end-start:0,done=total?Math.min(1,Math.max(0,(now-start)/total)):0,filled=Math.round(done*8);
 return <div className="module-strip-shift" title="Your live shift"><div><span>{(shift?.shift_master?.name||'SHIFT').toString().toUpperCase()}</span><b className="num">{left>0?`${h}h ${String(m).padStart(2,'0')}m left`:'Shift ended'}</b></div><div className="seg8" aria-hidden="true">{Array.from({length:8}).map((_,i)=><i key={i} className={i<filled?'f':i===filled?'c':''}/>)}</div></div>;
}
function under(path:string,prefix:string){return path===prefix||path.startsWith(prefix+'/')}
export function moduleFor(pathname:string):Mod|null{
 let best:Mod|null=null,len=-1;
 for(const m of MODS)for(const p of m.prefixes)if(under(pathname,p)&&p.length>len){best=m;len=p.length}
 // /quality-input is its own module, not a sub-page of /quality
 return best;
}

export function ModuleStrip({pathname,can,me}:{pathname:string;can:(perm:string)=>boolean;me:any}){
 const mod=moduleFor(pathname);
 if(!mod)return null;
 const tabs=mod.tabs.filter(t=>!t.perm||can(t.perm));
 // the most specific matching tab is "the" current one (/hr/my must not also light /hr)
 let current='',len=-1;
 for(const t of tabs)if(under(pathname,t.href)&&t.href.length>len){current=t.href;len=t.href.length}
 return <nav className="module-strip" style={{['--c' as any]:mod.color}} aria-label={`${mod.title} pages`}>
  <div className="module-strip-name"><i/><DuoIcon name={mod.icon} size={20}/><b>{mod.title}</b></div>
  {tabs.length?<div className="module-strip-tabs">{tabs.map(t=>{const n=t.badge?Number(me?.[t.badge]||0):0;return <Link key={t.href} href={t.href} className={t.href===current?'on':''}>{t.label}{n>0?<em>{n>9?'9+':n}</em>:null}</Link>})}</div>:null}
  {me?.activeShift?<ShiftClock shift={me.activeShift}/>:null}
 </nav>;
}
