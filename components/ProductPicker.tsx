'use client';
import {Check, Droplets, Leaf, Nut} from 'lucide-react';
import {PRODUCTS} from '@/lib/products';

const icons:any={RB:Leaf,COPRA:Droplets,PK:Nut};
export function ProductPicker({value,onChange,multiple=true,label='What is running in this shift?'}:{value:string[];onChange:(v:string[])=>void;multiple?:boolean;label?:string}){
 function toggle(code:string){if(multiple){onChange(value.includes(code)?value.filter(x=>x!==code):[...value,code])}else onChange([code])}
 return <div className="product-picker"><div className="product-picker-label">{label}</div><div className="product-picker-grid">{PRODUCTS.map(p=>{const Icon=icons[p.code],active=value.includes(p.code);return <button type="button" key={p.code} className={`product-choice ${active?'active':''}`} onClick={()=>toggle(p.code)}><span className="product-choice-icon"><Icon size={20}/></span><span className="product-choice-copy"><b>{p.name}</b><small>{p.description}</small></span>{active?<Check className="product-check" size={18}/>:null}</button>})}</div></div>
}

export function ProductTabs({products,value,onChange,allowPlant=false}:{products:string[];value:string;onChange:(v:string)=>void;allowPlant?:boolean}){
 const all=allowPlant?['PLANT',...products]:products;
 return <div className="product-tabs">{all.map(code=><button type="button" key={code} onClick={()=>onChange(code)} className={value===code?'active':''}>{code==='PLANT'?'Plant-wide':PRODUCTS.find(p=>p.code===code)?.name||code}</button>)}</div>
}
