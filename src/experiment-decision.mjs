/** Conservative decision support over manually recorded actual outcomes.
 * Phase D additions: approved-budget consumption tracking and stop-condition
 * surfacing. Missing data stays Unknown (null), never zero. This module only
 * prepares evidence for the Owner's retrospective; it never executes a project
 * state change and never declares an opportunity validated. */
const WEEK=7*86400000;
const round1=n=>Math.round(n*10)/10;
export function experimentDecisionReview(project){
 const actual=(project.ledger||[]).filter(x=>x.actual===true);
 const sum=kind=>actual.filter(x=>x.type===kind).reduce((n,x)=>n+Number(x.value||0),0);
 const reported=new Set(actual.map(x=>x.type));
 const income=sum('income'),refunds=sum('refund');
 const costs=sum('cash_cost')+sum('service_cost')+sum('transaction_fee');
 const netCash=income-refunds-costs;
 const milestones=project.milestones||[];
 const allAccepted=milestones.length>0&&milestones.every(x=>x.acceptanceState==='accepted');
 const pending=project.submissions?.some(s=>s.acceptanceState==='pending')||false;
 const missing=['visits','trials','income','cash_cost'].filter(x=>!reported.has(x));
 const attempts=sum('trials'),visits=sum('visits');
 const baseline=Array.isArray(project.baselines)&&project.baselines.length?project.baselines.at(-1):null;
 const budget=budgetReview(baseline,actual);
 return {
   milestoneAccepted:allAccepted,pendingAcceptance:pending,
   baselineRevision:baseline?.revision??null,
   evidenceCoverage:{actualEntries:actual.length,missingMetrics:missing},
   outcomes:{visits:reported.has('visits')?visits:null,trials:reported.has('trials')?attempts:null,income:reported.has('income')?income:null,knownCashCosts:costs,netKnownCash:netCash,
     trialRate:reported.has('visits')&&reported.has('trials')&&visits>0&&attempts<=visits?attempts/visits:null},
   budget,
   stopCondition:{text:baseline?.stopCondition||null,assessment:'unassessed'},
   status:!allAccepted||pending?'delivery_unverified':missing.length?'evidence_incomplete':'ready_for_owner_review',
   caveats:['仅统计明确标记实际发生的人工登记数据','未记录的指标为未知，绝不按零处理','已知净现金未包含未记录的人工时间和固定成本','最终继续、调整或停止须由用户审批',
     '预算消耗只对照已批准基线，未登记的时间与现金保持未知；时间消耗按自然周折算，晚登记会高估消耗',
     '系统只汇总证据与备选方案，不宣布机会已被验证，也不代替用户执行状态变更']
 };
}
/** Compare explicitly recorded actuals against the currently approved baseline
 * budget. Any leg without actual entries is Unknown (null), never zero. */
function budgetReview(baseline,actual){
 if(!baseline?.budget)return {weeklyUserHours:null,cashBudget:null,approvedAt:null,weeksElapsed:null,
  approvedHoursToNow:null,recordedUserHours:null,recordedCashCost:null,paceExceeded:null,cashExceeded:null,
  note:'没有已批准基线，无法对照预算'};
 const approvedAt=baseline.approvedAt&&Number.isFinite(Date.parse(baseline.approvedAt))?baseline.approvedAt:null;
 const weeksElapsed=approvedAt?round1(Math.max(0,(Date.now()-Date.parse(approvedAt))/WEEK)):null;
 const weekly=Number.isFinite(baseline.budget.weeklyUserHours)?baseline.budget.weeklyUserHours:null;
 const cash=Number.isFinite(baseline.budget.cash)?baseline.budget.cash:null;
 const hoursRows=actual.filter(x=>x.type==='user_hours');
 const cashRows=actual.filter(x=>x.type==='cash_cost');
 const recordedHours=hoursRows.length?round1(hoursRows.reduce((n,x)=>n+Number(x.value||0),0)):null;
 const recordedCash=cashRows.length?round1(cashRows.reduce((n,x)=>n+Number(x.value||0),0)):null;
 const approvedHoursToNow=weekly!=null&&weeksElapsed!=null?round1(weekly*weeksElapsed):null;
 return {weeklyUserHours:weekly,cashBudget:cash,approvedAt,weeksElapsed,approvedHoursToNow,
  recordedUserHours:recordedHours,recordedCashCost:recordedCash,
  paceExceeded:recordedHours!=null&&approvedHoursToNow!=null?recordedHours>approvedHoursToNow:null,
  cashExceeded:recordedCash!=null&&cash!=null?recordedCash>cash:null,
  note:'时间按“已批准周预算 × 自基线批准以来的自然周数”折算；现金只对照 cash_cost 口径，不含服务成本与交易手续费。未登记的消耗保持未知，不当作零。'};
}
