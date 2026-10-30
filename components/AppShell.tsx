'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useMemo,useState,type ComponentType,type ReactNode} from 'react';
import {Activity,Boxes,Coins,ClipboardCheck,IdCard,LogOut,Megaphone,MessageCircle,Package,Ship,SendHorizontal,ShieldCheck,UserCog,ChevronDown, ChevronUp} from 'lucide-react';
import {NotificationBell} from '@/components/NotificationBell';
import {AnnouncementPopup} from '@/components/AnnouncementPopup';
import {AssistantBubble} from '@/components/AssistantBubble';
import {greetingFor,friendlyName} from '@/lib/greeting';
import {AdminIcon,CeoIcon,FinanceIcon,OverviewIcon,QualityIcon,QualityInputIcon,ReportsIcon,SolventIcon,SolventInputIcon} from '@/components/SvmaIcons';

type Icon=ComponentType<{size?:number;className?:string}>;
type NavItem={module:string;href:string;label:string;icon:Icon};
// Flat list, not grouped — the floating bottom dock is a single scrollable
// row, not a sectioned sidebar. Every module that already has its own tile on the Home page
// (app/page.tsx's `cards`) is excluded from the dock — the dock would
// otherwise duplicate Home entirely — while modules with no Home tile
// (My HR, HR, Assets, Access Requests) stay, plus a fixed constant set
// (Overview, Approvals, Chat, Reports, Announcements, My HR) the user
// asked to always keep visible. Entries for the Home-only modules are
// still kept in `nav` itself (not deleted) so the top header's page label
// ("Good afternoon, X — Import") still resolves correctly while actually
// on one of those pages — DOCK_HIDDEN_MODULES is what excludes them from
// the dock specifically, without affecting that label lookup.
const DOCK_HIDDEN_MODULES=new Set(['ceo','solvent_management','quality_management','finance','import','export','input','quality_input','admin','operations_intelligence']);
const nav:NavItem[]=[
 {module:'home',href:'/',label:'Overview',icon:OverviewIcon},
 {module:'ceo',href:'/ceo',label:'Management',icon:CeoIcon},
 {module:'solvent_management',href:'/solvent',label:'Solvent',icon:SolventIcon},
 {module:'quality_management',href:'/quality',label:'Quality',icon:QualityIcon},
 {module:'finance',href:'/finance',label:'Finance',icon:FinanceIcon},
 {module:'import',href:'/import',label:'Import',icon:Ship},
 {module:'export',href:'/export',label:'Export',icon:SendHorizontal},
 {module:'operations_intelligence',href:'/operations',label:'Operations Intelligence',icon:Boxes},
 {module:'input',href:'/input',label:'Solvent Input',icon:SolventInputIcon},
 {module:'quality_input',href:'/quality-input',label:'Quality Input',icon:QualityInputIcon},
 {module:'approvals',href:'/approvals',label:'Approvals',icon:ClipboardCheck},
 {module:'chat',href:'/chat',label:'Chat',icon:MessageCircle},
 {module:'reports',href:'/reports',label:'Reports',icon:ReportsIcon},
 {module:'announcements',href:'/announcements',label:'Announcements',icon:Megaphone},
 {module:'hr_self',href:'/hr/my',label:'My HR',icon:IdCard},
 {module:'hr',href:'/hr',label:'HR',icon:UserCog},
 {module:'assets',href:'/assets',label:'Assets',icon:Package},
 {module:'access_requests',href:'/admin/access-requests',label:'Access Requests',icon:ShieldCheck},
 {module:'ai_credits',href:'/ai-credits',label:'URUV Credits',icon:Coins},
 {module:'admin',href:'/admin',label:'Administration',icon:AdminIcon},
];
// Section: nav highlighting must match on a path BOUNDARY, not a raw string
// prefix — otherwise `/quality-input` (Quality Input) starts with `/quality`
// (Quality management) and both light up together.
function isActiveHref(href:string,pathname:string){return href==='/'?pathname==='/':pathname===href||pathname.startsWith(href+'/')}

