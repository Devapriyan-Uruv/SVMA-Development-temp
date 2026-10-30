import {NextRequest,NextResponse} from 'next/server';
import {runPushSweep} from '@/lib/pushSweep';
import {errorMessage,logServerError} from '@/lib/errors';

// Kept as a manual/secret-gated trigger (a one-off catch-up sweep, or a
// way to test) — the background loop in instrumentation.ts is what runs
// this on a schedule now, so nothing external needs to call this route in
// normal operation.
export async function POST(req:NextRequest){try{
 const secret=process.env.PUSH_SWEEP_SECRET;
 if(!secret||req.headers.get('x-sweep-secret')!==secret)return NextResponse.json({error:'Unauthorized'},{status:401});
 const result=await runPushSweep();
 return NextResponse.json(result);
}catch(e){logServerError('push/sweep',e);return NextResponse.json({error:errorMessage(e,'Sweep failed')},{status:500})}}
