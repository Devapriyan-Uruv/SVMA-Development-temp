'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';

import { SkeletonKpis, SkeletonLine } from '@/components/Skeleton';
import { InstallAppCard } from '@/components/InstallAppCard';
import { greetingFor, friendlyName } from '@/lib/greeting';
import { DuoIcon } from '@/components/DuoIcons';

type Tile = {
  module: string;
  href: string;
  title: string;
  desc: string;
  icon: string;
  color: string;
  size: 'lg' | 'md' | 'sm';
  badge?: string;
  badgeLabel?: string;
  soon?: boolean;
};

const tiles: Tile[] = [
  {
    module: 'solvent_management',
    href: '/solvent',
    title: 'Solvent',
    desc: 'Production, safety, boiler and deviations',
    icon: 'solvent',
    color: '#0A6CE0',
    size: 'lg',
    badge: 'solventOpen',
    badgeLabel: 'open tickets',
  },
  {
    module: 'quality_management',
    href: '/quality',
    title: 'Quality',
    desc: 'Lab results, analytics and Uruv.ai insight',
    icon: 'quality',
    color: '#7A3FA1',
    size: 'md',
    badge: 'qualityOpen',
    badgeLabel: 'open tickets',
  },
  {
    module: 'finance',
    href: '/finance',
    title: 'Finance',
    desc: 'Reconciliation, creditors and debtors, day book',
    icon: 'finance',
    color: '#0B8A57',
    size: 'md',
  },
  {
    module: 'import',
    href: '/import',
    title: 'Import',
    desc: 'Contracts and settlement',
    icon: 'import',
    color: '#0092D4',
    size: 'md',
  },
  {
    module: 'operations_intelligence',
    href: '/operations',
    title: 'Operations Intelligence',
    desc: 'Control room, ERP data, supply and sales',
    icon: 'plant',
    color: '#BD7800',
    size: 'md',
  },
  {
    module: 'tickets',
    href: '/tickets',
    title: 'Tickets',
    desc: 'Issues raised from readings and exceptions',
    icon: 'work',
    color: '#C34872',
    size: 'md',
    badge: 'ticketsOpen',
    badgeLabel: 'open',
  },
  {
    module: 'ceo',
    href: '/ceo',
    title: 'Management',
    desc: 'Plant and business at a glance',
    icon: 'mgmt',
    color: '#3D4FC4',
    size: 'sm',
  },
  {
    module: 'input',
    href: '/input',
    title: 'Solvent Input',
    desc: 'Hourly readings, boiler, inspection',
    icon: 'entry',
    color: '#0A6CE0',
    size: 'sm',
  },
  {
    module: 'quality_input',
    href: '/quality-input',
    title: 'Quality Input',
    desc: 'Lab entry and shift sampling',
    icon: 'qentry',
    color: '#7A3FA1',
    size: 'sm',
  },
  {
    module: 'export',
    href: '/export',
    title: 'Export (coming soon)',
    desc: 'Contracts and shipments out',
    icon: 'export',
    color: '#5B6B80',
    size: 'sm',
    soon: true,
  },
  {
    module: 'admin',
    href: '/admin',
    title: 'Admin',
    desc: 'Users, shifts, parameters, access',
    icon: 'admin',
    color: '#475569',
    size: 'sm',
  },
  {
    module: 'tally_connect',
    href: '/admin/tally',
    title: 'Tally Connect',
    desc: 'Direct sync from Tally',
    icon: 'tally',
    color: '#475569',
    size: 'sm',
  },
];

