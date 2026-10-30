'use client';
import {useId,useState} from 'react';

type Pt={label?:string;time?:string;value:number|string|null;status?:string};
function numeric(points:Pt[]){return points.map((p,i)=>({i,label:p.label||p.time||String(i+1),value:Number(p.value),status:p.status})).filter(p=>Number.isFinite(p.value))}
// Point labels arrive as either a full ISO timestamp (slot_start/
// server_timestamp) or a plain sequential fallback ("1","2",...) when no
// time field was available. Only the former should ever be reformatted —
// blindly slicing the last N characters of an ISO string (the previous
// approach) grabbed whatever the timezone suffix happened to be (e.g.
// PostgREST's "+00:00"), not the actual time.
function formatLabel(label:string){
 if(/^\d{4}-\d{2}-\d{2}/.test(label)){
  const d=new Date(label);
  if(!Number.isNaN(d.getTime()))return d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
 }
 return label;
}


export function TrendChart({
  points,
  targetLow,
  targetHigh,
  height = 210,
}: {
  points: Pt[];
  targetLow?: number | null;
  targetHigh?: number | null;
  height?: number;
}) {
  const id = useId();
  const d = numeric(points);
  const [hover, setHover] = useState<number | null>(null);

  if (d.length < 2) {
    return <div className="chart-empty">Trend appears after two numeric readings.</div>;
  }

  const low = targetLow != null && Number.isFinite(targetLow) ? targetLow : null;
  const high = targetHigh != null && Number.isFinite(targetHigh) ? targetHigh : null;

  const values = d.map(p => p.value);
  const bounds = [...values, ...(low !== null ? [low] : []), ...(high !== null ? [high] : [])];
  const min = Math.min(...bounds);
  const max = Math.max(...bounds);
  const padding = (max - min || Math.max(Math.abs(max) * 0.1, 1)) * 0.18;
  const lo = min - padding;
  const hi = max + padding;

  const left = 52;
  const right = 382;
  const top = 20;
  const bottom = 153;
  const plotHeight = bottom - top;

  const x = (i: number) => left + (i / (d.length - 1)) * (right - left);
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * plotHeight;

  const path = d.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`
  ).join(' ');

  const ticks = Array.from({ length: 5 }, (_, i) => hi - (i / 4) * (hi - lo));
  const hoverPoint = hover !== null ? d[hover] : null;

  return (
    <div className="trend-chart-wrap svma-trend" onMouseLeave={() => setHover(null)}>
      <div className="svma-trend-legend">
        <span><i className="svma-legend-dot normal" /> Readings</span>
        {low !== null && high !== null ? (
          <span><i className="svma-legend-line" /> Target range: {low}–{high} kg</span>
        ) : null}
        <span><i className="svma-legend-dot critical" /> Out of range</span>
      </div>

      <svg
        className="trend-chart svma-trend-svg"
        viewBox="0 0 400 210"
        style={{ height }}
        role="img"
        aria-label="Pressure readings over time"
      >
        <defs>
          <linearGradient id={`${id}-line-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0175CA" stopOpacity=".13" />
            <stop offset="100%" stopColor="#0175CA" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Readable horizontal grid and Y-axis labels */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={y(tick)}
              y2={y(tick)}
              className="svma-chart-grid"
            />
            <text
              x={left - 9}
              y={y(tick) + 3}
              textAnchor="end"
              className="svma-axis-label"
            >
              {Number(tick.toFixed(2)).toLocaleString('en-IN')}
            </text>
          </g>
        ))}

        {/* Shaded acceptable operating range */}
        {low !== null && high !== null && high > low ? (
          <rect
            x={left}
            y={y(high)}
            width={right - left}
            height={Math.max(0, y(low) - y(high))}
            fill="#16A34A"
            opacity=".09"
            rx="2"
          />
        ) : null}

        {/* Dashed target boundaries */}
        {low !== null ? (
          <line
            x1={left}
            x2={right}
            y1={y(low)}
            y2={y(low)}
            className="svma-target-boundary"
          />
        ) : null}

        {high !== null ? (
          <line
            x1={left}
            x2={right}
            y1={y(high)}
            y2={y(high)}
            className="svma-target-boundary"
          />
        ) : null}

        {/* Subtle fill below the trend */}
        <path
          d={`${path} L ${x(d.length - 1)} ${bottom} L ${x(0)} ${bottom} Z`}
          fill={`url(#${id}-line-fill)`}
        />

        {/* Actual reading line */}
        <path d={path} className="svma-reading-line" />

        {/* Selected reading guide */}
        {hover !== null ? (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={top}
            y2={bottom}
            className="svma-hover-guide"
          />
        ) : null}

        {d.map((p, i) => {
          const outOfRange =
            (low !== null && p.value < low) ||
            (high !== null && p.value > high);

          const severity = /critical|danger|error/i.test(p.status || '');
          const warning = /warning|warn/i.test(p.status || '');

          const color = severity || outOfRange
            ? (severity ? '#DC2626' : '#F59E0B')
            : warning
              ? '#F59E0B'
              : '#0175CA';

          return (
            <g key={`${p.label}-${i}`}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={hover === i ? 6 : 4}
                fill={color}
                stroke="#FFFFFF"
                strokeWidth="2"
                className="svma-reading-point"
              />

              <rect
                x={x(i) - 12}
                y={top}
                width="24"
                height={bottom - top}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(v => v === i ? null : i)}
                tabIndex={0}
                role="button"
                aria-label={`${formatLabel(p.label)}: ${p.value} kg`}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}

        {/* Time labels */}
        {d.map((p, i) => {
          if (i !== 0 && i !== d.length - 1 && d.length > 5 && i % Math.ceil(d.length / 4) !== 0) {
            return null;
          }

          return (
            <text
              key={`label-${i}`}
              x={x(i)}
              y="177"
              textAnchor={i === 0 ? 'start' : i === d.length - 1 ? 'end' : 'middle'}
              className="svma-axis-label"
            >
              {formatLabel(p.label)}
            </text>
          );
        })}

        <text
          x="7"
          y="12"
          className="svma-axis-unit"
        >
          kg
        </text>
      </svg>

      {hoverPoint ? (
        <div
          className="trend-tooltip"
          style={{
            left: `${(x(hover!) / 400) * 100}%`,
            top: 8,
          }}
        >
          <span>{formatLabel(hoverPoint.label)}</span>
          <b>{hoverPoint.value} kg</b>
          <small>
            {low !== null && hoverPoint.value < low
              ? 'Below target'
              : high !== null && hoverPoint.value > high
                ? 'Above target'
                : hoverPoint.status || 'Reading'}
          </small>
        </div>
      ) : null}
    </div>
  );
}


