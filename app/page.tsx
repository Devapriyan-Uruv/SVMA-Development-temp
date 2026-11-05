'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import { TicketCheck, BadgeIndianRupee, ChartNoAxesCombined, Droplets, Microscope, FileInput, ClipboardCheck, Wallet, Gauge, SlidersHorizontal, Sparkles, Landmark,FileUp,SendHorizontal,TrendingUp,Settings,ShieldCheck} from 'lucide-react';
import {SkeletonKpis, SkeletonLine} from '@/components/Skeleton';
import {InstallAppCard} from '@/components/InstallAppCard';
import {greetingFor, friendlyName} from '@/lib/greeting';

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

