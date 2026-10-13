import {randomUUID} from 'node:crypto';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function decisionReviewCenter(store){
 const designs=store.list('problem_experiment_designs').filter(x=>x.status==='closed').sort((a,b)=>(b.closedAt||'').localeCompare(a.closedAt||''));
 return {items:designs.map(d=>{
  const records=store.list('problem_experiment_records').filter(x=>x.designId===d.id);
  const plan=store.get('problem_interview_plans',d.planId);
  const interviews=store.list('problem_interview_observations').filter(x=>x.planId===d.planId);
  const verification=store.get('problem_verifications',d.problemId);
  const review=store.get('problem_decision_reviews',d.id);
  const actualCost=Math.round(records.reduce((s,x)=>s+Number(x.cost||0),0)*100)/100;
  return {id:d.id,problemId:d.problemId,planId:d.planId,decision:d.decision,reason:d.decisionReason||'',closedAt:d.closedAt,currency:d.currency,budgetLimit:d.budgetLimit,actualCost,withinBudget:actualCost<=d.budgetLimit,
    recordCount:records.length,interviewCount:interviews.length,successCondition:d.successCondition,stopCondition:d.stopCondition,acceptanceEvidence:d.acceptanceEvidence,
    evidence:records.map(x=>({id:x.id,step:x.step,behavior:x.behavior,outcome:x.outcome,evidenceUrl:x.evidenceUrl||null,cost:x.cost})),
    counterEvidence:interviews.map(x=>({id:x.id,contradiction:x.contradiction,sourceUrl:x.sourceUrl||null})),
    verificationStatus:verification?.decision||'unknown',hypothesis:plan?.hypothesis||'unknown',review:review||null,
    gaps:['人工输入内容尚未独立核查','访谈记录无法证明受访者独立性','需人工判断实验结果是否达到预设成功和停止条件']};
 }),notice:'只汇总已结案的真实记录；成功与失败条件不由关键字自动裁定'};
}
export function saveDecisionReview(store,id,{assessment,nextStep,revisitAt,reason,expected_revision}={}){
 const item=decisionReviewCenter(store).items.find(x=>x.id===id);
 if(!item)throw fail('NOT_FOUND','结案实验不存在',404);
 if(!['supported','contradicted','inconclusive'].includes(assessment))throw fail('BAD_ASSESSMENT','请选择支持、反驳或证据不足');
 if(!['continue','iterate','stop','recheck'].includes(nextStep))throw fail('BAD_NEXT_STEP','请选择继续、调整、停止或复查');
 const text=String(reason||'').trim().slice(0,1000);
 if(text.length<12)throw fail('REASON_REQUIRED','请写明至少12字的证据判断依据');
 if(revisitAt!==null&&revisitAt!==undefined&&revisitAt!==''){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(revisitAt)||Number.isNaN(Date.parse(revisitAt+'T00:00:00Z'))||new Date(revisitAt+'T00:00:00Z').toISOString().slice(0,10)!==revisitAt)throw fail('BAD_DATE','复查日期必须是有效的 YYYY-MM-DD');
 }
 if(nextStep==='recheck'&&!revisitAt)throw fail('DATE_REQUIRED','安排复查时必须填写复查日期');
 const old=store.get('problem_decision_reviews',id);
 if(expected_revision!==(old?.revision||0))throw fail('REVISION_CONFLICT','决策复盘已更新，请刷新',409);
 const saved=store.put('problem_decision_reviews',{id,problemId:item.problemId,assessment,nextStep,revisitAt:revisitAt||null,reason:text,reviewedAt:new Date().toISOString()},old?.revision||0);
 store.event('problem.decision.reviewed',item.problemId,'owner',{designId:id,assessment,nextStep});
 return saved;
}