export function AppShell({children}:{children:ReactNode}){
const pathname = usePathname();
const isLogin = pathname === '/login';
const isHome = pathname === '/';
 const [me,setMe]=useState<any>(null),[sessionError,setSessionError]=useState('');
 const [greeting,setGreeting]=useState('');
 useEffect(()=>{const update=()=>setGreeting(greetingFor(new Date().getHours()));update();const id=setInterval(update,60000);return()=>clearInterval(id)},[]);
 useEffect(()=>{if(isLogin)return;setSessionError('');fetch('/api/me',{cache:'no-store'}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Session request failed (${r.status})`);return j}).then(setMe).catch(e=>{setMe(null);setSessionError(e instanceof Error?e.message:'Unable to load access')})},[isLogin,pathname]);
 // Section: nav dock badges (unread chat conversations / pending approvals)
 // — refreshed on a light interval so they update without a navigation.
 useEffect(()=>{if(isLogin)return;const t=setInterval(()=>{fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j)setMe(j)}).catch(()=>{})},20000);return()=>clearInterval(t)},[isLogin]);
 useEffect(()=>{if(!me?.activeShift?.id||!me?.lockApplies)return;let awayAt:number|null=null;const send=(eventType:string,durationSeconds?:number)=>void fetch('/api/shift/focus',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shiftSessionId:me.activeShift.id,eventType,durationSeconds,occurredAt:new Date().toISOString()})});const vis=()=>{if(document.hidden){awayAt=Date.now();send('focus_lost')}else if(awayAt){send('focus_returned',Math.round((Date.now()-awayAt)/1000));awayAt=null}};document.addEventListener('visibilitychange',vis);return()=>document.removeEventListener('visibilitychange',vis)},[me?.activeShift?.id,me?.lockApplies]);
 async function signOut(){await fetch('/api/auth/logout',{method:'POST'});window.location.replace('/login')}
 const modules:string[]=me?.modules||[];
 // While an operator's shift is active, proxy.ts force-redirects every
 // navigation except their own entry area straight back to it (Section:
 // keep operational input in focus). Nothing else is reachable, so any
 // other nav link would look clickable but silently bounce the operator
 // right back with no explanation. Mirror that same restriction here so the
 // dock only ever offers links that actually work.
 const lockedToModule=me?.lockApplies&&me?.activeShift?(me.activeShift.scope==='quality'?'quality_input':'input'):null;
 // Note: '/' (Overview) is not exempt from the same redirect, so it is
 // deliberately not special-cased here while locked either.
 // Chat stays reachable even while locked to the entry page (mirrors the
 // same exemption in proxy.ts) — an operator mid-shift still needs a way
 // to flag an issue or send a photo to someone.
 const roles:string[]=me?.roles||[];
 // Access Requests isn't a module a super_admin/admin can grant to someone
 // else — it's who's allowed to approve module-access changes at all, so
 // it's gated by role (ACCESS_APPROVAL_ROLES) exactly like the API route.
 const can=(m:string)=>{if(lockedToModule)return m===lockedToModule||m==='chat';if(m==='access_requests'||m==='ai_credits')return roles.includes('management')||roles.includes('super_admin');return m==='home'||m==='reports'||m==='approvals'||m==='chat'||m==='hr_self'||m==='announcements'||(m==='finance'?(modules.includes('finance_transaction')||modules.includes('finance_vendor_payment')):modules.includes(m))};
 const visible=useMemo(()=>nav.filter(x=>can(x.module)),[modules.join('|'),lockedToModule]);
 // Section: /hr and /hr/my are nested (unlike e.g. /quality-input vs
 // /quality, which are boundary-distinct siblings), so both can legitimately
 // match isActiveHref at once on /hr/my. Only the longest — most specific —
 // matching href should ever be treated as "the" current one.
 const current=useMemo(()=>visible.filter(n=>isActiveHref(n.href,pathname)).reduce<typeof visible[number]|null>((best,n)=>!best||n.href.length>best.href.length?n:best,null),[visible,pathname]);
 // Import/Export stay out of the always-visible dock (it was already
 // long) — reached from the Home module-card grid instead (app/page.tsx).
 // They're kept in `visible`/`current` above so the top header's page
 // label still resolves correctly while actually on those pages.
 const dockVisible=useMemo(()=>visible.filter(n=>!DOCK_HIDDEN_MODULES.has(n.module)),[visible]);
 if(isLogin)return <main className="auth-shell">{children}</main>;
 const displayName=friendlyName(me?.profile?.full_name,me?.user?.email);
 const [dockCollapsed, setDockCollapsed] = useState(false);
 return <div className="saas-shell no-rail-shell">
  <section className="saas-stage premium-stage full-bleed-stage">
   <header className="saas-topbar premium-topbar">
    <div className="topbar-left">
    <Link className="topbar-brand" href="/"><div className="topbar-brand-mark"><img src="/svma-logo2.png" alt="SVMA" /><span className="topbar-tagline">Operational Intelligence</span></div></Link>
     {!isHome && (<div className="topbar-context"><div className="topbar-path"><b>{greeting?`${greeting}, ${displayName}`:current?.label||'Intelligent Operations'}</b><span>{current?.label||'Operational intelligence platform'}{me?.activeShift?.shift_master?.name?` • ${me.activeShift.shift_master.name}`:''}</span></div></div>)}
    </div>
    <div className="topbar-actions">{me?.activeShift?<span className="live-chip" title="This is your own active data-entry shift, not the plant's overall status"><Activity size={14}/><i/> Your {me.activeShift.scope==='quality'?'Quality':'Solvent'} shift is live</span>:null}<NotificationBell/><Link className="user-chip" href="/profile" title="My profile">{me?.profile?.avatar_url?<img src={me.profile.avatar_url} alt="" className="avatar-dot" style={{objectFit:'cover'}}/>:<span className="avatar-dot">{displayName.slice(0,1).toUpperCase()}</span>}<span><b>{me?.profile?.full_name||displayName}</b><small>{me?.roles?.[0]?.replaceAll('_',' ')||'User'}</small></span></Link></div>
   </header>
   <main className="main-content premium-content dock-clearance">{sessionError?<div className="session-error-banner"><b>Access profile could not be loaded.</b><span>Please refresh or contact your administrator.</span><small>Check your account's module access with the SVMA Administrator, then refresh.</small></div>:null}{children}</main>
   <footer className="app-footer"><span>SVMA Intelligent Operations</span><span className="powered-by">Powered by<img src="/uruv_logo.png" alt="Uruv" className="aix3-mark"/></span></footer>
  </section>

<nav
  className={`bottom-dock ${dockCollapsed ? 'is-collapsed' : 'is-expanded'}`}
  aria-label="Primary navigation"
>
  {dockCollapsed ? (
    <button
      type="button"
      className="dock-expand-button"
      onClick={() => setDockCollapsed(false)}
      aria-label="Expand navigation dock"
      title="Expand navigation"
    >
      <ChevronUp size={23} strokeWidth={2.3} />
    </button>
  ) : (
    <>
      {dockVisible.map(n => {
        const I = n.icon;
        const active = current?.href === n.href;
        const badge =
          n.module === 'chat' ? me?.unreadChatCount :
          n.module === 'approvals' ? me?.pendingApprovalsCount :
          n.module === 'hr_self' ? me?.pendingLeaveApprovalsCount :
          n.module === 'access_requests' ? me?.pendingAccessRequestsCount :
          n.module === 'announcements' ? me?.unreadAnnouncementCount : 0;

        return (
          <Link
            href={n.href}
            key={n.href}
            className={active ? 'active' : ''}
          >
            <span className="dock-icon-wrap">
              <I size={19} />
              {badge ? (
                <span className="dock-badge">
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </span>
            <span>{n.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        className="bottom-dock-signout"
        onClick={signOut}
      >
        <LogOut size={19} />
        <span>Sign out</span>
      </button>

      <button
        type="button"
        className="dock-collapse-button"
        onClick={() => setDockCollapsed(true)}
        aria-label="Collapse navigation dock"
        title="Collapse navigation"
      >
        <ChevronDown size={20} strokeWidth={2.2} />
      </button>
    </>
  )}
</nav>

  <AssistantBubble/>
  <AnnouncementPopup/>
  {me?.lockApplies&&me?.activeShift?<div className="focus-banner">Active shift • keep operational input in focus</div>:null}
 </div>
}