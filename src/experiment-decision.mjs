/** Conservative decision support over manually recorded actual outcomes. */
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
 return {
   milestoneAccepted:allAccepted,pendingAcceptance:pending,
   evidenceCoverage:{actualEntries:actual.length,missingMetrics:missing},
   outcomes:{visits:reported.has('visits')?visits:null,trials:reported.has('trials')?attempts:null,income:reported.has('income')?income:null,knownCashCosts:costs,netKnownCash:netCash,
     trialRate:reported.has('visits')&&reported.has('trials')&&visits>0&&attempts<=visits?attempts/visits:null},
   status:!allAccepted||pending?'delivery_unverified':missing.length?'evidence_incomplete':'ready_for_owner_review',
   caveats:['仅统计明确标记实际发生的人工登记数据','未记录的指标为未知，绝不按零处理','已知净现金未包含未记录的人工时间和固定成本','最终继续、调整或停止须由用户审批']
 };
}
