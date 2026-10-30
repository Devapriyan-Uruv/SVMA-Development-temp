'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {PageHeader} from '@/components/PageHeader';
import {ProfilePopover} from '@/components/ProfilePopover';
import {Bell,CheckCheck,Clock3,Paperclip,Phone,Send,SmilePlus,UserPlus,Users,Video,X} from 'lucide-react';

const REACTION_EMOJI=['👍','❤️','😂','😮','😢','🙏','🎉','🔥'];
type Conversation={id:string;type:'direct'|'group';name:string;avatarUrl:string|null;online:boolean;lastSeenAt:string|null;memberCount:number;createdAt:string;lastMessage:{body:string|null;createdAt:string;senderName:string;attachmentName:string|null}|null;unreadCount:number};
type Reaction={emoji:string;count:number;reactedByMe:boolean;users:string[]};
type Message={id:string;body:string|null;createdAt:string;senderId:string;senderName:string;senderAvatarUrl:string|null;isMe:boolean;attachmentUrl:string|null;attachmentName:string|null;attachmentMime:string|null;attachmentSize:number|null;reactions:Reaction[]};
type Member={userId:string;name:string;avatarUrl?:string|null;role?:string|null;joinedAt:string;lastReadAt:string|null;isMe:boolean;online:boolean;lastSeenAt:string|null};
type Person={id:string;full_name:string;email:string};
type Reminder={id:string;message:string;remindAt:string;createdAt:string;createdByName:string};

function timeAgo(iso:string){const s=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000));if(s<60)return'just now';const m=Math.round(s/60);if(m<60)return`${m}m ago`;const h=Math.round(m/60);if(h<24)return`${h}h ago`;return`${Math.round(h/24)}d ago`}
function fileSize(n:number|null){if(!n)return'';if(n<1024)return`${n} B`;if(n<1048576)return`${(n/1024).toFixed(1)} KB`;return`${(n/1048576).toFixed(1)} MB`}
const JITSI_URL_RE=/https:\/\/meet\.jit\.si\/[A-Za-z0-9_-]+/;
function jitsiRoomIn(text:string|null):string|null{if(!text)return null;const m=text.match(JITSI_URL_RE);return m?m[0]:null}
function Avatar({name,url,size=32,online}:{name:string;url?:string|null;size?:number;online?:boolean}){
 return <span className="chat-avatar-holder" style={{width:size,height:size}}>
  {url?<img src={url} alt="" className="chat-avatar" style={{width:size,height:size}}/>:<span className="chat-avatar chat-avatar-fallback" style={{width:size,height:size,fontSize:size*0.42}}>{(name||'?').slice(0,1).toUpperCase()}</span>}
  {online?<span className="chat-online-dot" title="Online"/>:null}
 </span>;
}
// WhatsApp-style per-message receipt, computed from the same
// last_read_at the Members panel already shows — a message counts as seen
// by someone once their last_read_at reaches or passes this message's own
// timestamp, no separate "delivered to" tracking needed.
function seenLabel(m:Message,members:Member[]|null,convType:'direct'|'group'|undefined){
 if(!m.isMe||!members)return null;
 const others=members.filter(x=>!x.isMe);
 if(!others.length)return null;
 const seenBy=others.filter(x=>x.lastReadAt&&x.lastReadAt>=m.createdAt);
 if(convType==='direct')return seenBy.length?'Seen':'Sent';
 if(!seenBy.length)return'Sent';
 return seenBy.length===others.length?'Seen by all':`Seen by ${seenBy.length}/${others.length}`;
}

