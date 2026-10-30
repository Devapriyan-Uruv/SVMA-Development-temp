import type {ReactNode} from 'react';
import {AlertCircle, CheckCircle2, Info, TriangleAlert} from 'lucide-react';

type Tone='info'|'warning'|'critical'|'success';
const icons:Record<Tone,ReactNode>={info:<Info size={16}/>,warning:<TriangleAlert size={16}/>,critical:<AlertCircle size={16}/>,success:<CheckCircle2 size={16}/>};

export function AlertBanner({tone='info',title,children}:{tone?:Tone;title?:string;children:ReactNode}){
  return <div className={`alert-banner ${tone}`}>
    {icons[tone]}
    <div>{title?<b>{title}</b>:null}<span>{children}</span></div>
  </div>;
}
