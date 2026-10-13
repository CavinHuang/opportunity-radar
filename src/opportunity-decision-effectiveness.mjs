// Descriptive owner-reported investment efficiency, NOT observed causal lift.
const round=n=>Number(n.toFixed(2));
const percent=(a,b)=>b?Number((a/b).toFixed(4)):null;
export function decisionEffectivenessReport(store,{problemId=null}={}){
 const rows=store.list('opportunity_decision_history').filter(x=>!problemId||x.problemId===problemId);
 const closed=rows.filter(x=>x.outcome);
 const pending=rows.filter(x=>!x.outcome);
 const sum=(items,fn)=>round(items.reduce((acc,x)=>acc+fn(x),0));
 const plannedHours=sum(rows,x=>Number(x.plannedHours)||0),actualHours=sum(closed,x=>Number(x.outcome.actualHours)||0);
 const plannedBudgetOnClosed=sum(closed,x=>Number(x.plannedBudget)||0),plannedHoursOnClosed=sum(closed,x=>Number(x.plannedHours)||0);
 const actualCost=sum(closed,x=>Number(x.outcome.actualCost)||0);
 const inconclusive=closed.filter(x=>['inconclusive','unknown'].includes(x.outcome.status));
 const pause=closed.filter(x=>x.adopted==='pause_or_stop');
 const outcomes={supported:closed.filter(x=>x.outcome.status==='supported').length,
  contradicted:closed.filter(x=>x.outcome.status==='contradicted').length,
  inconclusive:closed.filter(x=>x.outcome.status==='inconclusive').length,
  unknown:closed.filter(x=>x.outcome.status==='unknown').length};
 const byDecision=['continue_verification','pause_or_stop','review_small_experiment'].map(decision=>{
  const subset=closed.filter(x=>x.adopted===decision);
  return {decision,records:subset.length,actualHours:sum(subset,x=>x.outcome.actualHours),actualCost:sum(subset,x=>x.outcome.actualCost),
   inconclusive:subset.filter(x=>['inconclusive','unknown'].includes(x.outcome.status)).length};
 });
 return {sample:{all:rows.length,closed:closed.length,pending:pending.length,uniqueProblems:new Set(rows.map(x=>x.problemId)).size},
  completionRate:percent(closed.length,rows.length),
  plan:{hoursAll:plannedHours,hoursClosed:plannedHoursOnClosed,budgetClosed:plannedBudgetOnClosed},
  actual:{hoursClosed:actualHours,costClosed:actualCost},
  delta:{hoursClosed:round(actualHours-plannedHoursOnClosed),costClosed:round(actualCost-plannedBudgetOnClosed)},
  inconclusive:{records:inconclusive.length,hours:sum(inconclusive,x=>x.outcome.actualHours),cost:sum(inconclusive,x=>x.outcome.actualCost)},
  stopped:{records:pause.length,recordedHours:sum(pause,x=>x.outcome.actualHours),recordedCost:sum(pause,x=>x.outcome.actualCost)},
  outcomes,byDecision,
  records:closed.map(x=>({id:x.id,problemId:x.problemId,title:x.briefSnapshot?.title||x.problemId,
   recommended:x.recommended,adopted:x.adopted,outcome:x.outcome.status,actualHours:x.outcome.actualHours,
   actualCost:x.outcome.actualCost,plannedHours:x.plannedHours,plannedBudget:x.plannedBudget})).slice(-50),
  notice:'只统计人工自报且已有结果的决策；未结案记录不计实际投入。暂停记录不等于已避免损失；支持/反驳是自报观察，不能推断建议准确率、商业成功或因果收益。成本按记录原值汇总，必须由使用者确保币种一致。'};
}