// Everyday tools retain their previous destinations and visibility rules.
const everyday: Tile[] = [
  {
    module: 'approvals',
    href: '/approvals',
    title: 'Approvals',
    desc: 'Waiting for your decision',
    icon: 'approvals',
    color: '#C34872',
    size: 'sm',
    badge: 'pendingApprovalsCount',
  },
  {
    module: 'reports',
    href: '/reports',
    title: 'Reports',
    desc: 'Shift and daily reports',
    icon: 'reports',
    color: '#C34872',
    size: 'sm',
  },
  {
    module: 'announcements',
    href: '/announcements',
    title: 'Announcements',
    desc: 'Notices for everyone',
    icon: 'announce',
    color: '#C34872',
    size: 'sm',
    badge: 'unreadAnnouncementCount',
  },
  {
    module: 'chat',
    href: '/chat',
    title: 'Chat',
    desc: 'Messages and photos',
    icon: 'chat',
    color: '#C34872',
    size: 'sm',
    badge: 'unreadChatCount',
  },
  {
    module: 'hr_self',
    href: '/hr/my',
    title: 'My HR',
    desc: 'Pay, leave, shifts, profile',
    icon: 'myhr',
    color: '#6D4CC7',
    size: 'sm',
    badge: 'pendingLeaveApprovalsCount',
  },
  {
    module: 'hr',
    href: '/hr',
    title: 'HR',
    desc: 'Employees and policy',
    icon: 'people',
    color: '#6D4CC7',
    size: 'sm',
  },
  {
    module: 'assets',
    href: '/assets',
    title: 'Assets',
    desc: 'Equipment and devices',
    icon: 'assets',
    color: '#6D4CC7',
    size: 'sm',
  },
  {
    module: 'access_requests',
    href: '/admin/access-requests',
    title: 'Access Requests',
    desc: 'Approve module access',
    icon: 'access',
    color: '#475569',
    size: 'sm',
    badge: 'pendingAccessRequestsCount',
  },
  {
    module: 'ai_credits',
    href: '/ai-credits',
    title: 'URUV Credits',
    desc: 'AI usage and balance',
    icon: 'credits',
    color: '#475569',
    size: 'sm',
  },
];

let homePageCache: {
  me?: any;
  insight?: any;
  tk: {
    solventOpen?: number;
    qualityOpen?: number;
  };
} = {
  me: undefined,
  insight: null,
  tk: {},
};

