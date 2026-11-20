import { nanoid } from "nanoid";
import { z } from "zod";
import { data } from "./store";
import { run, select } from "./db";
import { addDays, dateOnly, requireWorkspace } from "./templates";
import type { Id } from "./types";

type Workspace = Id<"workspaces">;
type State = "active" | "paused" | "archived";
type Mode = "increment" | "absolute";
export interface HabitDoc { _id:string; workspaceId:string; areaId:string|null; title:string; unit:string; dailyTarget:number; daysPerWeek:number; timezone:string; state:State; goalIds:string[]; createdAt:number; updatedAt:number }
export interface HabitVersionDoc { _id:string; workspaceId:string; habitId:string; effectiveDate:string; dailyTarget:number; daysPerWeek:number; unit:string; timezone:string; state:State; createdAt:number }
export interface GoalDoc { _id:string; workspaceId:string; areaId:string|null; title:string; unit:string; target:number; startDate:string; endDate:string|null; state:State; createdAt:number; updatedAt:number }
export interface GoalVersionDoc { _id:string; workspaceId:string; goalId:string; target:number; startDate:string; endDate:string|null; state:State; createdAt:number }
export interface ActivityDoc { _id:string; workspaceId:string; habitId:string|null; itemId:string|null; unit:string; value:number; mode:Mode; date:string; note:string; habitTarget:number|null; habitDaysPerWeek:number|null; goalIds:string[]; voided:boolean; createdAt:number; updatedAt:number }
export interface HabitDayMarkDoc { _id:string; workspaceId:string; habitId:string; date:string; status:"rest"|"skip"; createdAt:number; updatedAt:number }
export interface HabitGoalLinkDoc { _id:string; workspaceId:string; habitId:string; goalId:string }
export interface ActivityGoalLinkDoc { _id:string; workspaceId:string; activityId:string; goalId:string }
export interface HabitTargetEvent { workspaceId:string; kind:"habit_target_met"|"goal_target_reached"; entityId:string; title:string; date:string; activityId:string; itemId:string|null; value:number; target:number }
type Scope = { workspaceId:Workspace };
const short = z.string().trim().min(1).max(160);
const unitSchema = z.string().trim().min(1).max(32).transform(s => s.toLowerCase());
const stateSchema = z.enum(["active","paused","archived"]);
const numberSchema = z.number().finite().min(0).max(1000000000);
const localDate = (zone:string, now=Date.now()) => {
  const p = new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  return `${p.find(x=>x.type==="year")!.value}-${p.find(x=>x.type==="month")!.value}-${p.find(x=>x.type==="day")!.value}`;
};
const round = (n:number) => Math.round((n+Number.EPSILON)*1000000)/1000000;
function validateArea(workspaceId:string, areaId:string|null) {
  if (areaId && !data.areas.some(a=>a._id===areaId&&a.workspaceId===workspaceId&&!a.archived)) throw new Error("Choose an active Area in this Workspace.");
}
function habitIn(workspaceId:string,id:string) {
  const habit=data.habits.find(h=>h.workspaceId===workspaceId&&h._id===id);
  if(!habit) throw new Error("Habit not found in this Workspace."); return habit;
}
function goalIn(workspaceId:string,id:string) {
  const goal=data.goals.find(g=>g.workspaceId===workspaceId&&g._id===id);
  if(!goal) throw new Error("Goal not found in this Workspace."); return goal;
}
function activityIn(workspaceId:string,id:string) {
  const entry=data.activities.find(a=>a.workspaceId===workspaceId&&a._id===id);
  if(!entry) throw new Error("Activity not found in this Workspace."); return entry;
}
function versionFor(habit:HabitDoc,date:string):HabitVersionDoc|undefined {
  const versions=data.habitVersions.filter(v=>v.workspaceId===habit.workspaceId&&v.habitId===habit._id).toSorted((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.createdAt-b.createdAt||a._id.localeCompare(b._id));
  // Explicit backfill: the first saved definition also describes earlier logged dates.
  return versions.filter(v=>v.effectiveDate<=date).at(-1) ?? versions[0];
}
function ordered(entries:ActivityDoc[]) { return entries.toSorted((a,b)=>a.date.localeCompare(b.date)||a.createdAt-b.createdAt||a._id.localeCompare(b._id)); }
function sum(entries:ActivityDoc[]) { let n=0; for(const e of ordered(entries.filter(e=>!e.voided))) n=e.mode==="absolute"?e.value:round(n+e.value); return n; }
function weekStart(date:string) { const day=new Date(date+"T12:00:00Z").getUTCDay(); return addDays(date,-((day+6)%7)); }
export function listHabits(args:{workspaceId:string}) { return data.habits.filter(h=>h.workspaceId===args.workspaceId); }
export function listGoals(args:{workspaceId:string}) { return data.goals.filter(g=>g.workspaceId===args.workspaceId); }
export function listActivities(args:{workspaceId:string}) { return data.activities.filter(a=>a.workspaceId===args.workspaceId).toSorted((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt); }
export function habitDetails(args:Scope&{habitId:string;date?:string}) {
  requireWorkspace(args.workspaceId); const habit=habitIn(args.workspaceId,args.habitId); const date=dateOnly(args.date??localDate(habit.timezone));
  const entries=data.activities.filter(e=>e.workspaceId===args.workspaceId&&e.habitId===habit._id);
  const days=Array.from({length:7},(_,i)=>addDays(weekStart(date),i)).filter(d=>d<=date);
  const firstWeekEntry=ordered(entries.filter(e=>!e.voided&&e.date>=weekStart(date)&&e.date<=date))[0];
  const weekTarget=firstWeekEntry?.habitDaysPerWeek??versionFor(habit,date)?.daysPerWeek??habit.daysPerWeek;
  const dayStats=(day:string)=>{ const dayEntries=ordered(entries.filter(e=>e.date===day&&!e.voided)); const value=sum(dayEntries); const target=dayEntries[0]?.habitTarget??versionFor(habit,day)?.dailyTarget??habit.dailyTarget; return {value,target,met:value>=target&&dayEntries.length>0}; };
  const today=dayStats(date); const mark=data.habitDayMarks.find(m=>m.workspaceId===args.workspaceId&&m.habitId===habit._id&&m.date===date);
  const todayStatus=versionFor(habit,date)?.state==="paused"?"paused":mark?.status==="rest"?"rest":mark?.status==="skip"?"skipped":today.met?"done":today.value>0?"partial":"unlogged";
  return {habit,todayValue:today.value,todayTarget:today.target,todayMet:today.met,todayStatus,weekDaysMet:days.filter(d=>dayStats(d).met).length,weekTarget,entries:ordered(entries).reverse()};
}
export function goalDetails(args:Scope&{goalId:string;asOfDate?:string}) {
  requireWorkspace(args.workspaceId); const goal=goalIn(args.workspaceId,args.goalId);
  const asOfDate=args.asOfDate?dateOnly(args.asOfDate):undefined;
  const versions=data.goalVersions.filter(v=>v.workspaceId===args.workspaceId&&v.goalId===goal._id).toSorted((a,b)=>a.createdAt-b.createdAt||a._id.localeCompare(b._id));
  const version=asOfDate?(versions.filter(v=>localDate(Intl.DateTimeFormat().resolvedOptions().timeZone,v.createdAt)<=asOfDate).at(-1)??versions[0]):versions.at(-1);
  const snapshot=version?{...goal,target:version.target,startDate:version.startDate,endDate:version.endDate,state:version.state}:goal;
  const entries=data.activities.filter(a=>a.workspaceId===args.workspaceId&&a.goalIds.includes(goal._id)&&a.date>=snapshot.startDate&&(!snapshot.endDate||a.date<=snapshot.endDate)&&(!asOfDate||a.date<=asOfDate));
  return {goal:snapshot,current:sum(entries),entries:ordered(entries).reverse()};
}

export function createHabits(deps:{onTargetReached?:(event:HabitTargetEvent)=>Promise<void>} = {}) {
  const saveHabit=async(args:Scope&{habitId?:string;title:string;areaId?:string|null;unit:string;dailyTarget:number;daysPerWeek:number;timezone:string;state?:State;goalIds?:string[]})=>{
    requireWorkspace(args.workspaceId); const title=short.parse(args.title),unit=unitSchema.parse(args.unit),dailyTarget=numberSchema.parse(args.dailyTarget),daysPerWeek=z.number().int().min(1).max(7).parse(args.daysPerWeek),state=stateSchema.parse(args.state??"active"),areaId=args.areaId??null;
    if(dailyTarget<=0) throw new Error("Daily target must be positive."); validateArea(args.workspaceId,areaId);
    try { localDate(args.timezone); } catch { throw new Error("Choose a valid timezone."); }
    const old=args.habitId?habitIn(args.workspaceId,args.habitId):undefined;
    if(old&&old.unit!==unit) throw new Error("A habit cannot change units. Create a new habit instead to preserve history.");
    const goalIds=[...new Set(args.goalIds??old?.goalIds??[])]; if(goalIds.length>20) throw new Error("Link at most 20 goals.");
    for(const goalId of goalIds){ const goal=goalIn(args.workspaceId,goalId); if(goal.unit!==unit||(goal.state!=="active"&&!old?.goalIds.includes(goalId))) throw new Error("Newly linked goals must be active and use the same unit."); }
    const id=old?._id??nanoid(),now=data.habitVersions.filter(v=>v.habitId===id).reduce((value,v)=>Math.max(value,v.createdAt+1),Date.now());
    await run("INSERT INTO habits VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(_id) DO UPDATE SET areaId=excluded.areaId,title=excluded.title,unit=excluded.unit,dailyTarget=excluded.dailyTarget,daysPerWeek=excluded.daysPerWeek,timezone=excluded.timezone,state=excluded.state,updatedAt=excluded.updatedAt",[id,args.workspaceId,areaId,title,unit,dailyTarget,daysPerWeek,args.timezone,state,old?.createdAt??now,now]);
    await run("DELETE FROM habitGoalLinks WHERE workspaceId=? AND habitId=?",[args.workspaceId,id]);
    for(const goalId of goalIds) await run("INSERT INTO habitGoalLinks VALUES (?,?,?,?)",[nanoid(),args.workspaceId,id,goalId]);
    await run("INSERT INTO habitVersions VALUES (?,?,?,?,?,?,?,?,?,?)",[nanoid(),args.workspaceId,id,localDate(args.timezone,now),dailyTarget,daysPerWeek,unit,args.timezone,state,now]); return id;
  };
  const saveGoal=async(args:Scope&{goalId?:string;title:string;areaId?:string|null;unit:string;target:number;startDate:string;endDate?:string|null;state?:State})=>{
    requireWorkspace(args.workspaceId);const title=short.parse(args.title),unit=unitSchema.parse(args.unit),target=numberSchema.parse(args.target),startDate=dateOnly(args.startDate),endDate=args.endDate?dateOnly(args.endDate):null,state=stateSchema.parse(args.state??"active"),areaId=args.areaId??null;
    if(target<=0) throw new Error("Goal target must be positive."); if(endDate&&endDate<startDate) throw new Error("End date must be on or after start date."); validateArea(args.workspaceId,areaId);
    const old=args.goalId?goalIn(args.workspaceId,args.goalId):undefined;
    if(old&&old.unit!==unit) throw new Error("A goal cannot change units. Create a new goal instead to preserve history.");
    const id=old?._id??nanoid(),now=data.goalVersions.filter(v=>v.goalId===id).reduce((value,v)=>Math.max(value,v.createdAt+1),Date.now());
    await run("INSERT INTO goals VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(_id) DO UPDATE SET areaId=excluded.areaId,title=excluded.title,unit=excluded.unit,target=excluded.target,startDate=excluded.startDate,endDate=excluded.endDate,state=excluded.state,updatedAt=excluded.updatedAt",[id,args.workspaceId,areaId,title,unit,target,startDate,endDate,state,old?.createdAt??now,now]);
    await run("INSERT INTO goalVersions VALUES (?,?,?,?,?,?,?,?)",[nanoid(),args.workspaceId,id,target,startDate,endDate,state,now]);return id;
  };
  const log=async(args:Scope&{activityId?:string;habitId?:string|null;goalIds?:string[];itemId?:string|null;unit?:string;value:number;mode:Mode;date:string;note?:string})=>{
    requireWorkspace(args.workspaceId); const date=dateOnly(args.date),value=numberSchema.parse(args.value),mode=z.enum(["increment","absolute"]).parse(args.mode),note=z.string().trim().max(5000).parse(args.note??"");
    if(mode==="increment"&&value<=0) throw new Error("An incremental activity must be positive.");
    const id=args.activityId?z.string().trim().min(1).max(100).parse(args.activityId):nanoid();
    const [existing]=await select<{_id:string;workspaceId:string}>("SELECT _id,workspaceId FROM activityEntries WHERE _id=?",[id]);
    if(existing){ const old=activityIn(args.workspaceId,id); const explicitGoals=args.goalIds&&[...new Set(args.goalIds)].sort().join("\0"); if(old.voided||old.habitId!==(args.habitId??null)||old.itemId!==(args.itemId??null)||(args.unit!==undefined&&old.unit!==unitSchema.parse(args.unit))||old.value!==value||old.mode!==mode||old.date!==date||old.note!==note||(explicitGoals!==undefined&&[...old.goalIds].sort().join("\0")!==explicitGoals)) throw new Error("Activity ID already belongs to a different record."); return id; }
    const habit=args.habitId?habitIn(args.workspaceId,args.habitId):undefined;
    if(habit&&habit.state!=="active") throw new Error("Resume the habit before logging new activity.");
    if(habit&&data.habitDayMarks.some(m=>m.workspaceId===args.workspaceId&&m.habitId===habit._id&&m.date===date)) throw new Error("Clear the rest/skip mark before logging activity on that day.");
    let goalIds=[...new Set(args.goalIds??habit?.goalIds??[])]; if(goalIds.length>20) throw new Error("Link at most 20 goals.");
    let goals=goalIds.map(id=>goalIn(args.workspaceId,id));
    const eligible=(g:GoalDoc)=>g.state==="active"&&date>=g.startDate&&(!g.endDate||date<=g.endDate);
    if(args.goalIds!==undefined&&goals.some(g=>!eligible(g))) throw new Error("Activity date must be within each active linked goal's dates.");
    if(args.goalIds===undefined) { goals=goals.filter(eligible); goalIds=goals.map(g=>g._id); }
    if(habit&&mode==="absolute"&&goals.length) throw new Error("Use an incremental amount for a habit linked to goals; absolute readings would overwrite the goal total.");
    const unit=unitSchema.parse(args.unit??habit?.unit??goals[0]?.unit??"times");
    if((habit&&habit.unit!==unit)||goals.some(g=>g.unit!==unit)) throw new Error("Habit, activity, and goals must use the same unit.");
    const itemId=args.itemId??null; if(itemId&&!data.items.some(i=>i._id===itemId&&i.workspaceId===args.workspaceId&&!i.archived)) throw new Error("Choose an active Item in this Workspace.");
    const now=data.activities.reduce((value,a)=>Math.max(value,a.createdAt+1),Date.now()),version=habit?versionFor(habit,date):undefined;
    const newEntry:ActivityDoc={_id:id,workspaceId:args.workspaceId,habitId:habit?._id??null,itemId,unit,value,mode,date,note,habitTarget:version?.dailyTarget??habit?.dailyTarget??null,habitDaysPerWeek:version?.daysPerWeek??habit?.daysPerWeek??null,goalIds,voided:false,createdAt:now,updatedAt:now};
    const habitBefore=habit?habitDetails({workspaceId:args.workspaceId,habitId:habit._id,date}):undefined;
    const goalBefore=goals.map(goal=>goalDetails({workspaceId:args.workspaceId,goalId:goal._id}));
    await run("INSERT INTO activityEntries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[id,args.workspaceId,habit?._id??null,itemId,unit,value,mode,date,note,version?.dailyTarget??habit?.dailyTarget??null,version?.daysPerWeek??habit?.daysPerWeek??null,0,now,now]);
    for(const goalId of goalIds) await run("INSERT INTO activityGoalLinks VALUES (?,?,?,?)",[nanoid(),args.workspaceId,id,goalId]);
    await run("INSERT INTO activityRevisions VALUES (?,?,?,?,?,?,?)",[nanoid(),args.workspaceId,id,"create","{}",JSON.stringify({value,mode,date,note,goalIds}),now]);
    if(deps.onTargetReached&&habit&&habitBefore){
      const after=sum([...habitBefore.entries.filter(e=>e.date===date),newEntry]);
      if(!habitBefore.todayMet&&after>=habitBefore.todayTarget) await deps.onTargetReached({workspaceId:args.workspaceId,kind:"habit_target_met",entityId:habit._id,title:habit.title,date,activityId:id,itemId,value:after,target:habitBefore.todayTarget});
    }
    if(deps.onTargetReached) for(const before of goalBefore){
      const after=sum([...before.entries,newEntry]);
      if(before.current<before.goal.target&&after>=before.goal.target) await deps.onTargetReached({workspaceId:args.workspaceId,kind:"goal_target_reached",entityId:before.goal._id,title:before.goal.title,date,activityId:id,itemId,value:after,target:before.goal.target});
    }
    return id;
  };
  const edit=async(args:Scope&{activityId:string;value:number;date:string;note?:string})=>{
    requireWorkspace(args.workspaceId); const old=activityIn(args.workspaceId,args.activityId); if(old.voided) throw new Error("This activity was voided.");
    const date=dateOnly(args.date),value=numberSchema.parse(args.value),note=z.string().trim().max(5000).parse(args.note??""); if(old.mode==="increment"&&value<=0) throw new Error("An incremental activity must be positive.");
    const habit=old.habitId?habitIn(args.workspaceId,old.habitId):undefined;
    if(habit&&data.habitDayMarks.some(m=>m.habitId===habit._id&&m.workspaceId===args.workspaceId&&m.date===date)) throw new Error("Clear the rest/skip mark before moving activity to that day.");
    for(const goalId of old.goalIds){const goal=goalIn(args.workspaceId,goalId); if(date<goal.startDate||(goal.endDate&&date>goal.endDate)) throw new Error("Activity date must be within the linked goals' dates.");}
    const version=habit&&date!==old.date?versionFor(habit,date):undefined,now=Date.now();
    await run("UPDATE activityEntries SET value=?,date=?,note=?,habitTarget=?,habitDaysPerWeek=?,updatedAt=? WHERE _id=? AND workspaceId=?",[value,date,note,version?.dailyTarget??old.habitTarget,version?.daysPerWeek??old.habitDaysPerWeek,now,old._id,args.workspaceId]);
    await run("INSERT INTO activityRevisions VALUES (?,?,?,?,?,?,?)",[nanoid(),args.workspaceId,old._id,"edit",JSON.stringify({value:old.value,date:old.date,note:old.note}),JSON.stringify({value,date,note}),now]);return null;
  };
  const voidActivity=async(args:Scope&{activityId:string})=>{
    requireWorkspace(args.workspaceId); const old=activityIn(args.workspaceId,args.activityId); if(old.voided)return null; const now=Date.now();
    await run("UPDATE activityEntries SET voided=1,updatedAt=? WHERE _id=? AND workspaceId=?",[now,old._id,args.workspaceId]);
    await run("INSERT INTO activityRevisions VALUES (?,?,?,?,?,?,?)",[nanoid(),args.workspaceId,old._id,"void",JSON.stringify({voided:false}),JSON.stringify({voided:true}),now]);return null;
  };
  const mark=async(args:Scope&{habitId:string;date:string;status:"rest"|"skip"|"clear"})=>{
    requireWorkspace(args.workspaceId);const habit=habitIn(args.workspaceId,args.habitId),date=dateOnly(args.date),status=z.enum(["rest","skip","clear"]).parse(args.status),now=Date.now();
    const existing=data.habitDayMarks.find(m=>m.workspaceId===args.workspaceId&&m.habitId===habit._id&&m.date===date);
    if(status!=="clear"&&data.activities.some(a=>a.workspaceId===args.workspaceId&&a.habitId===habit._id&&a.date===date&&!a.voided)) throw new Error("Void or move recorded activity before marking this day as rest or skipped.");
    if(status==="clear") await run("DELETE FROM habitDayMarks WHERE workspaceId=? AND habitId=? AND date=?",[args.workspaceId,habit._id,date]);
    else await run("INSERT INTO habitDayMarks VALUES (?,?,?,?,?,?,?) ON CONFLICT(habitId,date) DO UPDATE SET status=excluded.status,updatedAt=excluded.updatedAt",[nanoid(),args.workspaceId,habit._id,date,status,now,now]);
    await run("INSERT INTO activityRevisions VALUES (?,?,?,?,?,?,?)",[nanoid(),args.workspaceId,`habit-day:${habit._id}:${date}`,"mark",JSON.stringify({status:existing?.status??null}),JSON.stringify({status:status==="clear"?null:status}),now]);return null;
  };
  return {saveHabit,saveGoal,log,edit,voidActivity,mark};
}
