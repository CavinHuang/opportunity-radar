import {weeklyResearchPlan} from './opportunity-weekly-plan.mjs';
import {weeklyResearchEvidence} from './opportunity-weekly-evidence.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(x,n=700)=>String(x??'').trim().slice(0,n);
const conclusions=new Set(['unknown','supported','contradicted']);
export function weeklyHypothesisBoard(store,options={}){
 const plan=weeklyResearchPlan(store,options);
 const weekly=weeklyResearchEvidence(store,options);
 const id=plan.id,record=store.get('opportunity_weekly_hypotheses',id);
 const mapping=new Map(weekly.items.map(x=>[x.candidateId,x]));
 const items=plan.items.map(item=>{
  const hypothesis=(record?.items||[]).find(x=>x.candidateId===item.candidateId)||null;
  const available=mapping.get(item.candidateId)?.evidence||[];
  const linked=hypothesis?available.filter(e=>hypothesis.eventSeqs.includes(e.seq)):[];
  return {candidateId:item.candidateId,title:item.title,task:item.task,hypothesis,
   eligibleEvidence:available.map(e=>({seq:e.seq,kind:e.kind,label:e.label,quality:e.quality,at:e.at})),
   linkedEvidence:linked,unavailableEvidenceSeqs:hypothesis?hypothesis.eventSeqs.filter(seq=>!available.some(e=>e.seq===seq)):[],
   finding:hypothesis?.finding||'unknown'};
 });
 return {id,weekStart:plan.weekStart,planStatus:plan.status,planRevision:plan.revision,
  revision:record?.revision||0,items,
  notice:'结论只代表人工审核记录；事件只说明操作发生过，无法自动证明假设。仅能引用同一候选、本周事件，失效的事件 ID 保留但不再视为有效证据。'};
}
export function saveWeeklyHypothesis(store,data={},options={}){
 const board=weeklyHypothesisBoard(store,options);
 if(board.planStatus!=='planned')throw fail('WEEK_CLOSED','只有未复盘计划可以修改假设',409);
 if(data.expected_revision!==board.revision||data.planRevision!==board.planRevision)throw fail('REVISION_CONFLICT','周计划或假设已更新，请刷新',409);
 const item=board.items.find(x=>x.candidateId===data.candidateId);
 if(!item)throw fail('NOT_PLANNED','该机会不属于本周计划',409);
 const hypothesis=clean(data.hypothesis),expectedEvidence=clean(data.expectedEvidence),falsifier=clean(data.falsifier),rationale=clean(data.rationale);
 const finding=data.finding||'unknown';
 if([hypothesis,expectedEvidence,falsifier].some(x=>x.length<12))throw fail('INCOMPLETE_HYPOTHESIS','假设、预期证据和证伪条件都需要至少12字');
 if(!conclusions.has(finding))throw fail('INVALID_FINDING','不支持的人工判断');
 if(!Array.isArray(data.eventSeqs)||new Set(data.eventSeqs).size!==data.eventSeqs.length||data.eventSeqs.length>50)
  throw fail('INVALID_EVIDENCE','证据 ID 数量或格式无效');
 const eligible=new Set(item.eligibleEvidence.map(x=>x.seq));
 if(data.eventSeqs.some(x=>!Number.isSafeInteger(x)||!eligible.has(x)))throw fail('FOREIGN_EVIDENCE','只能关联本候选、本周真实研究事件',409);
 if(finding!=='unknown'&&(!data.eventSeqs.length||rationale.length<12))
  throw fail('INSUFFICIENT_REASON','支持或反驳判断必须选用至少一个事件并解释判断依据');
 return store.transaction(()=>{
  const fresh=weeklyHypothesisBoard(store,options);
  if(fresh.planStatus!=='planned'||fresh.planRevision!==data.planRevision||fresh.revision!==data.expected_revision)
   throw fail('REVISION_CONFLICT','周计划或假设已更新',409);
  const selected=fresh.items.find(x=>x.candidateId===data.candidateId);
  if(!selected||data.eventSeqs.some(x=>!selected.eligibleEvidence.some(e=>e.seq===x)))throw fail('FOREIGN_EVIDENCE','证据归属已发生变化',409);
  const previous=store.get('opportunity_weekly_hypotheses',board.id);
  const entries=(previous?.items||[]).filter(x=>x.candidateId!==data.candidateId);
  const entry={candidateId:data.candidateId,hypothesis,expectedEvidence,falsifier,finding,rationale,
   eventSeqs:data.eventSeqs,updatedAt:new Date().toISOString()};
  const row=store.put('opportunity_weekly_hypotheses',{id:board.id,weekStart:board.weekStart,items:[...entries,entry]},board.revision);
  store.event('opportunity.weekly_hypothesis.reviewed',board.id,'owner',{candidateId:data.candidateId,finding,linkedEvents:data.eventSeqs.length,revision:row.revision});
  return row;
 });
}
