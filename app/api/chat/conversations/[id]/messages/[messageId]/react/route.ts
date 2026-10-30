import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {errorMessage,logServerError} from '@/lib/errors';

// A curated set rather than a free-for-all emoji picker — matches how
// Slack/Teams keep the reaction bar small and fast to tap, not a full
// keyboard emoji grid.
export const REACTION_EMOJI=['👍','❤️','😂','😮','😢','🙏','🎉','🔥'];

async function assertMember(db:ReturnType<typeof supabaseAdmin>,conversationId:string,userId:string){
 const {data}=await db.from('chat_conversation_members').select('user_id').eq('conversation_id',conversationId).eq('user_id',userId).maybeSingle();
 return !!data;
}

// Toggle: reacting again with the same emoji removes it — the standard
// tap-to-toggle behaviour every chat app uses for reactions.
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string;messageId:string}>}){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const {id,messageId}=await params,db=supabaseAdmin();
 if(!(await assertMember(db,id,user.id)))return NextResponse.json({error:'Not a member of this conversation'},{status:403});
 const b=await req.json(),emoji=String(b.emoji||'');
 if(!REACTION_EMOJI.includes(emoji))return NextResponse.json({error:'Unsupported reaction.'},{status:400});
 const {data:msg}=await db.from('chat_messages').select('id').eq('id',messageId).eq('conversation_id',id).maybeSingle();
 if(!msg)return NextResponse.json({error:'Message not found in this conversation.'},{status:404});
 const {data:existing}=await db.from('chat_message_reactions').select('emoji').eq('message_id',messageId).eq('user_id',user.id).eq('emoji',emoji).maybeSingle();
 if(existing){await db.from('chat_message_reactions').delete().eq('message_id',messageId).eq('user_id',user.id).eq('emoji',emoji)}
 else{await db.from('chat_message_reactions').insert({message_id:messageId,user_id:user.id,emoji})}
 const {data:all}=await db.from('chat_message_reactions').select('emoji,user_id,profiles(full_name,email)').eq('message_id',messageId);
 type Grouped={emoji:string;count:number;reactedByMe:boolean;users:string[]};
 const grouped=new Map<string,Grouped>();
 for(const r of all||[]){
  const g:Grouped=grouped.get(r.emoji)||{emoji:r.emoji,count:0,reactedByMe:false,users:[]};
  g.count++;if(r.user_id===user.id)g.reactedByMe=true;g.users.push((r as any).profiles?.full_name||(r as any).profiles?.email||'Someone');
  grouped.set(r.emoji,g);
 }
 return NextResponse.json({reactions:Array.from(grouped.values())});
}catch(e){logServerError('chat/react',e);return NextResponse.json({error:errorMessage(e,'Unable to react to message')},{status:500})}}
