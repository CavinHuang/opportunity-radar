import {weeklyResearchPlan,saveWeeklyResearchPlan,weekMonday} from './opportunity-weekly-plan.mjs';
import {weeklyResearchEvidence} from './opportunity-weekly-evidence.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const safe=(x,n=700)=>String(x??'').trim().slice(0,n);
const states=new Set(['in_progress','blocked','completed']);
export function updateWeeklyResearchProgress(store,{candidateId,status,note,actualHours,expected_revision,acknowledgeEvidenceGap=false}={},options={}){
 const board=weeklyResearchPlan(store,options);
 if(board.status!=='planned')throw fail('NO_ACTIVE_WEEK','只有已保存且未复盘的周计划可以更新进度',409);
 if(board.revision!==expected_revision)throw fail('REVISION_CONFLICT','周计划已更新，请刷新',409);
 if(!board.items.some(x=>x.candidateId===candidateId))throw fail('NOT_PLANNED','该机会不在本周计划中',409);
 if(!states.has(status))throw fail('INVALID_PROGRESS','不支持的任务进度');
 const detail=safe(note),hours=Number(actualHours);
 if(detail.length<10||!Number.isFinite(hours)||hours<0||hours>1000)throw fail('INVALID_PROGRESS','请输入10字以上进展和有效的累计投入小时');
 const evidence=weeklyResearchEvidence(store,options).items.find(x=>x.candidateId===candidateId);
 if(status==='completed'&&evidence?.completionCheck==='requires_manual_evidence_acknowledgement'&&acknowledgeEvidenceGap!==true)
  throw fail('EVIDENCE_ACK_REQUIRED','尚无本周观察记录，若仍要标为已完成，请明确确认并说明依据',409);
 return store.transaction(()=>{
  const current=weeklyResearchPlan(store,options);
  if(current.status!=='planned'||current.revision!==expected_revision)throw fail('REVISION_CONFLICT','周计划已变更',409);
  const old=store.get('opportunity_weekly_plans',board.id);
  const progress=old.progress||[];
  const event={candidateId,status,note:detail,actualHours:hours,at:new Date().toISOString(),evidenceAtDecision:{recordedObservations:evidence?.quality.recordedObservations||0,counterEvidence:evidence?.counterEvidence||0,gapAcknowledged:acknowledgeEvidenceGap===true}};
  const updated=store.put('opportunity_weekly_plans',{...old,progress:[...progress,event],updatedAt:event.at},expected_revision);
  store.event('opportunity.weekly_plan.progress_updated',board.id,'owner',{candidateId,status,revision:updated.revision});
  return updated;
 });
}
export function weeklyResearchTrend(store,{limit=12}={}){
 const n=Math.min(Math.max(1,Number(limit)||12),52);
 const weeks=store.list('opportunity_weekly_plans').filter(x=>x.weekStart).sort((a,b)=>String(a.weekStart).localeCompare(String(b.weekStart))).slice(-n);
 const rows=weeks.map(x=>{
  const plannedHours=x.items.reduce((sum,i)=>sum+(Number(i.hours)||0),0);
  const closed=x.status==='reviewed'&&Array.isArray(x.review?.results);
  const results=closed?x.review.results:[];
  const hours=results.reduce((sum,i)=>sum+(Number(i.actualHours)||0),0);
  const costs=results.reduce((sum,i)=>sum+(Number(i.actualCost)||0),0);
  return {weekStart:x.weekStart,status:x.status,planned: x.items.length,
   plannedHours:Number(plannedHours.toFixed(2)),actualHours:closed?Number(hours.toFixed(2)):null,
   actualCost:closed?Number(costs.toFixed(2)):null,
   completed:results.filter(i=>i.status==='completed').length,
   blocked:results.filter(i=>i.status==='blocked').length,
   inconclusive:results.filter(i=>i.status==='inconclusive').length,
   progressEvents:(x.progress||[]).length,
   conclusionRate:closed&&results.length?Number((results.filter(i=>i.status==='completed').length/results.length).toFixed(4)):null};
 });
 return {weeks:rows,closedWeeks:rows.filter(x=>x.status==='reviewed').length,
  notice:'仅统计有保存记录的周计划，未复盘周不计入实际小时或成本。完成比例来自人工状态，不代表商业成果；金额只有确保同币种后才能跨周比较。'};
}
export function carryPreviousWeekTasks(store,{candidateIds,expected_revision}={},options={}){
 const now=options.now||new Date(),monday=weekMonday(now);
 const priorDate=new Date(monday+'T00:00:00Z');priorDate.setUTCDate(priorDate.getUTCDate()-7);
 const prior=store.get('opportunity_weekly_plans','week:'+priorDate.toISOString().slice(0,10));
 if(!prior)throw fail('NO_PREVIOUS_WEEK','上周没有已保存的研究计划',409);
 if(!Array.isArray(candidateIds)||candidateIds.length<1||candidateIds.length>3||new Set(candidateIds).size!==candidateIds.length)
  throw fail('INVALID_SELECTION','请选择1至3个互不重复的上周任务');
 const priorItems=prior.items||[];
 const selected=candidateIds.map(id=>{
  const entry=priorItems.find(x=>x.candidateId===id);
  if(!entry)throw fail('INVALID_SELECTION','只能延续上周真实存在的任务');
  return {candidateId:id,task:entry.task,hours:entry.hours,budget:entry.budget};
 });
 const current=weeklyResearchPlan(store,options);
 if(current.status!=='draft'||current.revision!==expected_revision)
  throw fail('WEEK_HAS_PLAN','本周已有计划，请人工修改，不自动覆盖',409);
 return saveWeeklyResearchPlan(store,{expected_revision,items:selected},options);
}
