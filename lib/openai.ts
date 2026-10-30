import OpenAI from 'openai';
import { recordAiUsage } from '@/lib/aiUsage';

/** `feature` names what the call is for; it is what the URUV credits dashboard
 * groups usage by. Every request made through the returned client is metered. */
export function getOpenAI(feature = 'general'){
 const key=process.env.OPENAI_API_KEY;
 if(!key) throw new Error('OPENAI_API_KEY missing');
 const client=new OpenAI({apiKey:key});
 const responses:any=client.responses,original=responses.create.bind(responses);
 responses.create=async(body:any,opts?:any)=>{
  const started=Date.now(),res=await original(body,opts);
  await recordAiUsage({feature,model:String(res?.model||body?.model||OPENAI_MODEL),usage:res?.usage,ms:Date.now()-started});
  return res;
 };
 return client;
}
export const OPENAI_MODEL=process.env.OPENAI_MODEL||'gpt-5-mini';
