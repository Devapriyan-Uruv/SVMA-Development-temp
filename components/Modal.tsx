'use client';
import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {AlertTriangle, Info} from 'lucide-react';

export function Modal({open,onClose,title,description,tone='info',confirmLabel='Confirm',cancelLabel='Cancel',onConfirm,busy,confirmDisabled,children}:{
  open:boolean;onClose:()=>void;title:string;description?:string;tone?:'info'|'danger';
  confirmLabel?:string;cancelLabel?:string;onConfirm?:()=>void;busy?:boolean;confirmDisabled?:boolean;children?:ReactNode;
}){
  useEffect(()=>{
    if(!open)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[open,onClose]);
  if(!open)return null;
  return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal-icon ${tone}`}>{tone==='danger'?<AlertTriangle size={18}/>:<Info size={18}/>}</div>
      <h3>{title}</h3>
      {description?<p>{description}</p>:null}
      {children}
      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        {onConfirm?<button type="button" className={tone==='danger'?'btn btn-danger':'btn btn-primary'} onClick={onConfirm} disabled={busy||confirmDisabled}>{busy?'Working…':confirmLabel}</button>:null}
      </div>
    </div>
  </div>;
}