export function Donut({value,label}:{value:number;label:string}){
 const v=Math.max(0,Math.min(100,Number.isFinite(value)?value:0)),r=42,c=2*Math.PI*r;
 return <div className="donut-wrap">
  <svg viewBox="0 0 110 110" role="img" aria-label={`${v}% ${label}`}>
   <circle cx="55" cy="55" r={r} className="donut-bg"/>
   <circle cx="55" cy="55" r={r} className="donut-value" strokeDasharray={`${c*v/100} ${c}`} transform="rotate(-90 55 55)"/>
  </svg>
  <div><b>{Math.round(v)}%</b><span>{label}</span></div>
 </div>;
}

export function StatusBars({normal=0,warning=0,critical=0}:{normal?:number;warning?:number;critical?:number}){
 const safeNormal=Math.max(0,normal),safeWarning=Math.max(0,warning),safeCritical=Math.max(0,critical);
 const total=safeNormal+safeWarning+safeCritical;
 const rows=[
  {label:'Normal',count:safeNormal,cls:'bar-ok',dot:'status-dot-ok'},
  {label:'Warning',count:safeWarning,cls:'bar-warn',dot:'status-dot-warn'},
  {label:'Critical',count:safeCritical,cls:'bar-critical',dot:'status-dot-critical'}
 ];
 return <div className="status-bars">
  <div className="status-bars-summary"><span>Total readings</span><b>{total}</b></div>
  {rows.map(row=><div className="status-bar-row" key={row.label}>
   <span className="status-bar-label"><i className={row.dot}/>{row.label}</span>
   <div className="status-track"><i className={row.cls} style={{width:`${total?row.count/total*100:0}%`}}/></div>
   <b>{row.count}</b>
  </div>)}
 </div>;
}

export function BarCompare({bars,height=170}:{bars:{label:string;value:number}[];height?:number}){
 if(!bars.length)return <div className="chart-empty">No data to compare yet.</div>;
 const clean=bars.map(b=>({...b,value:Number.isFinite(b.value)?b.value:0}));
 const max=Math.max(...clean.map(b=>b.value),0)||1;
 const n=clean.length,slot=352/n,barW=Math.min(64,slot*.55);
 const x=(i:number)=>24+i*slot+(slot-barW)/2;
 const y=(v:number)=>18+(1-Math.max(0,v)/max)*128;
 return <div className="trend-chart-wrap">
  <svg className="trend-chart" viewBox={`0 0 400 ${height}`} preserveAspectRatio="none" role="img" aria-label="Category comparison chart">
   {[0,1,2,3].map(i=><line key={i} x1="24" x2="376" y1={18+i*42} y2={18+i*42} className="chart-grid-line"/>)}
   {clean.map((b,i)=>{
    const top=y(b.value);
    return <g key={`${b.label}-${i}`}>
     <rect x={x(i)} y={top} width={barW} height={Math.max(0,150-top)} rx={5} className="compare-bar" fill="#0175CA"/>
     <text x={x(i)+barW/2} y={Math.max(12,top-7)} textAnchor="middle" className="chart-label chart-value-label">{b.value.toLocaleString('en-IN',{maximumFractionDigits:1})}</text>
     <text x={x(i)+barW/2} y="174" textAnchor="middle" className="chart-label">{b.label}</text>
    </g>;
   })}
  </svg>
 </div>;
}


