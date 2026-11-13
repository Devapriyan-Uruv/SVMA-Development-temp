
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode
} from 'react';

import {
  Boxes,
  Coins,
  ClipboardCheck,
  IdCard,
  LogOut,
  Megaphone,
  MessageCircle,
  Package,
  Ship,
  SendHorizontal,
  ShieldCheck,
  UserCog,
  User,
  ArrowUpRight
} from 'lucide-react';

import { ModuleStrip, moduleFor } from '@/components/ModuleStrip';
import { DuoIcon } from '@/components/DuoIcons';
import { NotificationBell } from '@/components/NotificationBell';
import { ProfilePopover } from '@/components/ProfilePopover';
import { AnnouncementPopup } from '@/components/AnnouncementPopup';
import { AssistantBubble } from '@/components/AssistantBubble';
import { greetingFor, friendlyName } from '@/lib/greeting';

import {
  AdminIcon,
  CeoIcon,
  FinanceIcon,
  OverviewIcon,
  QualityIcon,
  QualityInputIcon,
  ReportsIcon,
  SolventIcon,
  SolventInputIcon
} from '@/components/SvmaIcons';

type Icon = ComponentType<{ size?: number; className?: string }>;

type NavItem = {
  module: string;
  href: string;
  label: string;
  icon: Icon;
};

