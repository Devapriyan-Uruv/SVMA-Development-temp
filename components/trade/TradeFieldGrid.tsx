'use client';
import type {TradeField} from '@/lib/tradeFields';

export function TradeFieldGrid({fields,values,onChange,disabled}:{fields:TradeField[];values:Record<string,any>;onChange:(key:string,value:any)=>void;disabled?:boolean}){
 return <div className="grid two">
  {fields.map(f=><label className="field" key={f.key}>
   <span>{f.label}</span>
   {f.type==='checkbox'
    ?<input type="checkbox" checked={!!values[f.key]} disabled={disabled} onChange={e=>onChange(f.key,e.target.checked)}/>
    :f.type==='select'
    ?<select value={values[f.key]??''} disabled={disabled} onChange={e=>onChange(f.key,e.target.value)}>
      <option value="">Select…</option>
      {(f.options||[]).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
     </select>
    :f.type==='textarea'
    ?<textarea rows={2} value={values[f.key]??''} disabled={disabled} onChange={e=>onChange(f.key,e.target.value)}/>
    :<input type={f.type||'text'} value={values[f.key]??''} disabled={disabled} onChange={e=>onChange(f.key,e.target.value)}/>}
  </label>)}
 </div>;
}
