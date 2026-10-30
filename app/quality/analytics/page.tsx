'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, FlaskConical } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Kpi } from '@/components/Kpi';
import { TrendChart } from '@/components/IntelligenceCharts';
import { targetBounds } from '@/lib/metrics';

export default function QualityAnalytics() {
  const [data, setData] = useState<any>();
  const [product, setProduct] = useState('all');
  const [group, setGroup] = useState('all');
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
    fetch(`/api/quality/dashboard?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [dateFrom, dateTo, severity, product]);

  const metrics = data?.metrics || [];
  const groups = useMemo(
    () =>
      Array.from(
        new Set(
          metrics
            .filter((m: any) => product === 'all' || m.productCode === product)
            .map((m: any) => m.group)
            .filter(Boolean),
        ),
      ) as string[],
    [metrics, product],
  );

  const shown = metrics.filter(
    (m: any) =>
      (product === 'all' || m.productCode === product) &&
      (group === 'all' || m.group === group),
  );
  const summary = data?.summary || {};
  useEffect(() => {
    if (shown.length && !shown.some((m: any) => m.key === metricKey)) setMetricKey(shown[0].key);
  }, [shown.map((m: any) => m.key).join('|')]);
  const selected = shown.find((m: any) => m.key === metricKey) || null;

  return (
    <>
      <PageHeader
        title="Quality Analytics"
        subtitle="Rice Bran • Copra • Palm Kernel — sampling schedules, target compliance and metric timelines"
        backHref="/quality"
        backLabel="Quality Intelligence"
        action={
          <div className="filter-row">
            <select
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setGroup('all');
              }}
            >
              <option value="all">All products</option>
              <option value="RB">Rice Bran</option>
              <option value="COPRA">Copra</option>
              <option value="PK">Palm Kernel</option>
            </select>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">All process groups</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
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
        <Kpi icon={FlaskConical} tone="green" label="Quality Health" value={data ? `${summary.health || 0}%` : '—'} />
        <Kpi icon={CheckCircle2} tone="blue" label="Normal" value={summary.normal ?? '—'} />
        <Kpi icon={AlertTriangle} tone="amber" label="Warning" value={summary.warnings ?? '—'} />
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
                  {m.group} • {m.name}
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
                    {selected.product} • {selected.group}
                  </span>
                  <span
                    className={`pill ${
                      selected.critical ? 'danger' : selected.warnings ? 'warn' : selected.target ? 'ok' : 'neutral'
                    }`}
                  >
                    {selected.latest ?? '—'} {selected.unit || ''}
                  </span>
                  <span>
                    Target <b>{selected.target || 'Set in Admin'}</b>
                  </span>
                  <span>
                    Sampling <b>{selected.sampleFrequency || selected.frequency}</b>
                  </span>
                  <span>
                    Result SLA <b>{selected.resultLatencyMinutes ? `${selected.resultLatencyMinutes} min` : '—'}</b>
                  </span>
                </div>
                <TrendChart points={selected.points || []} targetLow={bounds.low} targetHigh={bounds.high} />
                <div className="chart-meta">
                  <span>
                    In target <b>{selected.normalPct}%</b>
                  </span>
                  <span>
                    Min <b>{selected.min == null ? '—' : Number(selected.min).toFixed(2)}</b>
                  </span>
                  <span>
                    Max <b>{selected.max == null ? '—' : Number(selected.max).toFixed(2)}</b>
                  </span>
                  <span>
                    Avg <b>{selected.average == null ? '—' : Number(selected.average).toFixed(2)}</b>
                  </span>
                  <span>
                    Warnings <b>{selected.warnings}</b>
                  </span>
                  <span>
                    Critical <b>{selected.critical}</b>
                  </span>
                </div>
              </>
            );
          })()
        ) : (
          <p className="panel-muted">No Quality readings are available for the selected product and group.</p>
        )}
      </section>
    </>
  );
}
