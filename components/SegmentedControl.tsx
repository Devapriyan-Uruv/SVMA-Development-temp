export function SegmentedControl<T extends string>({value,onChange,options}:{value:T;onChange:(v:T)=>void;options:{value:T;label:string}[]}){
  return <div className="segmented">{options.map(o=><button type="button" key={o.value} className={value===o.value?'active':''} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>;
}
