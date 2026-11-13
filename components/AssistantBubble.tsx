'use client';
import {useEffect,useRef,useState} from 'react';
import {Bot,Send,X} from 'lucide-react';

type Turn={role:'user'|'assistant';text:string};
const SUGGESTIONS=['What needs my attention?','What is critical right now?','How many approvals do I have?'];

// A role-scoped assistant, not a generic chatbot — every answer is built
// server-side from facts already filtered to this user's own module access
// (see app/api/assistant), so a Solvent-only account can never see Quality
// or Finance numbers here, by construction rather than by prompt wording.
export function AssistantBubble(){
 const [open,setOpen]=useState(false);
 const [turns,setTurns]=useState<Turn[]>([]);
 const [text,setText]=useState('');
 const [busy,setBusy]=useState(false);
 const listRef=useRef<HTMLDivElement>(null);

 useEffect(()=>{if(open)listRef.current?.scrollTo(0,listRef.current.scrollHeight)},[turns,open]);

 async function ask(question:string){
  if(!question.trim()||busy)return;
  setBusy(true);setText('');
  setTurns(x=>[...x,{role:'user',text:question}]);
  try{
   const r=await fetch('/api/assistant',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question})}),j=await r.json();
   if(!r.ok)throw new Error(j.error);
   setTurns(x=>[...x,{role:'assistant',text:j.answer}]);
  }catch(e){setTurns(x=>[...x,{role:'assistant',text:e instanceof Error?e.message:'Unable to answer right now.'}])}
  finally{setBusy(false)}
 }
 // The Home "Ask Uruvan" bar (and anything else) can open the assistant, optionally with a question, by dispatching: window.dispatchEvent(new CustomEvent('svma-assistant',{detail:{question}})).
 const askRef=useRef(ask);askRef.current=ask;
 useEffect(()=>{const h=(e:Event)=>{const q=String((e as CustomEvent).detail?.question||'').trim();setOpen(true);if(q)void askRef.current(q)};window.addEventListener('svma-assistant',h);return()=>window.removeEventListener('svma-assistant',h)},[]);

 return <div className="assistant-bubble-wrap">
  {open?<div className="assistant-panel">
   <div className="assistant-panel-head"><span><Bot size={15}/> URUVAN</span><button type="button" onClick={()=>setOpen(false)} aria-label="Close AIX3"><X size={16}/></button></div>
   <div className="assistant-panel-body" ref={listRef}>
    {!turns.length?<div className="assistant-empty">
     <p>Ask Uruvan about what needs your attention today — scoped to what you can see.</p>
     <div className="assistant-suggestions">{SUGGESTIONS.map(s=><button type="button" key={s} onClick={()=>ask(s)}>{s}</button>)}</div>
    </div>:turns.map((t,i)=><div key={i} className={`assistant-turn ${t.role}`}>{t.text}</div>)}
    {busy?<div className="assistant-turn assistant thinking">Thinking…</div>:null}
   </div>
   <div className="assistant-panel-input">
    <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask(text)}}} placeholder="Ask Uruvan..." disabled={busy}/>
    <button type="button" onClick={()=>ask(text)} disabled={busy||!text.trim()} aria-label="Ask"><Send size={14}/></button>
   </div>
  </div>:null}
  <button type="button" className="assistant-launcher" onClick={() => setOpen(x => !x)} aria-label="Open URUVAN AI"><img src="/uruvan-ai-icon.png" alt="URUVAN AI" className="assistant-launcher-image" /></button>
 </div>;
}
