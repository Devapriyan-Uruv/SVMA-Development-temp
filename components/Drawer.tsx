'use client';
import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {X} from 'lucide-react';

export function Drawer({open,onClose,title,subtitle,wide,footer,children}:{open:boolean;onClose:()=>void;title:string;subtitle?:string;wide?:boolean;footer?:ReactNode;children:ReactNode}){
  useEffect(()=>{
    if(!open)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};
    document.addEventListener('keydown',onKey);
    const prevOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=prevOverflow};
  },[open,onClose]);
  if(!open)return null;
  return <div className="drawer-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className={`drawer-panel ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-head">
        <div><h3>{title}</h3>{subtitle?<p>{subtitle}</p>:null}</div>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close"><X size={16}/></button>
      </div>
      <div className="drawer-body">{children}</div>
      {footer?<div className="drawer-foot">{footer}</div>:null}
    </div>
  </div>;
}
