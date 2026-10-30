export function SkeletonLine({width}:{width?:'w-30'|'w-40'|'w-60'|'w-80'}){return <div className={`skeleton skeleton-line ${width||''}`}/>}

export function SkeletonKpis({count=4}:{count?:number}){
  return <div className="skeleton-kpis">{Array.from({length:count}).map((_,i)=><div className="skeleton-kpi" key={i}><SkeletonLine width="w-40"/><div className="skeleton skeleton-block" style={{height:26,width:'70%',marginTop:14}}/><SkeletonLine width="w-60"/></div>)}</div>;
}

export function SkeletonCard({lines=4}:{lines?:number}){
  return <div className="skeleton-card"><SkeletonLine width="w-30"/><div style={{height:10}}/>{Array.from({length:lines}).map((_,i)=><SkeletonLine key={i} width={i%2?'w-80':'w-60'}/>)}</div>;
}

export function SkeletonTable({rows=5,cols=5}:{rows?:number;cols?:number}){
  return <div className="table-wrap"><table><thead><tr>{Array.from({length:cols}).map((_,i)=><th key={i}><div className="skeleton skeleton-line w-60"/></th>)}</tr></thead><tbody>{Array.from({length:rows}).map((_,r)=><tr key={r}>{Array.from({length:cols}).map((_,c)=><td key={c}><div className="skeleton skeleton-line w-80"/></td>)}</tr>)}</tbody></table></div>;
}

export function SkeletonDashboard(){
  return <div className="grid" style={{gap:14}}>
    <div className="skeleton skeleton-block" style={{height:150}}/>
    <SkeletonKpis/>
    <div className="dashboard-canvas"><div className="skeleton skeleton-block span-7" style={{height:220}}/><div className="skeleton skeleton-block span-5" style={{height:220}}/></div>
  </div>;
}
