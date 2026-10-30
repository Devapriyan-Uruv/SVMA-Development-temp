'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleAlert, Clock3, Factory } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Kpi } from '@/components/Kpi';
import { Donut, StatusBars, TrendChart } from '@/components/IntelligenceCharts';
import { targetBounds } from '@/lib/metrics';

export default function Analytics() {
  const [data, setData] = useState<any>();
  const [product, setProduct] = useState('all');
  const [section, setSection] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [severity, setSeverity] = useState('all');
  const [metricKey, setMetricKey] = useState('');

  useEffect(() => {
    const qs = new URLSearchParams();
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    if (severity !== 'all') qs.set('severity', severity);
    if (product !== 'all') qs.set('product', product);
    fetch(`/api/solvent/dashboard?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [dateFrom, dateTo, severity, product]);

  const metrics = data?.metrics || [];
  const sections = useMemo(
    () => Array.from(new Set(metrics.map((m: any) => m.section).filter(Boolean))) as string[],
    [metrics],
  );
  const shown = metrics.filter(
    (m: any) =>
      (product === 'all' || m.productCode === product || m.productCode === 'PLANT') &&
      (section === 'all' || m.section === section),
  );
  const summary = data?.summary || {};
  useEffect(() => {
    if (shown.length && !shown.some((m: any) => m.key === metricKey)) setMetricKey(shown[0].key);
  }, [shown.map((m: any) => m.key).join('|')]);
  const selected = shown.find((m: any) => m.key === metricKey) || null;

  return (
    <>
      <PageHeader
        title="Solvent Analytics"
        subtitle="Critical parameter timelines • product-wise process trends • safety and entry compliance"
        backHref="/solvent"
        backLabel="Solvent Production & Safety"
        action={
          <div className="filter-row">
            <select value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="all">All products</option>
              <option value="RB">Rice Bran</option>
              <option value="COPRA">Copra</option>
              <option value="PK">Palm Kernel</option>
            </select>
            <select value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="all">All sections</option>
              {sections.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="all">All severities</option>
              <option value="normal">Normal</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
              <option value="unconfigured">Target missing</option>
            </select>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
          </div>
        }
      />

      <div className="grid kpis modern-kpis">
        <Kpi icon={Factory} tone="blue" label="Plant Health" value={data ? `${summary.health || 0}%` : '—'} />
        <Kpi icon={Clock3} tone="green" label="Shift Coverage" value={data ? `${summary.compliance || 0}%` : '—'} />
        <Kpi icon={AlertTriangle} tone="amber" label="Warning" value={summary.warning ?? '—'} />
        <Kpi icon={CircleAlert} tone="rose" label="Critical" value={summary.critical ?? '—'} />
      </div>

      {product !== 'all' ? (
        <div className="notice" role="status" style={{ marginTop: 12 }}>
          {data?.lastRun?.[product] ? (
            <>Last run in production: <b>{data.lastRun[product].date}</b>{data.lastRun[product].shift ? ` • ${data.lastRun[product].shift}` : ''}</>
          ) : (
            <>No production record found for this product yet.</>
          )}
        </div>
      ) : null}

      <div className="dashboard-canvas" style={{ marginTop: 16 }}>
        <section className="dashboard-panel span-4">
          <div className="panel-heading">
            <div>
              <span>HEALTH MIX</span>
              <h3>Current shift</h3>
            </div>
          </div>
          <Donut value={summary.health || 0} label="Overall health" />
          <StatusBars
            normal={summary.normal || 0}
            warning={summary.warning || 0}
            critical={summary.critical || 0}
          />
        </section>

        <section className="dashboard-panel span-8">
          <div className="panel-heading">
            <div>
              <span>ATTENTION TIMELINE</span>
              <h3>Latest out-of-target readings</h3>
            </div>
          </div>
          <div className="event-timeline">
            {(data?.criticalTimeline || []).slice(0, 8).map((x: any, i: number) => (
              <div key={i} className={`event-row ${x.status}`}>
                <i />
                <div>
                  <b>{x.parameter}</b>
                  <span>
                    {x.product} • {x.section}
                  </span>
                </div>
                <div>
                  <strong>{x.actual ?? '—'}</strong>
                  <small>Target {x.target || '—'}</small>
                </div>
                <time>
                  {new Date(x.time).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            ))}
            {!data?.criticalTimeline?.length ? (
              <p className="panel-muted">No warning or critical timeline is available yet.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="dashboard-panel" style={{ marginTop: 16 }}>
        <div className="panel-heading">
          <div>
            <span>METRIC TRENDLINE</span>
            <h3>{selected ? selected.name : 'Pick a parameter to view its trend'}</h3>
          </div>
          {shown.length ? (
            <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)} style={{ minWidth: 240 }}>
              {shown.map((m: any) => (
                <option key={m.key} value={m.key}>
                  {m.section} • {m.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {selected ? (
          (() => {
            const bounds = targetBounds(selected.target);
            return (
              <>
                <div className="metric-subline">
                  <span>
                    {selected.product} • {selected.section}
                  </span>
                  <span className={`pill ${selected.critical ? 'danger' : selected.warning ? 'warn' : 'ok'}`}>
                    {selected.latest ?? '—'} {selected.unit || ''}
                  </span>
                  <span>
                    Target <b>{selected.target || 'Set in Admin'}</b>
                  </span>
                  <span>
                    Health <b>{selected.health}%</b>
                  </span>
                  <span>
                    Avg <b>{selected.average == null ? '—' : Number(selected.average).toFixed(2)}</b>
                  </span>
                </div>
                <TrendChart points={selected.points || []} targetLow={bounds.low} targetHigh={bounds.high} />
              </>
            );
          })()
        ) : (
          <p className="panel-muted">No readings available for the selected filters.</p>
        )}
      </section>
    </>
  );
}
