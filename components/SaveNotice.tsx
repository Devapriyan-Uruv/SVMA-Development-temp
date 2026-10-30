'use client';
import {createPortal} from 'react-dom';
import {useEffect,useRef} from 'react';
import {CheckCircle2,AlertTriangle,CloudAlert} from 'lucide-react';
export function SaveNotice({notice,onClose}:{notice:{title:string;message:string;tone:'success'|'warning'|'error'}|null;onClose:()=>void}){
 const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(notice)button.current?.focus()},[notice]);
 if(!notice)return null;const Icon=notice.tone==='success'?CheckCircle2:notice.tone==='error'?CloudAlert:AlertTriangle;
 return createPortal(<div className="save-notice-overlay"><section className={`save-notice ${notice.tone}`} role="alertdialog" aria-modal="true" aria-labelledby="save-title" aria-describedby="save-proof" onKeyDown={e=>{if(e.key==='Escape'){onClose()}if(e.key==='Tab'){e.preventDefault();button.current?.focus()}}}><Icon size={38}/><h2 id="save-title">{notice.title}</h2><p id="save-proof">{notice.message}</p><button ref={button} className="btn btn-primary" onClick={onClose}>Continue entry</button></section></div>,document.body);
}
