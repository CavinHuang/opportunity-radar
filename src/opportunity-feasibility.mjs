import {candidateContext} from './opportunity-research.mjs';
import {opportunityCompetitionSpace} from './opportunity-competition-space.mjs';
import {verificationContext} from './problem-verification.mjs';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const fields=['recurringDemand','switchingCost','technicalScope','operatingBurden','paymentEvidence','falsifier'];
const trim=(x,max=900)=>String(x??'').trim().slice(0,max);

export function opportunityFeasibilityBoard(store,id){
 const {candidate,fingerprint}=candidateContext(store,id);
 const competition=opportunityCompetitionSpace(store,id);
 const reviewed=store.get('problem_verifications',id);
 const verificationCurrent=Boolean(reviewed&&reviewed.fingerprint===verificationContext(store,id).fingerprint);
 const alternatives=store.get('opportunity_alternative_research',id);
 const sourceRevision=alternatives?.revision||0;
 const record=store.get('opportunity_feasibility_reviews',id);
 const current=Boolean(record&&record.candidateFingerprint===fingerprint&&
  record.competitionRevision===sourceRevision&&record.verificationRevision===(verificationCurrent?reviewed.revision:0));
 const inputs=current?Object.fromEntries(fields.map(k=>[k,record[k]||''])):null;
 const interviewObservations=store.list('problem_interview_observations').filter(x=>x.problemId===id);
 const experimentRecords=store.list('problem_experiment_records').filter(x=>x.problemId===id);
 const needs=[];
 if(!verificationCurrent||reviewed.decision!=='worth_interviewing')needs.push('当前问题尚未经人工确认值得访谈');
 if(!competition.counts.investigatedAlternatives)needs.push('缺少现有替代方案结构化研究');
 if(!interviewObservations.length)needs.push('缺少记录了实际行为的用户访谈');
 if(!experimentRecords.length)needs.push('缺少低成本实验结果');
 if(!inputs?.paymentEvidence)needs.push('尚无人工整理的付费意愿或实际支付证据');
 if(!inputs?.switchingCost)needs.push('尚未调查用户切换现有工具的成本');
 return {candidateId:id,title:candidate.title,candidateFingerprint:fingerprint,
  competitionRevision:sourceRevision,verificationRevision:verificationCurrent?reviewed.revision:0,
  revision:record?.revision||0,current,stale:!!record&&!current,inputs,
  evidence:{verificationCurrent,problemDecision:verificationCurrent?reviewed.decision:null,
    alternatives:competition.counts.investigatedAlternatives,
    limitations:competition.counts.withReportedLimitations,
    interviews:interviewObservations.length,experimentRecords:experimentRecords.length},
  needs,readiness:needs.length?'research_incomplete':'ready_for_human_decision',
  marketValidated:false,automaticInvestment:false,
  notice:'这是人工可行性研究笔记，不是客观风险分数。访谈和实验记录未经独立验证，填完字段不代表商业机会成立，不能自动启动投入。'};
}
export function saveOpportunityFeasibility(store,id,data={}){
 const board=opportunityFeasibilityBoard(store,id);
 if(data.candidateFingerprint!==board.candidateFingerprint||
   data.competitionRevision!==board.competitionRevision||
   data.verificationRevision!==board.verificationRevision)throw fail('STALE_EVIDENCE','研究依赖的证据发生变化，请刷新',409);
 if(data.expected_revision!==board.revision)throw fail('REVISION_CONFLICT','可行性研究已被其他操作更新',409);
 const prepared=Object.fromEntries(fields.map(k=>[k,trim(data[k])]));
 // Forcing explicit unknowns is better than fabricated estimates, so only
 // rationale and falsification method are required.
 if(prepared.falsifier.length<12||prepared.technicalScope.length<12)
  throw fail('REVIEW_INCOMPLETE','请明确至少12字的技术风险及证伪条件');
 return store.transaction(()=>{
  const fresh=opportunityFeasibilityBoard(store,id);
  if(fresh.candidateFingerprint!==data.candidateFingerprint||
    fresh.competitionRevision!==data.competitionRevision||
    fresh.verificationRevision!==data.verificationRevision)throw fail('STALE_EVIDENCE','研究依据在保存前已变化',409);
  if(fresh.revision!==data.expected_revision)throw fail('REVISION_CONFLICT','记录版本已变化',409);
  const row=store.put('opportunity_feasibility_reviews',{id,candidateFingerprint:board.candidateFingerprint,
   competitionRevision:board.competitionRevision,verificationRevision:board.verificationRevision,
   ...prepared,status:'owner_notes_unverified',reviewedAt:new Date().toISOString()},board.revision);
  store.event('opportunity.feasibility.reviewed',id,'owner',{revision:row.revision});
  return row;
 });
}
