'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
<<<<<<< HEAD
import { TicketCheck, BadgeIndianRupee, ChartNoAxesCombined, Droplets, Microscope, FileInput, ClipboardCheck, Wallet, Gauge, SlidersHorizontal, Sparkles, Landmark,FileUp,SendHorizontal,TrendingUp,Settings,ShieldCheck} from 'lucide-react';
=======
import {ArrowUpRight,Sparkles} from 'lucide-react';
>>>>>>> 24770ea1 (Modern look for every module: top bar with module tab strip, duotone icons, Home launcher with Ask Uruvan and Needs you, Solvent / Quality / Management / Finance / Tickets / Boiler redesigned to the design canvas (AI reading and 3-day production and sales outlook on Management))
import {SkeletonKpis, SkeletonLine} from '@/components/Skeleton';
import {InstallAppCard} from '@/components/InstallAppCard';
import {greetingFor, friendlyName} from '@/lib/greeting';
import {DuoIcon} from '@/components/DuoIcons';

<<<<<<< HEAD
type Card={module:string;href:string;title:string;icon:any;accent:string};
const cards: Card[] = [{module:'ceo',href:'/ceo',title:'Management',icon:Landmark,accent:'violet'},
  {module:'solvent_management',href:'/solvent',title:'Solvent',icon:Droplets,accent:'blue'},
  {module:'quality_management',href:'/quality',title:'Quality',icon:Microscope,accent:'purple'},
  {module:'input',href:'/input',title:'Solvent Input',icon:FileInput,accent:'cyan'},
  {module:'quality_input',href:'/quality-input',title:'Quality Input',icon:ClipboardCheck,accent:'rose'},
   {module:'import',href:'/import',title:'Import',icon:FileUp,accent:'indigo'},
  {module:'export',href:'/export',title:'Export',icon:SendHorizontal,accent:'red'},
  {module:'finance',href:'/finance',title:'Finance',icon:Wallet,accent:'green'},
  {module:'tickets',href:'/tickets',title:'Tickets',icon:TicketCheck,accent:'rose'},
  {module:'operations_intelligence',href:'/operations',title:'Operations Intelligence',icon:ChartNoAxesCombined,accent:'amber'},
  {module:'admin',href:'/admin',title:'Admin',icon:SlidersHorizontal,accent:'slate'}
];
export default function Home() {
  const [me, setMe] = useState<any>();
  const [error, setError] = useState("");
  const [greeting, setGreeting] = useState("");
  const [insight, setInsight] = useState<any>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Unable to load access (${r.status})`);
        return j;
      })
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load access"));
  }, []);

  useEffect(() => {
    const update = () => setGreeting(greetingFor(new Date().getHours()));
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/insights/banner", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j.error) setInsight(j); })
      .catch(() => {});
  }, []);

  const modules: string[] = me?.modules || [];
  const can = (m: string) => m === "finance" ? modules.includes("finance_transaction") || modules.includes("finance_vendor_payment") : modules.includes(m);
  const visible = cards.filter((c) => can(c.module));
  const name = friendlyName(me?.profile?.full_name, me?.user?.email);

  const welcomeStrip = (
    <section className="welcome-strip">
      <div className="welcome-content">
        <span className="eyebrow"><Sparkles size={14} /> YOUR DAILY WORKSPACE</span>
        <h1>{greeting || "Welcome"}{me ? `, ${name}` : ""}</h1>
        <p>Everything you need for today’s operations, in one place.</p>
        
      </div>
      <div className="welcome-message-card"><b>Smarter Operations<br />for a Better Tomorrow</b><span /></div>
    </section>
  );

  if (!me && !error) {
    return (
      <div className="dashboard-page">
        {welcomeStrip}
        <div style={{ marginTop: 16 }}><SkeletonKpis count={3} /></div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      {welcomeStrip}
      <InstallAppCard />
      {insight?.headline ? <div className="ai-banner"><span className="ai-banner-icon"><Sparkles size={16} /></span><div><b>{insight.headline}</b>{insight.detail ? <span>{insight.detail}</span> : null}</div></div> : null}
      {error ? <div className="session-error-banner" style={{ marginBottom: 16 }}><b>Workspace access is unavailable.</b><span>{error}</span><small>Your module cards will appear once the access profile loads successfully.</small></div> : null}
      <div className="overview-grid">
        {visible.map((c) => { const I = c.icon; return <Link href={c.href} key={c.href} className={`overview-tile tone-${c.accent}`}><span className={`overview-tile-icon icon-${c.accent}`}><I size={27} strokeWidth={1.8} /></span><b>{c.title}</b></Link>; })}
      </div>
      {me && visible.length === 0 ? <div className="card empty">No module access is assigned to this account. Contact the SVMA Super Admin.</div> : null}
    </div>
  );
}

=======
// Module launcher. The same modules, the same links and the same access checks as before — only the presentation changed (a bento of module tiles,
// then a row of everyday tools that used to live in the bottom dock). The numbers on tiles are real counts from /api/me; nothing is invented.
type Tile={module:string;href:string;title:string;desc:string;icon:string;color:string;size:'lg'|'md'|'sm';badge?:string;badgeLabel?:string;soon?:boolean};
const tiles:Tile[]=[
 {module:'solvent_management',href:'/solvent',title:'Solvent',desc:'Production, safety, boiler and deviations',icon:'solvent',color:'#0A6CE0',size:'lg',badge:'solventOpen',badgeLabel:'open tickets'},
 {module:'quality_management',href:'/quality',title:'Quality',desc:'Lab results, analytics and Uruv.ai insight',icon:'quality',color:'#7A3FA1',size:'md',badge:'qualityOpen',badgeLabel:'open tickets'},
 {module:'finance',href:'/finance',title:'Finance',desc:'Reconciliation, creditors and debtors, day book',icon:'finance',color:'#0B8A57',size:'md'},
 {module:'import',href:'/import',title:'Import',desc:'Contracts and settlement',icon:'import',color:'#0092D4',size:'md'},
 {module:'operations_intelligence',href:'/operations',title:'Operations Intelligence',desc:'Control room, ERP data, supply and sales',icon:'plant',color:'#BD7800',size:'md'},
 {module:'tickets',href:'/tickets',title:'Tickets',desc:'Issues raised from readings and exceptions',icon:'work',color:'#C34872',size:'md',badge:'ticketsOpen',badgeLabel:'open'},
 {module:'ceo',href:'/ceo',title:'Management',desc:'Plant and business at a glance',icon:'mgmt',color:'#3D4FC4',size:'sm'},
 {module:'input',href:'/input',title:'Solvent Input',desc:'Hourly readings, boiler, inspection',icon:'entry',color:'#0A6CE0',size:'sm'},
 {module:'quality_input',href:'/quality-input',title:'Quality Input',desc:'Lab entry and shift sampling',icon:'qentry',color:'#7A3FA1',size:'sm'},
 {module:'export',href:'/export',title:'Export (coming soon)',desc:'Contracts and shipments out',icon:'export',color:'#5B6B80',size:'sm',soon:true},
 {module:'admin',href:'/admin',title:'Admin',desc:'Users, shifts, parameters, access',icon:'admin',color:'#475569',size:'sm'},
 {module:'tally_connect',href:'/admin/tally',title:'Tally Connect',desc:'Direct sync from Tally',icon:'tally',color:'#475569',size:'sm'},
];
// What the bottom dock used to hold. Same destinations, same visibility rules (see components/AppShell.tsx `can`).
const everyday:Tile[]=[
 {module:'approvals',href:'/approvals',title:'Approvals',desc:'Waiting for your decision',icon:'approvals',color:'#C34872',size:'sm',badge:'pendingApprovalsCount'},
 {module:'reports',href:'/reports',title:'Reports',desc:'Shift and daily reports',icon:'reports',color:'#C34872',size:'sm'},
 {module:'announcements',href:'/announcements',title:'Announcements',desc:'Notices for everyone',icon:'announce',color:'#C34872',size:'sm',badge:'unreadAnnouncementCount'},
 {module:'chat',href:'/chat',title:'Chat',desc:'Messages and photos',icon:'chat',color:'#C34872',size:'sm',badge:'unreadChatCount'},
 {module:'hr_self',href:'/hr/my',title:'My HR',desc:'Pay, leave, shifts, profile',icon:'myhr',color:'#6D4CC7',size:'sm',badge:'pendingLeaveApprovalsCount'},
 {module:'hr',href:'/hr',title:'HR',desc:'Employees and policy',icon:'people',color:'#6D4CC7',size:'sm'},
 {module:'assets',href:'/assets',title:'Assets',desc:'Equipment and devices',icon:'assets',color:'#6D4CC7',size:'sm'},
 {module:'access_requests',href:'/admin/access-requests',title:'Access Requests',desc:'Approve module access',icon:'access',color:'#475569',size:'sm',badge:'pendingAccessRequestsCount'},
 {module:'ai_credits',href:'/ai-credits',title:'URUV Credits',desc:'AI usage and balance',icon:'credits',color:'#475569',size:'sm'},
];
export default function Home(){const [me,setMe]=useState<any>(),[ask,setAsk]=useState(''),[tk,setTk]=useState<{solventOpen?:number;qualityOpen?:number}>({}),[error,setError]=useState(''),[greeting,setGreeting]=useState(''),[insight,setInsight]=useState<any>(null);useEffect(()=>{fetch('/api/me',{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Unable to load access (${r.status})`);return j}).then(setMe).catch(e=>setError(e instanceof Error?e.message:'Unable to load access'))},[]);useEffect(()=>{const update=()=>setGreeting(greetingFor(new Date().getHours()));update();const id=setInterval(update,60000);return()=>clearInterval(id)},[]);useEffect(()=>{fetch('/api/insights/banner',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setInsight(j)}).catch(()=>{})},[]);const modules:string[]=me?.modules||[];const roles:string[]=me?.roles||[];
 useEffect(()=>{if(!me)return;let stop=false;const mods:string[]=me.modules||[];const load=async(scope:'solvent'|'quality',key:'solventOpen'|'qualityOpen')=>{try{const r=await fetch(`/api/tickets?scope=${scope}&summary=1`,{cache:'no-store'});if(!r.ok)return;const j=await r.json();if(!stop&&typeof j?.counts?.open==='number')setTk(x=>({...x,[key]:j.counts.open}))}catch{}};if(mods.includes('solvent_management'))void load('solvent','solventOpen');if(mods.includes('quality_management'))void load('quality','qualityOpen');return()=>{stop=true}},[me]);const can=(m:string)=>m==='tally_connect'?roles.includes('super_admin'):m==='finance'?modules.includes('finance_transaction')||modules.includes('finance_vendor_payment'):modules.includes(m);
 // The everyday tools follow the dock's old rules: approvals, reports, chat, announcements and My HR are for everyone; HR and Assets need the module; access requests and credits need a management role.
 const canEveryday=(m:string)=>m==='access_requests'||m==='ai_credits'?(roles.includes('management')||roles.includes('super_admin')):['approvals','reports','chat','hr_self','announcements'].includes(m)?true:modules.includes(m);
 const visible=tiles.filter(c=>can(c.module));
 const quick=everyday.filter(c=>canEveryday(c.module));
 const name=friendlyName(me?.profile?.full_name,me?.user?.email);
 if(!me&&!error)return <div className="dashboard-page"><section className="welcome-strip"><div><span className="eyebrow"><Sparkles size={14}/> YOUR DAILY WORKSPACE</span><h1>{greeting||'Welcome'}</h1><SkeletonLine width="w-60"/></div><div className="welcome-stat"><span>Your workspaces</span><SkeletonLine width="w-30"/></div></section><div style={{marginTop:16}}><SkeletonKpis count={3}/></div></div>;
 const val=(k?:string)=>{if(!k)return 0;if(k==='ticketsOpen')return (tk.solventOpen||0)+(tk.qualityOpen||0);if(k==='solventOpen'||k==='qualityOpen')return Number(tk[k]||0);return Number(me?.[k]||0)};
 const needs:{label:string;detail:string;href:string;tone:'bad'|'warn'|'info'}[]=[];
 if((tk.solventOpen||0)>0)needs.push({label:`${tk.solventOpen} open Solvent ticket${tk.solventOpen===1?'':'s'}`,detail:'Deviations and issues raised from readings',href:'/solvent/tickets',tone:'bad'});
 if((tk.qualityOpen||0)>0)needs.push({label:`${tk.qualityOpen} open Quality ticket${tk.qualityOpen===1?'':'s'}`,detail:'Lab deviations and overdue samples',href:'/quality/tickets',tone:'bad'});
 if(val('pendingApprovalsCount')>0)needs.push({label:`${val('pendingApprovalsCount')} approval${val('pendingApprovalsCount')===1?'':'s'} waiting for you`,detail:'Decisions you have been asked to make',href:'/approvals',tone:'warn'});
 if(val('pendingLeaveApprovalsCount')>0)needs.push({label:`${val('pendingLeaveApprovalsCount')} leave request${val('pendingLeaveApprovalsCount')===1?'':'s'} to decide`,detail:'From your reporting team',href:'/hr/my',tone:'warn'});
 if(val('pendingAccessRequestsCount')>0)needs.push({label:`${val('pendingAccessRequestsCount')} access request${val('pendingAccessRequestsCount')===1?'':'s'} to approve`,detail:'Module access changes waiting',href:'/admin/access-requests',tone:'warn'});
 if(val('unreadAnnouncementCount')>0)needs.push({label:`${val('unreadAnnouncementCount')} unread announcement${val('unreadAnnouncementCount')===1?'':'s'}`,detail:'Notices for everyone',href:'/announcements',tone:'info'});
 if(val('unreadChatCount')>0)needs.push({label:`${val('unreadChatCount')} unread chat conversation${val('unreadChatCount')===1?'':'s'}`,detail:'Messages and photos',href:'/chat',tone:'info'});
 const render=(c:Tile)=>{const n=val(c.badge);return <Link href={c.href} key={c.href} className={`tl tl-${c.size}${c.soon?' tl-soon':''}`} style={{['--c' as any]:c.color}}>
  <span className="tl-art" aria-hidden="true"><DuoIcon name={c.icon} size={c.size==='lg'?190:130}/></span>
  <span className="tl-top"><span className="tl-ic"><DuoIcon name={c.icon} size={c.size==='sm'?22:26}/></span><span className="tl-go"><ArrowUpRight size={18}/></span></span>
  <span className="tl-body"><b>{c.title}</b><span>{c.desc}</span></span>
  {n>0?<span className="tl-badge">{n>99?'99+':n} {c.badgeLabel||'waiting'}</span>:null}
 </Link>};
 return <div className="dashboard-page home-v3"><div className="v3-top"><section className="v3-hero v3-hero-card"><div><span className="eyebrow">YOUR DAILY WORKSPACE</span><h1>{greeting||'Welcome'}{me?`, ${name}`:''}</h1><p>{needs.length?`${needs.length} thing${needs.length===1?'':'s'} need${needs.length===1?'s':''} you today. Pick a module to go inside.`:'Nothing is waiting for you right now. Pick a module to go inside.'}</p></div>
  <form className="v3-ask" onSubmit={e=>{e.preventDefault();window.dispatchEvent(new CustomEvent('svma-assistant',{detail:{question:ask}}));setAsk('')}}><Sparkles size={18}/><input value={ask} onChange={e=>setAsk(e.target.value)} placeholder="Ask Uruvan: what needs my attention?" aria-label="Ask Uruvan"/><button type="submit" className="btn btn-primary">Ask</button></form></section>
  <section className="v3-needs"><div className="v3-needs-head"><b>Needs you</b>{needs.length?<span className="pill danger">{needs.length}</span>:<span className="pill ok">All clear</span>}</div>
   {needs.length?<div className="v3-needs-list">{needs.slice(0,5).map(n=><Link key={n.href+n.label} href={n.href} className="v3-need"><span className={`dot-${n.tone}`}/><span><b>{n.label}</b><small>{n.detail}</small></span><ArrowUpRight size={16}/></Link>)}</div>:<p className="v3-needs-empty">No tickets, approvals or messages are waiting.</p>}</section></div>
 <InstallAppCard/>
 {insight?.headline?<div className="ai-banner"><span className="ai-banner-icon"><Sparkles size={16}/></span><div><b>{insight.headline}</b>{insight.detail?<span>{insight.detail}</span>:null}</div></div>:null}
 {error?<div className="session-error-banner" style={{marginBottom:16}}><b>Workspace access is unavailable.</b><span>{error}</span><small>Your module cards will appear once the access profile loads successfully.</small></div>:null}
 {visible.length?<div className="tile-bento">{visible.map(render)}</div>:null}
 {quick.length?<><div className="home-label">Everyday</div><div className="tile-everyday">{quick.map(render)}</div></>:null}
 {me&&visible.length===0?<div className="card empty">No module access is assigned to this account. Contact the SVMA Super Admin.</div>:null}
 </div>}
>>>>>>> 24770ea1 (Modern look for every module: top bar with module tab strip, duotone icons, Home launcher with Ask Uruvan and Needs you, Solvent / Quality / Management / Finance / Tickets / Boiler redesigned to the design canvas (AI reading and 3-day production and sales outlook on Management))
