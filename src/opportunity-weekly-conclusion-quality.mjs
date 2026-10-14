import {weeklyHypothesisBoard} from './opportunity-weekly-hypotheses.mjs';
import {weeklyResearchPlan} from './opportunity-weekly-plan.mjs';
import {weeklyEvidenceProvenance} from './opportunity-weekly-provenance.mjs';

// Conservative warning signals, never an automatic verdict about user demand.
const payment=/付费|支付|购买|订阅|price|pricing|willing(?:ness)? to pay|revenue|paid|payment/i;
const paymentKinds=new Set(['problem.experiment.result_recorded','opportunity.decision.outcome_recorded']);
const negative=new Set(['stop','contradicted']);
export function weeklyConclusionQualityReview(store,options={}){
 const board=weeklyHypothesisBoard(store,options);
 const plan=weeklyResearchPlan(store,options);
 const provenance=weeklyEvidenceProvenance(store,options);
 const reviewedBySeq=new Map(provenance.events.filter(x=>x.review).map(x=>[x.seq,x.review]));
 const uses=new Map();
 for(const item of board.items)for(const e of item.linkedEvidence){
  const members=uses.get(e.seq)||new Set();members.add(item.candidateId);uses.set(e.seq,members);
 }
 const items=board.items.map(item=>{
  const h=item.hypothesis,linked=item.linkedEvidence,warnings=[];
  if(!h){warnings.push({code:'HYPOTHESIS_MISSING',message:'本任务尚未定义可证伪的研究假设'});}
  else{
   if(!linked.length)warnings.push({code:'NO_LINKED_EVIDENCE',message:'没有当前有效的关联事件，不能据此得出支持或反驳结论'});
   if(item.unavailableEvidenceSeqs.length)warnings.push({code:'MISSING_REFERENCES',message:'部分原先关联的事件不再处于当前可检索范围'});
   if(h.finding!=='unknown'&&linked.some(e=>!reviewedBySeq.has(e.seq)||reviewedBySeq.get(e.seq).classification==='unverified'))
    warnings.push({code:'UNVERIFIED_ORIGIN',message:'部分关联事件缺少原始来源独立性核查'});
   const origins=linked.map(e=>reviewedBySeq.get(e.seq)?.origin).filter(Boolean);
   if(new Set(origins).size<origins.length)
    warnings.push({code:'DUPLICATE_ORIGIN',message:'多条事件指向同一来源，不能作为独立样本累计'});
   if(linked.some(e=>['same_origin','repost'].includes(reviewedBySeq.get(e.seq)?.classification)))
    warnings.push({code:'NONINDEPENDENT_SOURCE',message:'关联事件包含重复来源或转载证据，请人工复核'});
   if(h.finding!=='unknown'){
    if(!linked.some(e=>e.quality==='recorded_observation'))warnings.push({code:'NO_OBSERVATION',message:'结论仅关联活动或人工审核，没有直接观察记录'});
    if(payment.test([h.hypothesis,h.expectedEvidence].join(' '))&&!linked.some(e=>paymentKinds.has(e.kind)))
     warnings.push({code:'PAYMENT_MISMATCH',message:'付费假设尚未关联实验或结果记录；搜索、访谈等事件类型不足以证明实际付款'});
    const opposite=linked.filter(e=>negative.has(String(e.detail?.decision||e.detail?.outcome||'')));
    if(h.finding==='supported'&&opposite.length)warnings.push({code:'COUNTEREVIDENCE',message:'支持结论关联了明确停止或反驳的决策事件，请人工核对'});
   }
   const reused=linked.filter(e=>(uses.get(e.seq)?.size||0)>1);
   if(reused.length)warnings.push({code:'REUSED_EVENT',message:'关联事件被多个候选假设引用，不能算作独立证据',seqs:reused.map(e=>e.seq)});
  }
  return {candidateId:item.candidateId,title:item.title,task:item.task,finding:item.finding,
   linkedCount:linked.length,issues:warnings,assessment:!h?'unanswered':h.finding==='unknown'?'unanswered':warnings.length?'needs_review':'owner_reviewed_no_rule_warning',
   nonIndependentEventCount:linked.filter(e=>(uses.get(e.seq)?.size||0)>1).length};
 });
 const completed=plan.review?.results||[];
 return {weekStart:board.weekStart,planStatus:board.planStatus,items,
  summary:{unanswered:items.filter(x=>x.assessment==='unanswered').length,needsReview:items.filter(x=>x.assessment==='needs_review').length,
   noRuleWarnings:items.filter(x=>x.assessment==='owner_reviewed_no_rule_warning').length,
   markedCompleted:completed.filter(x=>x.status==='completed').length},
  reviewLocked:board.planStatus==='reviewed',marketValidated:false,
  notice:'只检测可识别的证据类型、明确反证及引用重复。无规则警告不等于假设成立或证据真实；人工结论和已归档周复盘均不会自动修改。'};
}
