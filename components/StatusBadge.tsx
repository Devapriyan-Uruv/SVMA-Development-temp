const toneMap:Record<string,string>={
  normal:'ok',ok:'ok',reconciled:'ok',found:'ok',active:'ok',closed:'ok',resolved:'ok',
  warning:'warn',warn:'warn','short paid':'warn','excess paid':'warn','vendor review':'warn',
  critical:'danger',danger:'danger','not found':'danger',overdue:'danger',disabled:'danger',
  info:'info','not verified':'info',
  neutral:'neutral','not paid':'neutral',pending:'neutral',open:'neutral',
};

export function statusTone(status:string):string{
  return toneMap[String(status||'').toLowerCase()]||'neutral';
}

export function StatusBadge({status,label}:{status:string;label?:string}){
  const tone=statusTone(status);
  return <span className={`status-badge ${tone}`}><i/>{label||String(status).replaceAll('_',' ').toUpperCase()}</span>;
}