// Navigation items used to identify the current page.
const nav: NavItem[] = [
  { module: 'home', href: '/', label: 'Overview', icon: OverviewIcon },
  { module: 'ceo', href: '/ceo', label: 'Management', icon: CeoIcon },
  { module: 'solvent_management', href: '/solvent', label: 'Solvent', icon: SolventIcon },
  { module: 'quality_management', href: '/quality', label: 'Quality', icon: QualityIcon },
  { module: 'finance', href: '/finance', label: 'Finance', icon: FinanceIcon },
  { module: 'import', href: '/import', label: 'Import', icon: Ship },
  { module: 'export', href: '/export', label: 'Export', icon: SendHorizontal },
  { module: 'operations_intelligence', href: '/operations', label: 'Operations Intelligence', icon: Boxes },
  { module: 'input', href: '/input', label: 'Solvent Input', icon: SolventInputIcon },
  { module: 'quality_input', href: '/quality-input', label: 'Quality Input', icon: QualityInputIcon },
  { module: 'approvals', href: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { module: 'chat', href: '/chat', label: 'Chat', icon: MessageCircle },
  { module: 'reports', href: '/reports', label: 'Reports', icon: ReportsIcon },
  { module: 'announcements', href: '/announcements', label: 'Announcements', icon: Megaphone },
  { module: 'hr_self', href: '/hr/my', label: 'My HR', icon: IdCard },
  { module: 'hr', href: '/hr', label: 'HR', icon: UserCog },
  { module: 'assets', href: '/assets', label: 'Assets', icon: Package },
  { module: 'access_requests', href: '/admin/access-requests', label: 'Access Requests', icon: ShieldCheck },
  { module: 'ai_credits', href: '/ai-credits', label: 'URUV Credits', icon: Coins },
  { module: 'admin', href: '/admin', label: 'Administration', icon: AdminIcon }
];

// Match routes on path boundaries.
// This prevents /quality-input from also activating /quality.
function isActiveHref(href: string, pathname: string) {
  return href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(href + '/');
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const isLogin = pathname === '/login';
  const isHome = pathname === '/';

  const [me, setMe] = useState<any>(null);
  const [sessionError, setSessionError] = useState('');
  const [greeting, setGreeting] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);

  // Update the greeting periodically.
  useEffect(() => {
    const update = () => setGreeting(greetingFor(new Date().getHours()));

    update();

    const id = setInterval(update, 60000);

    return () => clearInterval(id);
  }, []);

  // Load the current user's session and module access.
  useEffect(() => {
    if (isLogin) return;

    setSessionError('');

    fetch('/api/me', { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}));

        if (!r.ok) {
          throw new Error(j.error || `Session request failed (${r.status})`);
        }

        return j;
      })
      .then(setMe)
      .catch(e => {
        setMe(null);
        setSessionError(
          e instanceof Error ? e.message : 'Unable to load access'
        );
      });
  }, [isLogin, pathname]);

  // Refresh unread chat and pending-access information.
  useEffect(() => {
    if (isLogin) return;

    const t = setInterval(() => {
      fetch('/api/me', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (j) setMe(j);
        })
        .catch(() => {});
    }, 20000);

    return () => clearInterval(t);
  }, [isLogin]);

  // Track operator focus while an active shift is locked.
  useEffect(() => {
    if (!me?.activeShift?.id || !me?.lockApplies) return;

    let awayAt: number | null = null;

    const send = (eventType: string, durationSeconds?: number) => {
      void fetch('/api/shift/focus', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shiftSessionId: me.activeShift.id,
          eventType,
          durationSeconds,
          occurredAt: new Date().toISOString()
        })
      });
    };

    const vis = () => {
      if (document.hidden) {
        awayAt = Date.now();
        send('focus_lost');
      } else if (awayAt) {
        send(
          'focus_returned',
          Math.round((Date.now() - awayAt) / 1000)
        );

        awayAt = null;
      }
    };

    document.addEventListener('visibilitychange', vis);

    return () => document.removeEventListener('visibilitychange', vis);
  }, [me?.activeShift?.id, me?.lockApplies]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login');
  }

  const modules: string[] = me?.modules || [];

  // Restrict navigation while an operator has an active locked shift.
  const lockedToModule =
    me?.lockApplies && me?.activeShift
      ? (me.activeShift.scope === 'quality' ? 'quality_input' : 'input')
      : null;

  const roles: string[] = me?.roles || [];

  // Central module-access check.
  const can = (m: string) => {
    if (lockedToModule) {
      return m === lockedToModule || m === 'chat';
    }

    if (m === 'access_requests' || m === 'ai_credits') {
      return roles.includes('management') || roles.includes('super_admin');
    }

    return (
      m === 'home' ||
      m === 'reports' ||
      m === 'approvals' ||
      m === 'chat' ||
      m === 'hr_self' ||
      m === 'announcements' ||
      (
        m === 'finance'
          ? (
              modules.includes('finance_transaction') ||
              modules.includes('finance_vendor_payment')
            )
          : modules.includes(m)
      )
    );
  };

  // Module strip uses the same access checks.
  // Tally Connect is restricted to Super Admin.
  const canTab = (m: string) =>
    m === 'tally_connect'
      ? roles.includes('super_admin')
      : can(m);

  const visible = useMemo(
    () => nav.filter(x => can(x.module)),
    [modules.join('|'), lockedToModule]
  );

  // Find the most specific matching navigation item.
  const current = useMemo(
    () =>
      visible
        .filter(n => isActiveHref(n.href, pathname))
        .reduce<typeof visible[number] | null>(
          (best, n) =>
            !best || n.href.length > best.href.length ? n : best,
          null
        ),
    [visible, pathname]
  );

  if (isLogin) {
    return <main className="auth-shell">{children}</main>;
  }

  const displayName = friendlyName(
    me?.profile?.full_name,
    me?.user?.email
  );

  return (
    <div className="saas-shell no-rail-shell">
      <section className="saas-stage premium-stage full-bleed-stage">

        {/* TOP NAVIGATION */}
        <header className="saas-topbar premium-topbar">

          <div className="topbar-left">
            <Link className="topbar-brand" href="/">
              <div className="topbar-brand-mark">
                <img src="/svma-logo2.png" alt="SVMA" />
                <span className="topbar-tagline">
                  Operational Intelligence
                </span>
              </div>
            </Link>

            {!lockedToModule ? (
              <Link
                className={`all-modules-btn${isHome ? ' on' : ''}`}
                href="/"
              >
                <DuoIcon name="grid" size={18} />
                All modules
              </Link>
            ) : null}

            {!isHome && (
              <div className="topbar-context">
                <div className="topbar-path">
                  <b>
                    {greeting
                      ? `${greeting}, ${displayName}`
                      : current?.label || 'Intelligent Operations'}
                  </b>

                  <span>
                    {current?.label || 'Operational intelligence platform'}

                    {me?.activeShift?.shift_master?.name
                      ? ` • ${me.activeShift.shift_master.name}`
                      : ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="topbar-actions">

            {/* Active shift navigation */}
            {me?.activeShift ? (
              <Link
                href={
                  me.activeShift.scope === 'quality'
                    ? '/quality-input'
                    : '/input'
                }
                className="live-chip"
                title="Open your active shift entry page"
              >
                <span className="live-chip-dot" />

                <span>
                  Your {me.activeShift.scope === 'quality'
                    ? 'Quality'
                    : 'Solvent'} Shift Live
                </span>

                <ArrowUpRight size={15} />
              </Link>
            ) : null}

            <NotificationBell />

            {/* Chat shortcut and unread badge */}
            {can('chat') ? (
              <Link
                className="v3-icon-link v3-chat"
                href="/chat"
                title="Chat"
                aria-label={
                  me?.unreadChatCount
                    ? `Chat, ${me.unreadChatCount} unread`
                    : 'Chat'
                }
              >
                <DuoIcon name="chat" size={20} />

                {me?.unreadChatCount ? (
                  <span className="topbar-badge">
                    {me.unreadChatCount > 9
                      ? '9+'
                      : me.unreadChatCount}
                  </span>
                ) : null}
              </Link>
            ) : null}

            {/* Profile popup */}
            <button
              type="button"
              className="icon-btn"
              title="My Profile"
              aria-label="Open my profile"
              onClick={() => setProfileOpen(true)}
            >
              <User size={17} />
            </button>

            {/* Sign out */}
            <button
              type="button"
              className="v3-icon-link v3-signout"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </button>

          </div>
        </header>

        {/* TL'S NEW MODULE TAB STRIP */}
        <ModuleStrip
          pathname={pathname}
          can={canTab}
          me={me}
        />

        {/* PAGE CONTENT */}
        <main
          className="main-content premium-content"
          style={{
            ['--c' as any]: moduleFor(pathname)?.color || '#1D5BFF'
          }}
        >
          {sessionError ? (
            <div className="session-error-banner">
              <b>Access profile could not be loaded.</b>

              <span>
                Please refresh or contact your administrator.
              </span>

              <small>
                Check your account's module access with the SVMA
                Administrator, then refresh.
              </small>
            </div>
          ) : null}

          {children}
        </main>

        {/* FOOTER */}
        <footer className="app-footer">
          <span>SVMA Intelligent Operations</span>

          <span className="powered-by">
            Powered by
            <img
              src="/uruv_logo.png"
              alt="Uruv"
              className="aix3-mark"
            />
          </span>
        </footer>

      </section>

      {/* GLOBAL COMPONENTS */}
      <AssistantBubble />

      <AnnouncementPopup />

      <ProfilePopover
        userId={profileOpen ? me?.user?.id || null : null}
        onClose={() => setProfileOpen(false)}
      />

      {/* ACTIVE SHIFT FOCUS NOTICE */}
      {me?.lockApplies && me?.activeShift ? (
        <div className="focus-banner">
          Active shift • keep operational input in focus
        </div>
      ) : null}

    </div>
  );
}
