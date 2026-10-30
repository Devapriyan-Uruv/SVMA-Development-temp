// Section K: sound + vibration for WARNING/CRITICAL alerts, synthesised in
// the browser (no external audio asset, no network dependency). Browsers
// block audio until a user gesture, so callers must first invoke
// unlockAlertSound() from a click handler (the "Enable Operational Alert
// Sound" control) before playAlertSound() can actually produce sound; if it
// can't play, the caller must still show the visual notification.

let ctx:AudioContext|null=null;
let unlocked=false;

export function unlockAlertSound(){
 try{
  const Ctx=(window as any).AudioContext||(window as any).webkitAudioContext;
  if(!Ctx)return false;
  if(!ctx)ctx=new Ctx();
  const audio:AudioContext=ctx!;
  if(audio.state==='suspended')void audio.resume();
  unlocked=true;
  return true;
 }catch{return false}
}

export function isAlertSoundUnlocked(){return unlocked}

export function playAlertSound(severity:'warning'|'critical'){
 try{
  if(localStorage.getItem('svma-alert-sound-enabled')==='0')return false;
  const audio=ctx;
  if(!audio||!unlocked)return false;
  const now=audio.currentTime;
  const beeps=severity==='critical'?3:1;
  for(let i=0;i<beeps;i++){
   const osc=audio.createOscillator(),gain=audio.createGain();
   osc.type='sine';
   osc.frequency.value=severity==='critical'?880:660;
   const start=now+i*0.32;
   gain.gain.setValueAtTime(0.0001,start);
   gain.gain.exponentialRampToValueAtTime(0.22,start+0.02);
   gain.gain.exponentialRampToValueAtTime(0.0001,start+0.22);
   osc.connect(gain);gain.connect(audio.destination);
   osc.start(start);osc.stop(start+0.24);
  }
  return true;
 }catch{return false}
}

export function vibrateAlert(severity:'warning'|'critical'){
 try{
  if(typeof navigator==='undefined'||!navigator.vibrate)return false;
  return navigator.vibrate(severity==='critical'?[180,80,180,80,180]:[120]);
 }catch{return false}
}
