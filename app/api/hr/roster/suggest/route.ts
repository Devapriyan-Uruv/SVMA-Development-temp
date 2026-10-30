import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {HR_ROLES} from '@/lib/authorize';
import {getOpenAI,OPENAI_MODEL} from '@/lib/openai';
import {errorMessage,logServerError} from '@/lib/errors';

async function isHr(db:ReturnType<typeof supabaseAdmin>,userId:string){
 const {data}=await db.from('user_roles').select('role').eq('user_id',userId);
 return (data||[]).some((r:any)=>HR_ROLES.includes(String(r.role)));
}
function dateRange(from:string,to:string){
 const out:string[]=[],a=new Date(from+'T00:00:00Z'),b=new Date(to+'T00:00:00Z');
 for(let d=a;d.getTime()<=b.getTime();d=new Date(d.getTime()+86400000))out.push(d.toISOString().slice(0,10));
 return out.slice(0,31); // hard cap — a month at a time, never an unbounded range
}
// No-AI-configured fallback: deterministic round-robin through the eligible
// pool per department/shift, so this feature degrades to *something usable*
// rather than an error — matching the same "deterministic remains active"
// philosophy already used for AI Insight elsewhere in the app (see
// app/api/reports/route.ts's deterministicBase).
function roundRobinSuggest(dates:string[],departments:any[],shifts:any[],employeesByDept:Map<number,any[]>){
 const suggestions:any[]=[];
 const cursor=new Map<string,number>();
 for(const date of dates)for(const dept of departments)for(const shift of shifts){
  const pool=employeesByDept.get(dept.id)||[];if(!pool.length)continue;
  const key=`${dept.id}:${shift.id}`,i=cursor.get(key)||0;
  suggestions.push({profileId:pool[i%pool.length].id,departmentId:dept.id,shiftId:shift.id,date});
  cursor.set(key,i+1);
 }
 return suggestions;
}

