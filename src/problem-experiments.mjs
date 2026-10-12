import {randomUUID} from 'node:crypto';
import {interviewBoard} from './problem-interviews.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const safe=(x,n=1000)=>String(x??'').trim().slice(0,n);
export function interviewEvidenceSummary(store,problemId,planId){
 const board=interviewBoard(store,problemId),plan=board.plans.find(x=>x.id===planId);
 if(!plan)throw fail('PLAN_NOT_FOUND','找不到访谈计划',404);
 const observations=plan.observations.map(o=>({id:o.id,participant:o.participant,sourceUrl:o.sourceUrl||null,actualBehavior:o.actualBehavior,scenario:o.scenario,contradiction:o.contradiction,at:o.at}));
 const distinctParticipants=new Set(observations.map(x=>x.participant));
 return {problemId,planId,decision:plan.decision||null,goal:plan.minInterviews,observations,recordCount:observations.length,distinctParticipantLabels:distinctParticipants.size,
  supporting:observations.map(o=>({id:o.id,text:o.actualBehavior,sourceUrl:o.sourceUrl})),
  counterEvidence:observations.map(o=>({id:o.id,text:o.contradiction,sourceUrl:o.sourceUrl})),
  unknowns:['匿名标识无法证明受访者独立性','人工输入的行为仍需原始材料核查','记录数量不能证明目标市场规模或付费意愿'],
  note:'支持和反面片段只是访谈记录分栏，不代表已裁定支持或证伪'};
}
export function designProblemExperiment(store,problemId,planId,data={}){
 const summary=interviewEvidenceSummary(store,problemId,planId);
 if(summary.decision!=='low_cost_test')throw fail('DECISION_REQUIRED','须先由用户将访谈结论标记为低成本实验',409);
 const old=store.list('problem_experiment_designs').find(x=>x.planId===planId);
 if(old)throw fail('DESIGN_EXISTS','该访谈计划已有实验设计',409);
 const budget=Number(data.budgetLimit);
 if(!Number.isFinite(budget)||budget<0||budget>100000)throw fail('BAD_BUDGET','预算上限必须是0至100000的明确数字');
 const currency=safe(data.currency,8);
 if(!['CNY','USD','EUR'].includes(currency))throw fail('BAD_CURRENCY','请指定CNY、USD或EUR');
 const fields=['targetUser','experimentMethod','successCondition','stopCondition','acceptanceEvidence'];
 const out=Object.fromEntries(fields.map(k=>[k,safe(data[k],1000)]));
 if(fields.some(k=>out[k].length<12))throw fail('INCOMPLETE_DESIGN','目标用户、实验方法、成功条件、停止条件和验收证据均需至少12字');
 const item=store.put('problem_experiment_designs',{id:randomUUID(),problemId,planId,interviewCount:summary.recordCount,currency,budgetLimit:budget,...out,status:'draft',createdAt:new Date().toISOString()});
 store.event('problem.experiment.design_created',problemId,'owner',{designId:item.id,planId,budgetLimit:budget,currency});
 return item;
}
export function problemExperimentDesigns(store,problemId,planId){
 const summary=interviewEvidenceSummary(store,problemId,planId);
 return {...summary,designs:store.list('problem_experiment_designs').filter(x=>x.planId===planId),notice:'实验设计仅作为草稿，不会触发项目创建、预算支付、用户联系或外部发布'};
}
