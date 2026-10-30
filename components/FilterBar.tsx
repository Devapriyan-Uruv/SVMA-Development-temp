import type {ReactNode} from 'react';
import {Search} from 'lucide-react';

export function FilterBar({children,search,onSearch,searchPlaceholder}:{children?:ReactNode;search?:string;onSearch?:(v:string)=>void;searchPlaceholder?:string}){
  return <div className="filter-bar">
    {onSearch?<div className="search-field"><Search size={14}/><input value={search||''} onChange={e=>onSearch(e.target.value)} placeholder={searchPlaceholder||'Search…'}/></div>:null}
    <div className="filter-group">{children}</div>
  </div>;
}
