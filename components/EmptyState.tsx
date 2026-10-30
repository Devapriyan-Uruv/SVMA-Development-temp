import type {ReactNode} from 'react';
import {Inbox} from 'lucide-react';

export function EmptyState({icon,title,description,action}:{icon?:ReactNode;title:string;description?:string;action?:ReactNode}){
  return <div className="empty-state">
    <span className="empty-icon">{icon||<Inbox size={20}/>}</span>
    <b>{title}</b>
    {description?<span>{description}</span>:null}
    {action}
  </div>;
}