export default function ChatPage(){
 const [conversations,setConversations]=useState<Conversation[]>([]);
 const [activeId,setActiveId]=useState<string|null>(null);
 const [messages,setMessages]=useState<Message[]>([]);
 const [members,setMembers]=useState<Member[]|null>(null);
 const [showMembers,setShowMembers]=useState(false);
 const [showNew,setShowNew]=useState(false);
 const [directory,setDirectory]=useState<Person[]>([]);
 const [newType,setNewType]=useState<'direct'|'group'>('direct');
 const [newMemberIds,setNewMemberIds]=useState<string[]>([]);
 const [newGroupName,setNewGroupName]=useState('');
 const [addMemberIds,setAddMemberIds]=useState<string[]>([]);
 const [text,setText]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [myId,setMyId]=useState<string|null>(null);
 const [meetingRoom,setMeetingRoom]=useState<string|null>(null);
 const [meetingAudioOnly,setMeetingAudioOnly]=useState(false);
 const [showReminder,setShowReminder]=useState(false);
 const [reminderText,setReminderText]=useState('');
 const [reminderAt,setReminderAt]=useState('');
 const [reminders,setReminders]=useState<Reminder[]>([]);
 const [reactPickerFor,setReactPickerFor]=useState<string|null>(null);
 const [profileUserId,setProfileUserId]=useState<string|null>(null);
 const listRef=useRef<HTMLDivElement>(null);
 const latest=useRef<string|null>(null);
 const fileInput=useRef<HTMLInputElement>(null);
 const activeIdRef=useRef<string|null>(null);
 const sendingRef=useRef(false);
 useEffect(()=>{activeIdRef.current=activeId},[activeId]);

 useEffect(()=>{fetch('/api/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.user?.id)setMyId(j.user.id)}).catch(()=>{});fetch('/api/directory',{cache:'no-store'}).then(r=>r.json()).then(j=>setDirectory(j.profiles||[])).catch(()=>{})},[]);

 function loadConversations(){fetch('/api/chat/conversations',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setConversations(j.conversations)}).catch(()=>{})}
 // Reminders have no background worker — delivering a due reminder (as a
 // chat message + notification, see app/api/chat/reminders/sweep) piggybacks
 // on this same poll, same pattern as Quality's SLA sweep.
 useEffect(()=>{
  const tick=()=>{loadConversations();fetch('/api/chat/reminders/sweep',{method:'POST'}).then(r=>r.ok?r.json():null).then(j=>{if(j?.delivered&&activeIdRef.current)loadMessages(activeIdRef.current,false)}).catch(()=>{})};
  tick();const t=setInterval(tick,6000);return()=>clearInterval(t);
 },[]);
 function loadReminders(id:string){fetch(`/api/chat/conversations/${id}/reminders`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setReminders(j.reminders||[])}).catch(()=>{})}

 function loadMessages(id:string,initial=false){
  const url=initial||!latest.current?`/api/chat/conversations/${id}/messages`:`/api/chat/conversations/${id}/messages?after=${encodeURIComponent(latest.current)}`;
  fetch(url,{cache:'no-store'}).then(r=>r.json()).then(j=>{
   if(j.error)return;const incoming:Message[]=j.messages||[];if(!incoming.length)return;
   latest.current=incoming[incoming.length-1].createdAt;
   // Section: the manual reload right after send() and the background poll
   // can both land the same batch (each reads `latest.current` before the
   // other updates it) — de-dupe by id rather than trusting either call to
   // be exclusive, since a React state-based lock can't close that race.
   setMessages(x=>initial?incoming:(()=>{const seen=new Set(x.map(m=>m.id));const fresh=incoming.filter(m=>!seen.has(m.id));return fresh.length?[...x,...fresh]:x})());
  }).catch(()=>{});
 }
 useEffect(()=>{
  if(!activeId)return;
  setMessages([]);latest.current=null;setShowMembers(false);setReminders([]);
  loadMessages(activeId,true);
  loadReminders(activeId);
  fetch(`/api/chat/conversations/${activeId}`,{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.error)setMembers(j.members)}).catch(()=>{});
  fetch(`/api/chat/conversations/${activeId}/read`,{method:'POST'}).catch(()=>{});
  const t=setInterval(()=>{if(activeIdRef.current===activeId)loadMessages(activeId,false)},4000);
  return()=>clearInterval(t);
 },[activeId]);
 useEffect(()=>{listRef.current?.scrollTo(0,listRef.current.scrollHeight)},[messages]);

 const active=useMemo(()=>conversations.find(c=>c.id===activeId)||null,[conversations,activeId]);

 async function send(){
  // Section: `busy` state is not enough on its own — an Enter keydown and a
  // near-simultaneous click on the (not yet re-rendered) send button both
  // close over the same stale `busy=false` from one render, so both pass
  // this guard before React can disable the button. A ref is synchronous
  // and shared across both closures, so it actually closes the race.
  if((!text.trim()&&!file)||!activeId||sendingRef.current)return;
  sendingRef.current=true;setBusy(true);
  try{
   const fd=new FormData();if(text.trim())fd.append('body',text.trim());if(file)fd.append('file',file);
   const r=await fetch(`/api/chat/conversations/${activeId}/messages`,{method:'POST',body:fd});const j=await r.json();if(!r.ok)throw new Error(j.error);
   setText('');setFile(null);loadMessages(activeId,false);loadConversations();
   await fetch(`/api/chat/conversations/${activeId}/read`,{method:'POST'}).catch(()=>{});
  }catch(e){setError(e instanceof Error?e.message:'Unable to send message')}finally{sendingRef.current=false;setBusy(false)}
 }

 // Calls and video meetings share one mechanism: a room on the public,
 // no-account meet.jit.si — the fastest realistic path to real in-app
 // camera/audio without standing up our own signalling/media
 // infrastructure. A "call" is the same Jitsi room started with the camera
 // off (audioOnly), which is what actually makes it feel like a normal
 // phone call rather than a video meeting — either party can still turn
 // their camera on from Jitsi's own controls once inside. The room name is
 // posted as a normal chat message (so every member sees it, gets the
 // existing chat_message notification, and can tap it to join the same
 // room); opening it here — or from that message later — both just set
 // `meetingRoom`/`meetingAudioOnly`, which render the embedded iframe below.
 async function startJitsi(kind:'call'|'meeting'){
  if(!activeId)return;
  const room=`SVMA-${activeId.slice(0,8)}-${Date.now().toString(36)}`;
  const url=`https://meet.jit.si/${room}`;
  setMeetingRoom(room);setMeetingAudioOnly(kind==='call');
  try{
   const fd=new FormData();fd.append('body',kind==='call'?`📞 Call started: ${url}`:`📹 Video meeting started: ${url}`);
   await fetch(`/api/chat/conversations/${activeId}/messages`,{method:'POST',body:fd});
   loadMessages(activeId,false);loadConversations();
  }catch{/* the call/meeting still opens even if the announcement message fails to send */}
 }

 async function scheduleReminder(){
  if(!activeId||!reminderText.trim()||!reminderAt)return;
  setBusy(true);setError('');
  try{
   const r=await fetch(`/api/chat/conversations/${activeId}/reminders`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:reminderText.trim(),remindAt:new Date(reminderAt).toISOString()})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setReminderText('');setReminderAt('');setShowReminder(false);loadReminders(activeId);
  }catch(e){setError(e instanceof Error?e.message:'Unable to schedule reminder')}finally{setBusy(false)}
 }

 async function createConversation(){
  setError('');
  if(newType==='direct'&&!newMemberIds.length){setError('Choose a person to message.');return}
  if(newType==='group'&&(!newGroupName.trim()||!newMemberIds.length)){setError('Group name and at least one member are required.');return}
  setBusy(true);
  try{
   const r=await fetch('/api/chat/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:newType,memberIds:newMemberIds,name:newGroupName})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setShowNew(false);setNewMemberIds([]);setNewGroupName('');loadConversations();setActiveId(j.conversationId);
  }catch(e){setError(e instanceof Error?e.message:'Unable to start conversation')}finally{setBusy(false)}
 }

 async function react(messageId:string,emoji:string){
  setReactPickerFor(null);
  // Optimistic — the toggle is instant and near-always succeeds; a failed
  // request just gets corrected on the next poll rather than blocking the tap.
  try{
   const r=await fetch(`/api/chat/conversations/${activeId}/messages/${messageId}/react`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({emoji})});
   const j=await r.json();if(!r.ok)throw new Error(j.error);
   setMessages(x=>x.map(m=>m.id===messageId?{...m,reactions:j.reactions}:m));
  }catch{/* next poll will reconcile */}
 }
 async function addMembers(){
  if(!activeId||!addMemberIds.length)return;
  setBusy(true);
  try{const r=await fetch(`/api/chat/conversations/${activeId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({addMemberIds})}),j=await r.json();if(!r.ok)throw new Error(j.error);setAddMemberIds([]);fetch(`/api/chat/conversations/${activeId}`,{cache:'no-store'}).then(r2=>r2.json()).then(j2=>{if(!j2.error)setMembers(j2.members)});loadConversations()}
  catch(e){setError(e instanceof Error?e.message:'Unable to add members')}finally{setBusy(false)}
 }

 return <>
  <PageHeader title="Team Chat" subtitle="Direct messages, groups, and shared documents." backHref="/" backLabel="Home" action={<button className="btn btn-primary" onClick={()=>{setShowNew(true);setError('')}}><UserPlus size={16}/> New chat</button>}/>
  <div className="chat-module-grid">
   <aside className="chat-conv-list">
    {!conversations.length?<div className="empty" style={{padding:20}}>No conversations yet. Start one.</div>:conversations.map(c=><button key={c.id} className={`chat-conv-item ${activeId===c.id?'active':''}`} onClick={()=>setActiveId(c.id)}>
     <Avatar name={c.name} url={c.avatarUrl} size={38} online={c.type==='direct'&&c.online}/>
     <div className="chat-conv-body">
      <div className="chat-conv-top"><b>{c.type==='group'?<Users size={13} style={{verticalAlign:-2,marginRight:4}}/>:null}{c.name}</b>{c.lastMessage?<span>{timeAgo(c.lastMessage.createdAt)}</span>:null}</div>
      <div className="chat-conv-preview">{c.lastMessage?`${c.lastMessage.senderName}: ${c.lastMessage.body||c.lastMessage.attachmentName||'Sent an attachment'}`:'No messages yet'}</div>
     </div>
     {c.unreadCount>0?<span className="chat-conv-badge">{c.unreadCount>9?'9+':c.unreadCount}</span>:null}
    </button>)}
   </aside>
   <section className="chat-thread">
    {!active?<div className="empty" style={{margin:'auto'}}>Select a conversation, or start a new one.</div>:<>
     <div className="chat-thread-head">
      <div className="chat-thread-head-id" style={active.type==='direct'?{cursor:'pointer'}:undefined} onClick={()=>{if(active.type==='direct'){const other=members?.find(m=>!m.isMe);if(other)setProfileUserId(other.userId)}}}>
       <Avatar name={active.name} url={active.avatarUrl} size={30} online={active.type==='direct'&&active.online}/>
       <span><b>{active.name}</b>{active.type==='direct'?<small className="chat-presence-text">{members?.find(m=>!m.isMe)?.role?`${members.find(m=>!m.isMe)!.role!.replaceAll('_',' ')} • `:''}{active.online?'Online':active.lastSeenAt?`Last seen ${timeAgo(active.lastSeenAt)}`:''}</small>:null}</span>
      </div>
      <div className="chat-thread-head-actions">
       {reminders.length?<span className="chat-reminder-chip" title={reminders.map(r=>`${r.message} • ${new Date(r.remindAt).toLocaleString('en-IN')}`).join('\n')}><Bell size={13}/> {reminders.length}</span>:null}
       <button type="button" className="btn btn-outline" onClick={()=>setShowReminder(x=>!x)}><Clock3 size={14}/> Remind</button>
       {active.type==='direct'?<button type="button" className="btn btn-outline" onClick={()=>startJitsi('call')}><Phone size={14}/> Call</button>:null}
       <button type="button" className="btn btn-outline" onClick={()=>startJitsi('meeting')}><Video size={14}/> Start meeting</button>
       <button type="button" className="btn btn-outline" onClick={()=>setShowMembers(x=>!x)}><Users size={14}/> {active.memberCount} member{active.memberCount===1?'':'s'}</button>
      </div>
     </div>
     {showReminder?<div className="chat-reminder-form">
      <input value={reminderText} onChange={e=>setReminderText(e.target.value)} placeholder="Remind this chat about…" maxLength={500}/>
      <input type="datetime-local" value={reminderAt} onChange={e=>setReminderAt(e.target.value)} min={new Date(Date.now()+60000).toISOString().slice(0,16)}/>
      <button type="button" className="btn btn-primary" disabled={busy||!reminderText.trim()||!reminderAt} onClick={scheduleReminder}>Schedule</button>
      <button type="button" className="btn btn-outline" onClick={()=>setShowReminder(false)}>Cancel</button>
     </div>:null}
     <div className="chat-thread-list" ref={listRef}>
      {messages.map(m=>{const room=jitsiRoomIn(m.body),isCall=m.body?.startsWith('📞'),seen=seenLabel(m,members,active?.type);const senderRole=members?.find(x=>x.userId===m.senderId)?.role;return <div key={m.id} className={`chat-bubble-row ${m.isMe?'me':''}`}>
       {!m.isMe?<span style={{cursor:'pointer'}} onClick={()=>setProfileUserId(m.senderId)}><Avatar name={m.senderName} url={m.senderAvatarUrl} size={26}/></span>:null}
       <div className="chat-bubble-wrap">
        <div className="chat-bubble">
         {!m.isMe?<b style={{cursor:'pointer'}} onClick={()=>setProfileUserId(m.senderId)}>{m.senderName}{senderRole?<span className="pill neutral" style={{marginLeft:6,fontWeight:700}}>{senderRole.replaceAll('_',' ')}</span>:null}</b>:null}
         {m.body?<span>{room?m.body.replace(JITSI_URL_RE,'').trim()||(isCall?'Call':'Video meeting'):m.body}</span>:null}
         {room?<button type="button" className="chat-join-meeting" onClick={()=>{setMeetingAudioOnly(!!isCall);setMeetingRoom(room.split('/').pop()||null)}}>{isCall?<Phone size={14}/>:<Video size={14}/>} Join {isCall?'call':'meeting'}</button>:null}
         {m.attachmentUrl&&m.attachmentMime?.startsWith('image/')?<a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="chat-image-attachment"><img src={m.attachmentUrl} alt={m.attachmentName||'Shared image'}/></a>
          :m.attachmentUrl?<a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="chat-attachment"><Paperclip size={13}/> {m.attachmentName} {m.attachmentSize?<small>({fileSize(m.attachmentSize)})</small>:null}</a>:null}
         <button type="button" className="chat-react-trigger" onClick={()=>setReactPickerFor(x=>x===m.id?null:m.id)} aria-label="React"><SmilePlus size={13}/></button>
         {reactPickerFor===m.id?<div className="chat-react-picker">{REACTION_EMOJI.map(em=><button type="button" key={em} onClick={()=>react(m.id,em)}>{em}</button>)}</div>:null}
         <div className="chat-bubble-foot"><small>{timeAgo(m.createdAt)}</small>{seen?<small className="chat-seen"><CheckCheck size={11}/> {seen}</small>:null}</div>
        </div>
        {m.reactions.length?<div className="chat-reactions">{m.reactions.map(r=><button type="button" key={r.emoji} className={`chat-reaction-pill ${r.reactedByMe?'mine':''}`} title={r.users.join(', ')} onClick={()=>react(m.id,r.emoji)}>{r.emoji} {r.count}</button>)}</div>:null}
       </div>
      </div>})}
     </div>
     {error?<div className="notice danger" style={{margin:'0 14px 10px'}}>{error}</div>:null}
     <div className="chat-thread-input">
      {file?<div className="chat-pending-file"><Paperclip size={13}/> {file.name}<button type="button" onClick={()=>setFile(null)}><X size={13}/></button></div>:null}
      <div style={{display:'flex',gap:8}}>
       <button type="button" className="btn btn-outline" onClick={()=>fileInput.current?.click()} aria-label="Attach file or photo"><Paperclip size={15}/></button>
       <input ref={fileInput} type="file" accept="*/*" style={{display:'none'}} onChange={e=>setFile(e.target.files?.[0]||null)}/>
       <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Write a message…" style={{flex:1}} disabled={busy}/>
       <button type="button" className="btn btn-primary" onClick={send} disabled={busy||(!text.trim()&&!file)}><Send size={15}/></button>
      </div>
     </div>
    </>}
   </section>
   {showMembers&&active?<aside className="chat-members-panel">
    <div className="chat-thread-head"><b>Members</b><button type="button" onClick={()=>setShowMembers(false)}><X size={16}/></button></div>
    <div style={{padding:14,overflowY:'auto',flex:1}}>
     {members?.map(m=><div key={m.userId} className="chat-member-row" style={m.isMe?undefined:{cursor:'pointer'}} onClick={()=>{if(!m.isMe)setProfileUserId(m.userId)}}><Avatar name={m.name} url={m.avatarUrl} size={30} online={m.online}/><span><b>{m.name}{m.isMe?' (you)':''}{m.role?<span className="pill neutral" style={{marginLeft:6,fontWeight:700}}>{m.role.replaceAll('_',' ')}</span>:null}</b><span className="sub">{m.online?'Online':m.lastSeenAt?`Last seen ${timeAgo(m.lastSeenAt)}`:'Offline'} • {m.lastReadAt?`Seen ${timeAgo(m.lastReadAt)}`:'Not read yet'}</span></span></div>)}
     {active.type==='group'?<div style={{marginTop:16}}>
      <div className="section-title" style={{fontSize:13}}>Add member</div>
      <select multiple value={addMemberIds} onChange={e=>setAddMemberIds(Array.from(e.target.selectedOptions).map(o=>o.value))} style={{width:'100%',minHeight:90}}>
       {directory.filter(p=>!members?.some(m=>m.userId===p.id)).map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}
      </select>
      <button className="btn btn-primary" style={{marginTop:8}} disabled={!addMemberIds.length||busy} onClick={addMembers}>Add</button>
     </div>:null}
    </div>
   </aside>:null}
  </div>

  {showNew?<div className="mobile-nav-backdrop" style={{display:'block'}} onClick={()=>setShowNew(false)}>
   <div className="chat-new-modal" onClick={e=>e.stopPropagation()}>
    <div className="chat-thread-head"><b>New chat</b><button type="button" onClick={()=>setShowNew(false)}><X size={16}/></button></div>
    <div style={{padding:16}}>
     {error?<div className="notice danger" style={{marginBottom:12}}>{error}</div>:null}
     <div className="tabs"><button className={`tab ${newType==='direct'?'active':''}`} onClick={()=>{setNewType('direct');setNewMemberIds([])}}>Direct message</button><button className={`tab ${newType==='group'?'active':''}`} onClick={()=>{setNewType('group');setNewMemberIds([])}}>Group</button></div>
     {newType==='group'?<div className="field" style={{marginTop:10}}><label>Group name</label><input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)}/></div>:null}
     <div className="field" style={{marginTop:10}}>
      <label>{newType==='direct'?'Person':'Members'}</label>
      {newType==='direct'?<select value={newMemberIds[0]||''} onChange={e=>setNewMemberIds(e.target.value?[e.target.value]:[])}><option value="">Select a person</option>{directory.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select>
       :<select multiple value={newMemberIds} onChange={e=>setNewMemberIds(Array.from(e.target.selectedOptions).map(o=>o.value))} style={{width:'100%',minHeight:120}}>{directory.map(p=><option key={p.id} value={p.id}>{p.full_name||p.email}</option>)}</select>}
     </div>
     <button className="btn btn-primary" style={{marginTop:14}} disabled={busy} onClick={createConversation}>{busy?'Starting…':'Start chat'}</button>
    </div>
   </div>
  </div>:null}

  {meetingRoom?<div className="chat-meeting-overlay">
   <div className="chat-meeting-head"><b>{meetingAudioOnly?<Phone size={15}/>:<Video size={15}/>} {active?.name||(meetingAudioOnly?'Call':'Meeting')}</b><button type="button" className="btn btn-outline" onClick={()=>setMeetingRoom(null)}><X size={14}/> Leave</button></div>
   <iframe title={meetingAudioOnly?'Call':'Video meeting'} src={`https://meet.jit.si/${meetingRoom}#config.startWithVideoMuted=${meetingAudioOnly}`} allow="camera; microphone; display-capture; fullscreen; autoplay" className="chat-meeting-frame"/>
  </div>:null}

  <ProfilePopover userId={profileUserId} onClose={()=>setProfileUserId(null)}/>
 </>;
}
