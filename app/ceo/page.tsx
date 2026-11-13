'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeIndianRupee,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Factory,
  FlaskConical,
  Lightbulb,
  Radio,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  TicketCheck,
  TrendingUp,
  Truck,
  TriangleAlert,
} from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { Kpi } from '@/components/Kpi';
import { SkeletonDashboard } from '@/components/Skeleton';
import { PeriodFilter, type Period } from '@/components/PeriodFilter';
import { ShiftControlList } from '@/components/ShiftControlList';
import { CockpitGlance } from '@/components/CockpitGlance';
import {
  HealthTrend,
  ResolutionRings,
  ConditionMix,
  ProductColumns,
} from '@/components/CockpitCharts';

export default function CEO() {
  const [period, setPeriod] = useState<Period>({
    date: '',
    shiftId: '',
    product: '',
  });
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showShift, setShowShift] = useState(false);
  const [showAiInsights, setShowAiInsights] = useState(false);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (period.date) qs.set('date', period.date);
    if (period.shiftId) qs.set('shiftId', period.shiftId);

    fetch(`/api/ceo/dashboard?${qs.toString()}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(j.error || `Dashboard failed (${r.status})`);
        }
        return j;
      })
      .then((result) => {
        setD(result);
        setError('');
      })
      .catch((e) => {
        setD({
          ss: {},
          qs: {},
          prod: {},
          safe: {},
          good: [],
          attention: [],
          better: [],
          trends: [],
          finance: {},
        });
        setError(e instanceof Error ? e.message : 'Dashboard failed');
      });
  }, [period.date, period.shiftId, refreshKey]);

  if (!d) {
    return (
      <>
        <PageHeader
          eyebrow="Management cockpit"
          title="Plant and business at a glance"
          subtitle=""
        />
        <SkeletonDashboard />
      </>
    );
  }

  const {
    ss,
    qs,
    prod,
    safe,
    good,
    attention,
    better,
    trends,
    openDev,
    openTickets,
    devResolutionPct,
    ticketResolutionPct,
    products,
    trendDaily,
    finance,
    solvent,
    quality,
    liveSolventShifts,
    liveQualityShifts,
  } = d;

  const trendPoints = (scope: 'solventHealth' | 'qualityHealth') =>
    (trendDaily || [])
      .filter((t: any) => t[scope] != null)
      .map((t: any) => ({ time: t.date, value: t[scope] }));

  function weekOverWeek(
    scope: 'solventHealth' | 'qualityHealth',
    label: string,
  ) {
    const points = trendPoints(scope);
    if (points.length < 2) return null;

    const first = points[0];
    const last = points[points.length - 1];
    const delta = Math.round(Number(last.value) - Number(first.value));
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

    return `${label} health is ${direction}${
      delta !== 0
        ? ` ${Math.abs(delta)} point${Math.abs(delta) === 1 ? '' : 's'}`
        : ''
    } over the last ${points.length} days (${first.value}% → ${last.value}%).`;
  }

  const weeklySignals = [
    weekOverWeek('solventHealth', 'Solvent'),
    weekOverWeek('qualityHealth', 'Quality'),
  ].filter(Boolean) as string[];

  const liveShiftCount =
    (liveSolventShifts?.length || 0) + (liveQualityShifts?.length || 0);

  return (
    <>
      <PageHeader
        eyebrow="Management cockpit"
        title="Plant and business at a glance"
        subtitle=""
        action={<span className="pill info">EXECUTIVE VIEW</span>}
      />

      <CockpitGlance
        solventHealth={ss?.health}
        qualityHealth={qs?.health}
        openTickets={openTickets}
        openDev={openDev}
        solventNote={`${ss?.warning || 0} warning • ${ss?.critical || 0} critical`}
        qualityNote={`${qs?.warning || 0} warning • ${qs?.critical || 0} critical`}
        good={good || []}
        attention={attention || []}
        better={better || []}
        trends={[...weeklySignals, ...(trends || [])]}
      />

      <PeriodFilter
        period={period}
        onChange={setPeriod}
        liveSessions={[
          ...(liveSolventShifts || []).map((shift: any) => ({
            scope: 'solvent' as const,
            shift,
          })),
          ...(liveQualityShifts || []).map((shift: any) => ({
            scope: 'quality' as const,
            shift,
          })),
        ]}
        onStopped={() => setRefreshKey((value) => value + 1)}
      />

      {error ? (
        <div className="session-error-banner" style={{ marginBottom: 14 }}>
          <b>Management dashboard data could not be loaded.</b>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid kpis modern-kpis" style={{ marginTop: 16 }}>
        <Kpi
          icon={Factory}
          tone="blue"
          label="Solvent Plant Health"
          value={ss?.health == null ? 'N/A' : `${ss.health}%`}
          foot={`${ss?.warning || 0} warning • ${ss?.critical || 0} critical`}
        />
        <Kpi
          icon={TrendingUp}
          tone="green"
          label="Production Health"
          value={prod?.health == null ? 'N/A' : `${prod.health}%`}
          foot={`${(prod?.normal || 0) + (prod?.warning || 0) + (prod?.critical || 0)} process readings`}
        />
        <Kpi
          icon={ShieldAlert}
          tone="amber"
          label="Safety Health"
          value={safe?.health == null ? 'N/A' : `${safe.health}%`}
          foot={`${(safe?.warning || 0) + (safe?.critical || 0)} attention readings`}
        />
        <Kpi
          icon={FlaskConical}
          tone="purple"
          label="Quality Health"
          value={qs?.health == null ? 'N/A' : `${qs.health}%`}
          foot={`${qs?.warning || 0} warning • ${qs?.critical || 0} critical`}
        />
      </div>

      <section className="ai-insights-trigger">
        <div>
          <span>MANAGEMENT INTELLIGENCE</span>
          <h3>AI-powered management insights</h3>
          <p>
            Review achievements, critical issues and improvement
            opportunities.
          </p>
        </div>
        <button
          type="button"
          className="ai-insights-open-btn"
          onClick={() => setShowAiInsights(true)}
        >
          <Sparkles size={17} />
          View AI Insights
          <ArrowRight size={16} />
        </button>
      </section>

      {showAiInsights ? (
        <div
          className="ai-insights-overlay"
          onClick={() => setShowAiInsights(false)}
        >
          <section
            className="ai-insights-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-insights-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ai-insights-modal-header">
              <div>
                <span>MANAGEMENT INTELLIGENCE</span>
                <h2 id="ai-insights-title">
                  <Sparkles size={21} />
                  AI Insights
                </h2>
                <p>Key findings from your operational data.</p>
              </div>
              <button
                type="button"
                className="ai-insights-close"
                onClick={() => setShowAiInsights(false)}
                aria-label="Close insights"
              >
                ×
              </button>
            </div>
            <div className="executive-intelligence-grid">
              <Insight title="What went well" tone="good" items={good || []} />
              <Insight
                title="What needs attention"
                tone="attention"
                items={attention || []}
              />
              <Insight
                title="What could have been done better"
                tone="improve"
                items={better || []}
              />
            </div>
            <div className="ai-insights-modal-footer">
              <span>Based on available management dashboard data</span>
              <button
                type="button"
                onClick={() => setShowAiInsights(false)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="dashboard-panel span-12" style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={() => setShowShift((value) => !value)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
          aria-expanded={showShift}
        >
          <div className="panel-heading" style={{ marginBottom: 0, flex: 1 }}>
            <div>
              <span>SHIFT CONTROL</span>
              <h3>What&apos;s being entered right now, Solvent and Quality</h3>
            </div>
            <Radio size={20} />
          </div>
          <span className="pill info" style={{ flexShrink: 0 }}>
            {liveShiftCount} live
            {showShift ? (
              <ChevronUp
                size={14}
                style={{ marginLeft: 6, verticalAlign: '-2px' }}
              />
            ) : (
              <ChevronDown
                size={14}
                style={{ marginLeft: 6, verticalAlign: '-2px' }}
              />
            )}
          </span>
        </button>

        {showShift ? (
          <>
            <p className="panel-muted" style={{ margin: '10px 0' }}>
              Read-only — Management can monitor live shifts but cannot stop
              or reassign them. Those actions remain restricted to Super
              Admin.
            </p>
            <ShiftControlList
              canStop={false}
              canViewAs={false}
              canReassign={false}
              pollMs={30000}
            />
          </>
        ) : null}
      </section>

      <div className="ck-section-label">THE PLANT IN GRAPHS</div>
      <div className="dashboard-canvas ck-graphs">
        <section className="dashboard-panel span-6">
          <div className="panel-heading">
            <div>
              <span>7-DAY TREND</span>
              <h3>Plant health, day by day</h3>
            </div>
            <Link className="text-link" href="/solvent">
              Solvent <ArrowRight size={14} />
            </Link>
          </div>
          <HealthTrend days={trendDaily || []} />
        </section>

        <section className="dashboard-panel span-6">
          <div className="panel-heading">
            <div>
              <span>CONDITION MIX</span>
              <h3>Readings by state</h3>
            </div>
          </div>
          <ConditionMix
            ss={ss}
            qs={qs}
            prod={prod}
            safe={safe}
            solvent={solvent}
            quality={quality}
          />
        </section>

        <section className="dashboard-panel span-4">
          <div className="panel-heading">
            <div>
              <span>ACTION CONTROL</span>
              <h3>Resolution rate</h3>
            </div>
          </div>
          <ResolutionRings
            devPct={devResolutionPct ?? null}
            ticketPct={ticketResolutionPct ?? null}
            openDev={openDev || 0}
            openTickets={openTickets || 0}
          />
        </section>

        <section className="dashboard-panel span-4">
          <div className="panel-heading">
            <div>
              <span>PRODUCT COMPARISON</span>
              <h3>Health by product</h3>
            </div>
          </div>
          <ProductColumns products={products || []} />
        </section>

        <section className="dashboard-panel span-4">
          <div className="panel-heading">
            <div>
              <span>FINANCE CONTROL</span>
              <h3>
                Reconciliation exceptions
                {finance?.latestTxnDate
                  ? ` • as of ${finance.latestTxnDate}`
                  : ''}
              </h3>
            </div>
            <Link className="text-link" href="/finance">
              Finance <ArrowRight size={14} />
            </Link>
          </div>
          <div className="cc-fin">
            <div>
              <span>Physical awaiting ERP/Tally</span>
              <b className="num">{finance?.physicalReview || 0}</b>
            </div>
            <div>
              <span>Payments needing review</span>
              <b className="num">{finance?.paymentsReview || 0}</b>
            </div>
            <div>
              <span>Net payment variance</span>
              <b className="num">
                {typeof finance?.netVariance === 'number'
                  ? `₹${Math.round(finance.netVariance).toLocaleString('en-IN')}`
                  : '—'}
              </b>
            </div>
          </div>
        </section>

        <section className="dashboard-panel span-12">
          <div className="panel-heading">
            <div>
              <span>TREND SIGNALS</span>
              <h3>Evidence across recent inference</h3>
            </div>
          </div>
          {weeklySignals.length || trends?.length ? (
            <ul className="cc-signals">
              {[...weeklySignals, ...(trends || [])]
                .slice(0, 6)
                .map((item: string, index: number) => (
                  <li key={index}>{item}</li>
                ))}
            </ul>
          ) : (
            <p className="panel-muted">
              Trend signals appear after enough sequential readings are
              available.
            </p>
          )}
        </section>
      </div>

      <div className="ck-section-label">OPERATIONS AND ERP</div>
      <OpsControlTowerSection date={period.date} />
    </>
  );
}

// Operations Daily Control Tower — management-focused presentation.
// Existing endpoints, source fields and business calculations are preserved.
function OpsControlTowerSection({ date }: { date: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [fallbackInfo, setFallbackInfo] = useState<{
    requestedDate: string | null;
    isFallback: boolean;
  }>({ requestedDate: null, isFallback: false });
  const [values, setValues] = useState({
    totalSalesValue: 0,
    totalPurchaseValue: 0,
  });
  const [brief, setBrief] = useState<any>(null);
  const [showStory, setShowStory] = useState(false);
  const [supplyKpis, setSupplyKpis] = useState<any>(null);
  const [availability, setAvailability] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    setLoaded(false);

    const qs = date ? `?date=${encodeURIComponent(date)}` : '';

    fetch(`/api/ops/dashboard${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { summary: null }))
      .then((j) => {
        if (!active) return;
        setSummary(j.summary || null);
        setFallbackInfo({
          requestedDate: j.requestedDate || null,
          isFallback: !!j.isFallback,
        });
        setValues({
          totalSalesValue: j.totalSalesValue || 0,
          totalPurchaseValue: j.totalPurchaseValue || 0,
        });
      })
      .catch(() => {
        if (active) setSummary(null);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    fetch('/api/ops/brief', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active) setBrief(j?.brief || null);
      })
      .catch(() => {});

    fetch('/api/ops/supply/dashboard', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active) setSupplyKpis(j?.kpis || null);
      })
      .catch(() => {});

    fetch('/api/ops/reconciliation/sales', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active) setAvailability(j?.availability || []);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [date]);

  if (!loaded) return null;

  if (!summary) {
    return (
      <section
        className="dashboard-panel span-12 erp-control-tower"
        style={{ marginTop: 16 }}
      >
        <div className="erp-main-header">
          <div>
            <span className="erp-eyebrow">ERP / OPERATIONS INTELLIGENCE</span>
            <h2>Operations Control Tower</h2>
            <p>Daily operational performance and management exceptions.</p>
          </div>
          <Boxes size={24} />
        </div>
        <div className="erp-empty-state">
          <h3>No Operations data uploaded yet</h3>
          <p>
            Upload Feeding, Production, Stock Summary and other Operations
            reports to populate this section.
          </p>
          <Link className="text-link" href="/operations/upload">
            Open Operations Data Hub <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    );
  }

  const totalFreeToSell = availability.reduce(
    (sum, item) => sum + Number(item.freeToSellMt || 0),
    0,
  );
  const negativeAvailability = availability.filter(
    (item) => Number(item.freeToSellMt || 0) < 0,
  ).length;
  const erp = buildErpInsight(
    summary,
    supplyKpis,
    availability,
    negativeAvailability,
    totalFreeToSell,
  );
  const variance = Number(summary.production_stock_variance_mt || 0);

  const metrics = [
    {
      label: 'Feeding',
      value: `${Number(summary.feeding_total_weight_mt || 0).toFixed(1)} MT`,
      icon: <Factory size={18} />,
    },
    {
      label: 'Production',
      value: `${Number(summary.production_total_qty_mt || 0).toFixed(1)} MT`,
      icon: <TrendingUp size={18} />,
    },
    {
      label: 'Production ↔ Stock variance',
      value: `${variance.toFixed(1)} MT`,
      icon: <Boxes size={18} />,
    },
    {
      label: 'Closing stock value',
      value: `₹${Math.round(
        Number(summary.stock_closing_value || 0),
      ).toLocaleString('en-IN')}`,
      icon: <BadgeIndianRupee size={18} />,
    },
    {
      label: 'Sales value',
      value: `₹${Math.round(values.totalSalesValue).toLocaleString('en-IN')}`,
      icon: <ShoppingCart size={18} />,
    },
    {
      label: 'Purchase value',
      value: `₹${Math.round(values.totalPurchaseValue).toLocaleString('en-IN')}`,
      icon: <Truck size={18} />,
    },
  ];

  return (
    <section className="erp-control-tower" style={{ marginTop: 18 }}>
      <header className="erp-main-header">
        <div>
          <span className="erp-eyebrow">ERP / OPERATIONS INTELLIGENCE</span>
          <h2>Operations Control Tower</h2>
          <p>
            One view of production, inventory, procurement, sales and
            operational risks.
          </p>
        </div>
        <div className="erp-report-meta">
          <span className="erp-live-dot" />
          <div>
            <small>REPORTING DATE</small>
            <strong>{summary.report_date || '—'}</strong>
          </div>
        </div>
      </header>

      {fallbackInfo.isFallback ? (
        <div className="erp-fallback-notice">
          <CircleAlert size={17} />
          <span>
            No upload found for {fallbackInfo.requestedDate || 'the selected date'}.
            Showing the latest available report from {summary.report_date}.
          </span>
        </div>
      ) : null}

      <div className="erp-kpi-grid">
        <ErpKpi
          label="Open exceptions"
          value={summary.open_exceptions_count || 0}
          note={`${summary.critical_exceptions_count || 0} critical`}
          icon={<CircleAlert size={19} />}
          tone={summary.critical_exceptions_count ? 'danger' : 'warning'}
        />
        <ErpKpi
          label="Open ERP tickets"
          value={summary.open_erp_tickets_count || 0}
          note="Awaiting resolution"
          icon={<TicketCheck size={19} />}
          tone={summary.open_erp_tickets_count ? 'warning' : 'success'}
        />
        <ErpKpi
          label="Over-committed products"
          value={negativeAvailability}
          note="Negative Free to Sell"
          icon={<ShoppingCart size={19} />}
          tone={negativeAvailability ? 'danger' : 'success'}
        />
        <ErpKpi
          label="Production / Stock variance"
          value={`${variance.toFixed(1)} MT`}
          note="Reconciliation variance"
          icon={<TrendingUp size={19} />}
          tone={Math.abs(variance) >= 0.5 ? 'warning' : 'success'}
        />
        <ErpKpi
          label="Open purchase orders"
          value={supplyKpis?.openPoCount ?? '—'}
          note={
            supplyKpis
              ? `${Number(supplyKpis.totalPendingQty || 0).toFixed(1)} MT pending`
              : 'Supply data unavailable'
          }
          icon={<Truck size={19} />}
          tone="info"
        />
        <ErpKpi
          label="Vehicles awaiting weighment"
          value={supplyKpis?.vehiclesAwaitingWeighment ?? '—'}
          note="Inbound gate status"
          icon={<Boxes size={19} />}
          tone={
            Number(supplyKpis?.vehiclesAwaitingWeighment || 0)
              ? 'warning'
              : 'success'
          }
        />
      </div>

      {brief ? (
        <div className="erp-story-card">
          <button
            type="button"
            className="erp-story-toggle"
            onClick={() => setShowStory((value) => !value)}
          >
            <span className="erp-story-title">
              <Sparkles size={17} />
              <span>
                <small>MANAGEMENT BRIEF</small>
                <strong>Daily Operations Summary</strong>
              </span>
            </span>
            <span className="erp-story-action">
              {showStory ? 'Hide details' : 'View details'}
              {showStory ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
            </span>
          </button>
          <p className="erp-story-summary">{brief.summary}</p>
          {showStory ? (
            <div className="erp-story-details">
              {[
                ['Production', brief.productionSummary],
                ['Inventory', brief.inventorySummary],
                ['Supply', brief.supplySummary],
                ['Sales', brief.salesSummary],
              ]
                .filter(([, value]) => Boolean(value))
                .map(([label, value]: any) => (
                  <div className="erp-story-detail" key={label}>
                    <small>{label}</small>
                    <p>{value}</p>
                  </div>
                ))}
              {brief.risks?.length ? (
                <div className="erp-story-list">
                  <strong>Risks to monitor</strong>
                  <ul>
                    {brief.risks.slice(0, 4).map((item: string, index: number) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {brief.actionsRequired?.length ? (
                <div className="erp-story-list">
                  <strong>Actions required</strong>
                  <ul>
                    {brief.actionsRequired
                      .slice(0, 4)
                      .map((item: string, index: number) => (
                        <li key={index}>{item}</li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="erp-section-heading">
        <div>
          <span className="erp-eyebrow">MANAGEMENT REVIEW</span>
          <h3>What the numbers are telling us</h3>
        </div>
      </div>
      <div className="erp-insight-grid">
        <Insight title="What went well" tone="good" items={erp.good} />
        <Insight title="Needs attention" tone="attention" items={erp.attention} />
        <Insight
          title="Improvement opportunities"
          tone="improve"
          items={erp.better}
        />
      </div>

      <div className="erp-section-heading">
        <div>
          <span className="erp-eyebrow">DAILY PERFORMANCE</span>
          <h3>Operational data at a glance</h3>
        </div>
      </div>
      <div className="erp-data-grid">
        {metrics.map((metric) => (
          <div className="erp-data-card" key={metric.label}>
            <div className="erp-data-card-top">
              <span className="erp-data-icon">{metric.icon}</span>
              <span>{metric.label}</span>
            </div>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <div className="erp-section-heading">
        <div>
          <span className="erp-eyebrow">SUPPLY &amp; FULFILMENT</span>
          <h3>Procurement and sales readiness</h3>
        </div>
      </div>
      <div className="erp-data-grid erp-data-grid-two">
        <div className="erp-detail-card">
          <div className="erp-detail-card-heading">
            <Truck size={20} />
            <div>
              <h4>Supply overview</h4>
              <p>Purchase orders and inbound movement</p>
            </div>
          </div>
          {supplyKpis ? (
            <div className="erp-metric-list">
              <ErpMetric
                label="Open purchase orders"
                value={supplyKpis.openPoCount ?? 0}
              />
              <ErpMetric
                label="Pending quantity"
                value={`${Number(supplyKpis.totalPendingQty || 0).toFixed(1)} MT`}
              />
              <ErpMetric
                label="Vehicles awaiting weighment"
                value={supplyKpis.vehiclesAwaitingWeighment ?? 0}
              />
              <ErpMetric
                label="Lots in progress"
                value={supplyKpis.lotsInProgress ?? 0}
              />
            </div>
          ) : (
            <p className="erp-muted">Supply data is not available.</p>
          )}
          <Link className="erp-card-link" href="/operations/supply">
            Open Supply Intelligence <ArrowRight size={15} />
          </Link>
        </div>

        <div className="erp-detail-card">
          <div className="erp-detail-card-heading">
            <ShoppingCart size={20} />
            <div>
              <h4>Sales readiness</h4>
              <p>Finished goods availability</p>
            </div>
          </div>
          <div className="erp-metric-list">
            <ErpMetric label="Products tracked" value={availability.length} />
            <ErpMetric
              label="Total Free to Sell"
              value={`${totalFreeToSell.toFixed(1)} MT`}
            />
            <ErpMetric
              label="Over-committed products"
              value={negativeAvailability}
              alert={negativeAvailability > 0}
            />
          </div>
          <Link className="erp-card-link" href="/operations/sales">
            Open Sales &amp; Fulfilment <ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <div className="erp-section-heading">
        <div>
          <span className="erp-eyebrow">EXCEPTION MONITORING</span>
          <h3>Product variance watchlist</h3>
        </div>
      </div>
      <div className="erp-table-card">
        {summary.topVariance?.length ? (
          <div className="erp-table-scroll">
            <table className="erp-variance-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Variance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.topVariance.slice(0, 5).map((item: any, index: number) => (
                  <tr key={`${item.productName}-${index}`}>
                    <td>{item.productName}</td>
                    <td>{Number(item.variance).toFixed(2)} MT</td>
                    <td>
                      <span
                        className={`erp-status-pill ${
                          Math.abs(Number(item.variance)) >= 0.5
                            ? 'is-warning'
                            : 'is-normal'
                        }`}
                      >
                        {Math.abs(Number(item.variance)) >= 0.5
                          ? 'Review required'
                          : 'Within threshold'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="erp-table-empty">
            No product-level variance records are available.
          </p>
        )}
      </div>
    </section>
  );
}

function ErpKpi({
  label,
  value,
  note,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  note: string;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className={`erp-kpi-card tone-${tone}`}>
      <div className="erp-kpi-top">
        <span className="erp-kpi-icon">{icon}</span>
        <span className="erp-kpi-label">{label}</span>
      </div>
      <strong className="erp-kpi-value">{value}</strong>
      <span className="erp-kpi-note">{note}</span>
    </div>
  );
}

function ErpMetric({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string | number;
  alert?: boolean;
}) {
  return (
    <div className="erp-metric-row">
      <span>{label}</span>
      <strong className={alert ? 'erp-value-alert' : ''}>{value}</strong>
    </div>
  );
}

// Deterministic — every statement traces directly to a number already
// fetched for this section: never invented, never speculative.
function buildErpInsight(
  summary: any,
  supplyKpis: any,
  availability: any[],
  negativeAvailability: number,
  totalFreeToSell: number,
) {
  const good: string[] = [];
  const attention: string[] = [];
  const better: string[] = [];

  const openExceptions = summary.open_exceptions_count || 0;
  const critical = summary.critical_exceptions_count || 0;
  const variance = Number(summary.production_stock_variance_mt || 0);
  const openTickets = summary.open_erp_tickets_count || 0;

  if (!openExceptions) {
    good.push('No open Operations exceptions.');
  } else {
    attention.push(
      `${openExceptions} open Operations exception${
        openExceptions === 1 ? '' : 's'
      }${critical ? `, ${critical} critical` : ''}.`,
    );
  }

  if (Math.abs(variance) < 0.5) {
    good.push(`Production ↔ Stock variance is tight (${variance.toFixed(1)} MT).`);
  } else {
    better.push(
      `Production ↔ Stock variance is ${variance.toFixed(1)} MT — review the largest contributing product${
        summary.topVariance?.length
          ? ` (${summary.topVariance[0].productName})`
          : ''
      }.`,
    );
  }

  if (openTickets) {
    attention.push(
      `${openTickets} open Operations ticket${
        openTickets === 1 ? '' : 's'
      } still unresolved.`,
    );
  }

  if (supplyKpis) {
    if (!supplyKpis.vehiclesAwaitingWeighment) {
      good.push('No vehicles waiting on a weighment.');
    } else {
      attention.push(
        `${supplyKpis.vehiclesAwaitingWeighment} vehicle${
          supplyKpis.vehiclesAwaitingWeighment === 1 ? '' : 's'
        } at the gate still awaiting weighment.`,
      );
    }

    if (supplyKpis.openPoCount) {
      better.push(
        `${supplyKpis.openPoCount} purchase order${
          supplyKpis.openPoCount === 1 ? '' : 's'
        } still open, ${Number(supplyKpis.totalPendingQty || 0).toFixed(1)} MT pending.`,
      );
    }
  }

  if (availability.length) {
    if (!negativeAvailability) {
      good.push(
        `All ${availability.length} tracked product(s) have Free to Sell stock available.`,
      );
    } else {
      attention.push(
        `${negativeAvailability} product${
          negativeAvailability === 1 ? '' : 's'
        } over-committed — Free to Sell is negative.`,
      );
    }

    if (totalFreeToSell > 0) {
      good.push(
        `${totalFreeToSell.toFixed(1)} MT free to sell across finished goods.`,
      );
    }
  }

  return { good, attention, better };
}

const insightIcon: Record<string, any> = {
  good: CheckCircle2,
  attention: TriangleAlert,
  improve: Lightbulb,
};

function Insight({
  title,
  tone,
  items,
}: {
  title: string;
  tone: string;
  items: string[];
}) {
  const Icon = insightIcon[tone] || CheckCircle2;

  return (
    <section className={`executive-card ${tone}`}>
      <div className="section-title">
        <span className="exec-icon">
          <Icon size={16} />
        </span>
        {title}
      </div>
      {items.length ? (
        <ul>
          {items.slice(0, 7).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No evidence-backed statement is available yet.</p>
      )}
    </section>
  );
}