// AI-assisted roster suggestions across one or more departments/plants at
// once (so the same person can't be double-booked across e.g. Solvent and
// Refinery on the same day). This only ever *proposes* a roster — nothing
// is saved here; the HR console reviews the list and saves accepted rows
// through the existing POST /api/hr/roster, one at a time, exactly like a
// manual entry would.
export async function POST(req:NextRequest){try{
 const user=await currentUser();if(!user)return NextResponse.json({error:'Not authenticated'},{status:401});
 const db=supabaseAdmin();
 if(!(await isHr(db,user.id)))return NextResponse.json({error:'HR or Admin access is required'},{status:403});
 const b=await req.json();
 const departmentIds=(Array.isArray(b.departmentIds)?b.departmentIds:[]).map(Number).filter(Boolean);
 const shiftIds=(Array.isArray(b.shiftIds)?b.shiftIds:[]).map(Number).filter(Boolean);
 const fromDate=String(b.fromDate||''),toDate=String(b.toDate||'');
 if(!departmentIds.length||!shiftIds.length||!fromDate||!toDate)return NextResponse.json({error:'Pick at least one department, one shift, and a date range.'},{status:400});
 const dates=dateRange(fromDate,toDate);
 if(!dates.length)return NextResponse.json({error:'End date must be on or after the start date.'},{status:400});

 const [{data:departments},{data:shifts},{data:employees},{data:existing}]=await Promise.all([
  db.from('department_master').select('id,name').in('id',departmentIds),
  db.from('shift_master').select('id,name,start_time,end_time').in('id',shiftIds),
  db.from('profiles').select('id,full_name,email,department_id').in('department_id',departmentIds).eq('is_active',true),
  db.from('staff_shift_roster').select('profile_id,department_id,shift_id,roster_date').in('department_id',departmentIds).gte('roster_date',fromDate).lte('roster_date',toDate),
 ]);
 if(!departments?.length)return NextResponse.json({error:'Selected departments were not found.'},{status:400});
 if(!shifts?.length)return NextResponse.json({error:'Selected shifts were not found.'},{status:400});
 if(!employees?.length)return NextResponse.json({error:'No active employees are assigned to the selected department(s) yet — set their department in the Employees tab first.'},{status:400});

 const employeesByDept=new Map<number,any[]>();
 for(const e of employees){if(!employeesByDept.has(e.department_id))employeesByDept.set(e.department_id,[]);employeesByDept.get(e.department_id)!.push(e)}
 const validProfileIds=new Set(employees.map((e:any)=>e.id)),validDeptIds=new Set(departments.map((d:any)=>d.id)),validShiftIds=new Set(shifts.map((s:any)=>s.id)),validDates=new Set(dates);

 let suggestions:{profileId:string;departmentId:number;shiftId:number;date:string}[]=[];
 if(process.env.OPENAI_API_KEY){
  try{
   const compact={
    departments:departments.map((d:any)=>({id:d.id,name:d.name})),
    shifts:shifts.map((s:any)=>({id:s.id,name:s.name,start:s.start_time,end:s.end_time})),
    dates,
    employees:employees.map((e:any)=>({id:e.id,name:e.full_name||e.email,departmentId:e.department_id})),
    alreadyScheduled:(existing||[]).map((r:any)=>({profileId:r.profile_id,departmentId:r.department_id,shiftId:r.shift_id,date:r.roster_date})),
   };
   const prompt=`You are scheduling staff shifts for a plant operations team across one or more departments. Propose a roster covering EVERY combination of date × department × shift given, choosing one employee id from that department's own employee list for each. Rules: never assign the same employee to two different (department,shift) slots on the same date; rotate fairly across the given date range rather than repeating the same person every day; never suggest an employee id, department id or shift id that isn't in the supplied lists; respect alreadyScheduled — do not re-suggest a slot that's already filled there, and do not double-book someone who is already scheduled elsewhere that date. Return ONLY JSON: {"suggestions":[{"profileId":"...","departmentId":123,"shiftId":45,"date":"YYYY-MM-DD"}]}. Context: ${JSON.stringify(compact)}`;
   const client=getOpenAI('HR Roster Suggestions');
   const response=await client.responses.create({model:OPENAI_MODEL,input:prompt},{timeout:50000,maxRetries:1});
   const parsed=JSON.parse(response.output_text.replace(/^```json\s*|```$/g,'').trim());
   suggestions=(Array.isArray(parsed?.suggestions)?parsed.suggestions:[]).filter((s:any)=>validProfileIds.has(String(s.profileId))&&validDeptIds.has(Number(s.departmentId))&&validShiftIds.has(Number(s.shiftId))&&validDates.has(String(s.date)));
  }catch{suggestions=[]}
 }
 if(!suggestions.length)suggestions=roundRobinSuggest(dates,departments,shifts,employeesByDept);

 const existingKeys=new Set((existing||[]).map((r:any)=>`${r.profile_id}|${r.department_id}|${r.shift_id}|${r.roster_date}`));
 suggestions=suggestions.filter(s=>!existingKeys.has(`${s.profileId}|${s.departmentId}|${s.shiftId}|${s.date}`));
 const nameOf=(id:string)=>employees.find((e:any)=>e.id===id)?.full_name||employees.find((e:any)=>e.id===id)?.email||id;
 const deptOf=(id:number)=>departments.find((d:any)=>d.id===id)?.name||id;
 const shiftOf=(id:number)=>shifts.find((s:any)=>s.id===id)?.name||id;
 return NextResponse.json({
  suggestions:suggestions.map(s=>({...s,employeeName:nameOf(s.profileId),departmentName:deptOf(s.departmentId),shiftName:shiftOf(s.shiftId)})),
  aiUsed:!!process.env.OPENAI_API_KEY,
 });
}catch(e){logServerError('hr/roster/suggest',e);return NextResponse.json({error:errorMessage(e,'Unable to generate roster suggestions')},{status:500})}}