export default function Home() {
  const [me, setMe] = useState<any>(() => homePageCache.me);
const [ask, setAsk] = useState('');
const [tk, setTk] = useState(homePageCache.tk);
const [error, setError] = useState('');
const [greeting, setGreeting] = useState('');
const [insight, setInsight] = useState<any>(
  () => homePageCache.insight
);
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(j.error || `Unable to load access (${r.status})`);
        }
        return j;
      })
      .then(setMe)
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Unable to load access'),
      );
  }, []);

  useEffect(() => {
    const update = () => setGreeting(greetingFor(new Date().getHours()));
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch('/api/insights/banner', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!j.error) setInsight(j);
      })
      .catch(() => {});
  }, []);

  const modules: string[] = me?.modules || [];
  const roles: string[] = me?.roles || [];

  useEffect(() => {
    if (!me) return;

    let stopped = false;
    const assignedModules: string[] = me.modules || [];

    const loadTicketCount = async (
      scope: 'solvent' | 'quality',
      key: 'solventOpen' | 'qualityOpen',
    ) => {
      try {
        const response = await fetch(
          `/api/tickets?scope=${scope}&summary=1`,
          { cache: 'no-store' },
        );
        if (!response.ok) return;

        const result = await response.json();
        if (!stopped && typeof result?.counts?.open === 'number') {
          setTk((current) => ({
            ...current,
            [key]: result.counts.open,
          }));
        }
      } catch {
        // Ticket counts are supplementary; the launcher remains usable.
      }
    };

    if (assignedModules.includes('solvent_management')) {
      void loadTicketCount('solvent', 'solventOpen');
    }
    if (assignedModules.includes('quality_management')) {
      void loadTicketCount('quality', 'qualityOpen');
    }

    return () => {
      stopped = true;
    };
  }, [me]);

  const can = (module: string) =>
    module === 'tally_connect'
      ? roles.includes('super_admin')
      : module === 'finance'
        ? modules.includes('finance_transaction') ||
          modules.includes('finance_vendor_payment')
        : modules.includes(module);

  // These everyday tools follow the prior dock's visibility rules.
  const canEveryday = (module: string) =>
    module === 'access_requests' || module === 'ai_credits'
      ? roles.includes('management') || roles.includes('super_admin')
      : ['approvals', 'reports', 'chat', 'hr_self', 'announcements'].includes(
            module,
          )
        ? true
        : modules.includes(module);

  const visible = tiles.filter((tile) => can(tile.module));
  const quick = everyday.filter((tile) => canEveryday(tile.module));
  const name = friendlyName(me?.profile?.full_name, me?.user?.email);

  if (!me && !error) {
    return (
      <div className="dashboard-page home-v3">
        <div className="v3-top">
          <section className="v3-hero v3-hero-card">
            <div>
              <span className="eyebrow">YOUR DAILY WORKSPACE</span>
              <h1>{greeting || 'Welcome'}</h1>
              <div className="home-skeleton-line" />
            </div>
            <div className="v3-ask home-skeleton-ask">
              <Sparkles size={18} />
              <span>Loading your workspace...</span>
            </div>
          </section>

          <section className="v3-needs">
            <div className="v3-needs-head">
              <b>Needs you</b>
              <span className="home-skeleton-pill" />
            </div>
            <div className="home-skeleton-line wide" />
            <div className="home-skeleton-line medium" />
            <div className="home-skeleton-line wide" />
          </section>
        </div>

        <div className="tile-bento home-skeleton-tiles">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div className="home-skeleton-tile" key={item} />
          ))}
        </div>
      </div>
    );
  }


  const valueFor = (key?: string) => {
    if (!key) return 0;
    if (key === 'ticketsOpen') {
      return (tk.solventOpen || 0) + (tk.qualityOpen || 0);
    }
    if (key === 'solventOpen' || key === 'qualityOpen') {
      return Number(tk[key] || 0);
    }
    return Number(me?.[key] || 0);
  };

  const needs: {
    label: string;
    detail: string;
    href: string;
    tone: 'bad' | 'warn' | 'info';
  }[] = [];

  if ((tk.solventOpen || 0) > 0) {
    needs.push({
      label: `${tk.solventOpen} open Solvent ticket${tk.solventOpen === 1 ? '' : 's'}`,
      detail: 'Deviations and issues raised from readings',
      href: '/solvent/tickets',
      tone: 'bad',
    });
  }

  if ((tk.qualityOpen || 0) > 0) {
    needs.push({
      label: `${tk.qualityOpen} open Quality ticket${tk.qualityOpen === 1 ? '' : 's'}`,
      detail: 'Lab deviations and overdue samples',
      href: '/quality/tickets',
      tone: 'bad',
    });
  }

  if (valueFor('pendingApprovalsCount') > 0) {
    const count = valueFor('pendingApprovalsCount');
    needs.push({
      label: `${count} approval${count === 1 ? '' : 's'} waiting for you`,
      detail: 'Decisions you have been asked to make',
      href: '/approvals',
      tone: 'warn',
    });
  }

  if (valueFor('pendingLeaveApprovalsCount') > 0) {
    const count = valueFor('pendingLeaveApprovalsCount');
    needs.push({
      label: `${count} leave request${count === 1 ? '' : 's'} to decide`,
      detail: 'From your reporting team',
      href: '/hr/my',
      tone: 'warn',
    });
  }

  if (valueFor('pendingAccessRequestsCount') > 0) {
    const count = valueFor('pendingAccessRequestsCount');
    needs.push({
      label: `${count} access request${count === 1 ? '' : 's'} to approve`,
      detail: 'Module access changes waiting',
      href: '/admin/access-requests',
      tone: 'warn',
    });
  }

  if (valueFor('unreadAnnouncementCount') > 0) {
    const count = valueFor('unreadAnnouncementCount');
    needs.push({
      label: `${count} unread announcement${count === 1 ? '' : 's'}`,
      detail: 'Notices for everyone',
      href: '/announcements',
      tone: 'info',
    });
  }

  if (valueFor('unreadChatCount') > 0) {
    const count = valueFor('unreadChatCount');
    needs.push({
      label: `${count} unread chat conversation${count === 1 ? '' : 's'}`,
      detail: 'Messages and photos',
      href: '/chat',
      tone: 'info',
    });
  }

  const renderTile = (tile: Tile) => {
    const count = valueFor(tile.badge);

    return (
      <Link
        href={tile.href}
        key={tile.href}
        className={`tl tl-${tile.size}${tile.soon ? ' tl-soon' : ''}`}
        style={{ ['--c' as any]: tile.color }}
      >
        <span className="tl-art" aria-hidden="true">
          <DuoIcon name={tile.icon} size={tile.size === 'lg' ? 190 : 130} />
        </span>
        <span className="tl-top">
          <span className="tl-ic">
            <DuoIcon name={tile.icon} size={tile.size === 'sm' ? 22 : 26} />
          </span>
          <span className="tl-go">
            <ArrowUpRight size={18} />
          </span>
        </span>
        <span className="tl-body">
          <b>{tile.title}</b>
          <span>{tile.desc}</span>
        </span>
        {count > 0 ? (
          <span className="tl-badge">
            {count > 99 ? '99+' : count} {tile.badgeLabel || 'waiting'}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <div className="dashboard-page home-v3">
      <div className="v3-top">
        <section className="v3-hero v3-hero-card">
          <div>
            <span className="eyebrow">YOUR DAILY WORKSPACE</span>
            <h1>
              {greeting || 'Welcome'}
              {me ? `, ${name}` : ''}
            </h1>
            <p>
              {needs.length
                ? `${needs.length} thing${needs.length === 1 ? '' : 's'} need${
                    needs.length === 1 ? 's' : ''
                  } you today. Pick a module to go inside.`
                : 'Nothing is waiting for you right now. Pick a module to go inside.'}
            </p>
          </div>

          <form
            className="v3-ask"
            onSubmit={(event) => {
              event.preventDefault();
              const question = ask.trim();
              if (!question) return;
              window.dispatchEvent(
                new CustomEvent('svma-assistant', {
                  detail: { question },
                }),
              );
              setAsk('');
            }}
          >
            <Sparkles size={18} />
            <input
              value={ask}
              onChange={(event) => setAsk(event.target.value)}
              placeholder="Ask Uruvan: what needs my attention?"
              aria-label="Ask Uruvan"
            />
            <button type="submit" className="btn btn-primary">
              Ask
            </button>
          </form>
        </section>

        <section className="v3-needs">
          <div className="v3-needs-head">
            <b>Needs you</b>
            {needs.length ? (
              <span className="pill danger">{needs.length}</span>
            ) : (
              <span className="pill ok">All clear</span>
            )}
          </div>
          {needs.length ? (
            <div className="v3-needs-list">
              {needs.slice(0, 5).map((item) => (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className="v3-need"
                >
                  <span className={`dot-${item.tone}`} />
                  <span>
                    <b>{item.label}</b>
                    <small>{item.detail}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="v3-needs-empty">
              No tickets, approvals or messages are waiting.
            </p>
          )}
        </section>
      </div>

      <InstallAppCard />

      {insight?.headline ? (
        <div className="ai-banner">
          <span className="ai-banner-icon">
            <Sparkles size={16} />
          </span>
          <div>
            <b>{insight.headline}</b>
            {insight.detail ? <span>{insight.detail}</span> : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="session-error-banner" style={{ marginBottom: 16 }}>
          <b>Workspace access is unavailable.</b>
          <span>{error}</span>
          <small>
            Your module cards will appear once the access profile loads
            successfully.
          </small>
        </div>
      ) : null}

      {visible.length ? (
        <div className="tile-bento">{visible.map(renderTile)}</div>
      ) : null}

      {quick.length ? (
        <>
          <div className="home-label">Everyday</div>
          <div className="tile-everyday">{quick.map(renderTile)}</div>
        </>
      ) : null}

      {me && visible.length === 0 ? (
        <div className="card empty">
          No module access is assigned to this account. Contact the SVMA Super
          Admin.
        </div>
      ) : null}
    </div>
  );
}
