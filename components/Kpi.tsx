import type {ComponentType} from 'react';

type IconType = ComponentType<{size?: number|string}>;

export function Kpi({ label, value, foot, icon: Icon, tone }: { label: string; value: string | number; foot?: string; icon?: IconType; tone?: string }) {
  return <div className={`card tight kpi-card${tone ? ` tone-${tone}` : ''}`}>
    {Icon ? <span className="kpi-icon"><Icon size={18}/></span> : null}
    <div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{foot ? <div className="kpi-foot">{foot}</div> : null}<span className="kpi-accent"/>
  </div>;
}
