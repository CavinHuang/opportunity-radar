import {randomUUID,createHash} from 'node:crypto';
import {opportunityDecisionBrief} from './opportunity-decision-brief.mjs';
import {candidateContext} from './opportunity-research.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(s,n=900)=>String(s??'').trim().slice(0,n);
const choices=new Set(['continue_verification','pause_or_stop','review_small_experiment']);
const outcomes=new Set(['unknown','supported','contradicted','inconclusive']);
const fingerprint=b=>createHash('sha256').update(JSON.stringify([b.candidateId,b.disposition,b.stage,b.sourceUrls,b.blockers,b.feasibility,b.experiments,b.interview])).digest('hex');
export function decisionOutcomeLedger(store,id){
 const brief=opportunityDecisionBrief(store,id);
 const entries=store.list('opportunity_decision_history').filter(x=>x.problemId===id).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 const currentHash=createHash('sha256').update(fingerprint(brief)+candidateContext(store,id).fingerprint).digest('hex');
 return {candidateId:id,brief,briefFingerprint:currentHash,entries,revision:entries.length,readOnly:true,
  notice:'历史决策记录冻结当时证据和建议；后续观察为人工自报，不等于验证商业成功。没有实际结果不能算作命中。'};
}
export function adoptDecision(store,id,{briefFingerprint,decision,reason,plannedBudget,plannedHours}={}){
 const ledger=decisionOutcomeLedger(store,id);
 if(briefFingerprint!==ledger.briefFingerprint)throw fail('STALE_BRIEF','决策报告证据已变化，请重新查看',409);
 if(!choices.has(decision))throw fail('BAD_DECISION','请选择继续调查、暂停或评审低成本实验');
 const note=clean(reason);
 if(note.length<12)throw fail('REASON_REQUIRED','必须说明至少12字的采纳或不采纳原因');
 const budget=Number(plannedBudget),hours=Number(plannedHours);
 if(!Number.isFinite(budget)||budget<0||budget>100000||!Number.isFinite(hours)||hours<0||hours>10000)throw fail('INVALID_PLAN','预算或时间计划无效');
 return store.transaction(()=>{
  if(decisionOutcomeLedger(store,id).briefFingerprint!==briefFingerprint)throw fail('STALE_BRIEF','报告已变化',409);
  const row=store.put('opportunity_decision_history',{id:randomUUID(),problemId:id,
   recommended:ledger.brief.disposition,adopted:decision,reason:note,plannedBudget:budget,plannedHours:hours,
   briefFingerprint,briefSnapshot:{title:ledger.brief.title,stage:ledger.brief.stage,blockers:ledger.brief.blockers,
     nextAction:ledger.brief.nextAction,interview:ledger.brief.interview,experiments:ledger.brief.experiments},
   createdAt:new Date().toISOString(),outcome:null});
  store.event('opportunity.decision.adopted',id,'owner',{decision,matched:decision===row.recommended,entryId:row.id});
  return row;
 });
}
export function recordDecisionOutcome(store,id,entryId,{outcome,actualHours,actualCost,notes,expected_revision}={}){
 const ledger=decisionOutcomeLedger(store,id),entry=ledger.entries.find(x=>x.id===entryId);
 if(!entry)throw fail('DECISION_NOT_FOUND','找不到历史决策',404);
 if(entry.revision!==expected_revision)throw fail('REVISION_CONFLICT','记录已经更新',409);
 if(entry.outcome)throw fail('OUTCOME_EXISTS','结果已经归档，不可覆盖历史',409);
 if(!outcomes.has(outcome))throw fail('INVALID_OUTCOME','请选择无法判断、支持、反驳或无结论');
 const hours=Number(actualHours),cost=Number(actualCost),note=clean(notes);
 if(!Number.isFinite(hours)||hours<0||hours>10000||!Number.isFinite(cost)||cost<0||cost>100000||note.length<12)
  throw fail('INCOMPLETE_OUTCOME','需填写真实投入及至少12字的观察结果');
 return store.transaction(()=>{
  const latest=store.get('opportunity_decision_history',entryId);
  if(latest?.revision!==expected_revision||latest.outcome)throw fail('REVISION_CONFLICT','记录已发生变化',409);
  const row=store.put('opportunity_decision_history',{...latest,outcome:{status:outcome,actualHours:hours,actualCost:cost,
   notes:note,recordedAt:new Date().toISOString(),selfReported:true}},expected_revision);
  store.event('opportunity.decision.outcome_recorded',id,'owner',{entryId:row.id,outcome});
  return row;
 });
}
