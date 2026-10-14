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
export function weeklyResearchEvidence(store,options={}){
 const plan=weeklyResearchPlan(store,options);
 const start=Date.parse(plan.weekStart+'T00:00:00Z');
 const end=start+7*86400000;
 const events=store.eventsLatest(2000).filter(e=>supported[e.kind]&&Date.parse(e.created_at)>=start&&Date.parse(e.created_at)<end);
 const items=plan.items.map(item=>{
  const linked=events.filter(e=>e.entity_id===item.candidateId).map(e=>({
   seq:e.seq,kind:e.kind,label:supported[e.kind],at:e.created_at,detail:e.detail
  }));
  const progress=plan.progress.filter(e=>e.candidateId===item.candidateId);
  return {candidateId:item.candidateId,title:item.title,task:item.task,
   evidence:linked,progressCount:progress.length,lastProgress:progress.at(-1)||null,
   evidenceCount:linked.length,autoCompleted:false};
 });
 return {weekStart:plan.weekStart,status:plan.status,items,limitedToRecentEvents:2000,
  notice:'只关联本周内有明确候选 ID 的数据库事件，不推断研究质量或自动完成任务。事件历史超过查询窗口时可能不完整。'};
}
