import {weeklyResearchPlan} from './opportunity-weekly-plan.mjs';

// Evidence is discovered from persisted owner events; no fabricated progress or task completion.
const supported={
 'opportunity.external_research.searched':'外部反证检索',
 'problem.verification.reviewed':'真实问题核查',
 'problem.interview.plan.created':'访谈计划',
 'problem.interview.observed':'用户访谈观察',
 'problem.interview.decided':'访谈结论',
 'opportunity.external_evidence.reviewed':'外部证据审核',
 'opportunity.alternative_research.reviewed':'替代方案核查',
 'opportunity.feasibility.reviewed':'可行性核查',
 'opportunity.decision.adopted':'研究决策',
 'opportunity.decision.outcome_recorded':'决策结果',
 'problem.experiment.result_recorded':'实验观察',
 'problem.experiment.closed':'实验结论',
 'problem.interview.observation_added':'用户访谈',
 'problem.interview.observation_recorded':'用户访谈'
};
const direct=new Set(['problem.interview.observed','problem.interview.observation_added','problem.interview.observation_recorded','problem.experiment.result_recorded']);
const ownerReview=new Set(['problem.verification.reviewed','opportunity.external_evidence.reviewed','opportunity.alternative_research.reviewed','opportunity.feasibility.reviewed','problem.experiment.closed','problem.interview.decided','opportunity.decision.outcome_recorded']);
export function weeklyResearchEvidence(store,options={}){
 const plan=weeklyResearchPlan(store,options);
 const start=Date.parse(plan.weekStart+'T00:00:00Z');
 const end=start+7*86400000;
 const events=store.eventsLatest(2000).filter(e=>supported[e.kind]&&Date.parse(e.created_at)>=start&&Date.parse(e.created_at)<end);
 const items=plan.items.map(item=>{
  const linked=events.filter(e=>e.entity_id===item.candidateId).map(e=>({
   seq:e.seq,kind:e.kind,label:supported[e.kind],at:e.created_at,detail:e.detail,quality:direct.has(e.kind)?'recorded_observation':ownerReview.has(e.kind)?'owner_assessment':'activity_only'
  }));
  const progress=plan.progress.filter(e=>e.candidateId===item.candidateId);
  const quality={recordedObservations:linked.filter(x=>x.quality==='recorded_observation').length,ownerAssessments:linked.filter(x=>x.quality==='owner_assessment').length,activityOnly:linked.filter(x=>x.quality==='activity_only').length};
  const counterEvidence=linked.filter(x=>['problem.experiment.closed','problem.interview.decided','opportunity.decision.outcome_recorded'].includes(x.kind)&&['stop','contradicted'].includes(String(x.detail?.decision||x.detail?.outcome||'')));
  return {candidateId:item.candidateId,title:item.title,task:item.task,quality,counterEvidence:counterEvidence.length,
   completionCheck:quality.recordedObservations?'review_observations_and_falsifiers':'requires_manual_evidence_acknowledgement',
   evidence:linked,progressCount:progress.length,lastProgress:progress.at(-1)||null,
   evidenceCount:linked.length,autoCompleted:false};
 });
 return {weekStart:plan.weekStart,status:plan.status,items,limitedToRecentEvents:2000,
  notice:'只关联本周内有明确候选 ID 的数据库事件，按事件类型区分操作、人工判断与观察记录，但不能验证内容真实性；不自动完成任务。事件历史超过查询窗口时可能不完整。'};
}
