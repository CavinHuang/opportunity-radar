import {createHash} from 'node:crypto';
import {assessRealProblem} from './real-problem.mjs';
import {ruleTrialLedger} from './discovery-rule-approval.mjs';

const ID='real_problem_source_trial_audit';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hostname=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return 'unknown'}};
const policies={
 require_workaround:r=>r.qualified&&r.flags.workaround,
 review_promotion_block:r=>r.flags.actor&&r.flags.task&&r.flags.pain
};
const N=40;
export function sourceTrialImpactReport(store,{policyId='require_workaround'}={}){
 const variant=policies[policyId];
 if(!variant)throw fail('BAD_POLICY','未知离线策略');
 const approval=ruleTrialLedger(store);
 const active=store.list('sources').filter(s=>['new','saved'].includes(s.status)&&s.id&&s.title&&
  typeof s.url==='string'&&/^https:\/\//i.test(s.url)).slice(0,400);
 const labels=new Map(store.list('discovery_quality_labels').map(l=>[l.id,l]));
 const cohorts=new Map(),changed=[],fingerprintItems=[];
 let reviewed=0,changedReviewed=0,unreviewedChanges=0,stale=0,uncertain=0,regressedMisses=0,regressedFalsePositives=0,removedFalsePositives=0,rescuedTruePositives=0;
 const domainsReviewed=new Set();
 for(const s of active){
  const domain=hostname(s.url);
  if(!cohorts.has(domain))cohorts.set(domain,{host:domain,examined:0,reviewed:0,changed:0,changedReviewed:0,unreviewedChanges:0,newMisses:0,newFalsePositives:0,removedFalsePositives:0,rescuedTruePositives:0});
  const cohort=cohorts.get(domain);
  const label=labels.get(s.id),fresh=Boolean(label&&label.sourceRevision===s.revision);
  const verdict=fresh&&['real_problem','not_problem'].includes(label.label)?label.label:null;
  if(label&&!fresh)stale++;
  if(fresh&&label.label==='uncertain')uncertain++;
  const original=assessRealProblem(s),before=original.qualified,after=Boolean(variant(original));
  fingerprintItems.push([s.id,s.revision,s.url,s.title,s.description,label?.revision||0,label?.sourceRevision||0,label?.label||null,before,after]);
  cohort.examined++;
  if(verdict){reviewed++;cohort.reviewed++;domainsReviewed.add(domain);}
  if(before===after)continue;
  cohort.changed++;
  const item={sourceId:s.id,title:s.title,url:s.url,host:domain,before,after,
   ownerLabel:verdict,reviewState:verdict?'current_label':label&&!fresh?'stale_label':fresh?'uncertain_label':'unreviewed'};
  changed.push(item);
  if(!verdict){unreviewedChanges++;cohort.unreviewedChanges++;continue;}
  changedReviewed++;cohort.changedReviewed++;
  if(verdict==='real_problem'&&before&&!after){regressedMisses++;cohort.newMisses++;}
  if(verdict==='real_problem'&&!before&&after){rescuedTruePositives++;cohort.rescuedTruePositives++;}
  if(verdict==='not_problem'&&!before&&after){regressedFalsePositives++;cohort.newFalsePositives++;}
  if(verdict==='not_problem'&&before&&!after){removedFalsePositives++;cohort.removedFalsePositives++;}
 }
 const checks={
  supportedGrayPolicy:policyId==='require_workaround',
  trialApproved:approval.selectedTrial===policyId,
  reviewedAtLeast20:reviewed>=20,
  reviewedAcross2Hosts:domainsReviewed.size>=2,
  realObservedChange:changed.length>0,
  everyChangedPostReviewed:unreviewedChanges===0,
  noNewMisses:regressedMisses===0,
  noNewFalsePositives:regressedFalsePositives===0
 };
 const blockers=Object.keys(checks).filter(k=>!checks[k]);
 const fingerprint=hash({policyId,approvalRevision:approval.revision,selectedTrial:approval.selectedTrial,
  active:fingerprintItems.sort((a,b)=>String(a[0]).localeCompare(String(b[0])))});
 return {policyId,approvalRevision:approval.revision,readOnly:true,liveRuleChanged:false,window:active.length,
  reviewed,reviewedHostCount:domainsReviewed.size,changedCount:changed.length,changedReviewed,unreviewedChanges,stale,uncertain,
  delta:{falseNegative:regressedMisses-rescuedTruePositives,falsePositive:regressedFalsePositives-removedFalsePositives},
  regression:{newMisses:regressedMisses,newFalsePositives:regressedFalsePositives,removedFalsePositives,rescuedTruePositives},
  checks,blockers,readyForOwnerSignoff:blockers.length===0,fingerprint,
  cohorts:[...cohorts.values()].filter(c=>c.changed).sort((a,b)=>b.newMisses-a.newMisses||b.newFalsePositives-a.newFalsePositives||b.unreviewedChanges-a.unreviewedChanges||a.host.localeCompare(b.host)).slice(0,N),
  changedExamples:changed.slice(0,50),changedExamplesTruncated:changed.length>50,
  notice:'同一批最多400条活跃原帖，对比基础规则与候选规则的原帖资格，不等于榜单前50展示效果。审核标签必须与来源版本一致。人工选择性标注不能估计总体准确率、独立用户或商业价值；只有已批准的 require_workaround 可以进入既有1–5%灰度流程。所有结论均需Owner人工复核。'};
}
export function sourceTrialAuditHistory(store){
 const r=store.get('discovery_rule_decisions',ID);
 return {revision:r?.revision||0,records:r?.records||[],latest:r?.records?.at(-1)||null,liveRuleChanged:false};
}
export function signSourceTrialAudit(store,{policy_id='require_workaround',fingerprint,reason,expected_revision}={}){
 const note=typeof reason==='string'?reason.trim():'';
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','请填写12到500字的人工检查依据');
 const history=sourceTrialAuditHistory(store),report=sourceTrialImpactReport(store,{policyId:policy_id});
 if(history.revision!==expected_revision)throw fail('REVISION_CONFLICT','审核历史已更新，请刷新',409);
 if(!report.readyForOwnerSignoff)throw fail('SOURCE_TRIAL_BLOCKED','来源级核查未满足条件：'+report.blockers.join(','),409);
 if(report.fingerprint!==fingerprint)throw fail('STALE_SOURCE_TRIAL','来源或人工标签已经变化，请刷新',409);
 return store.transaction(()=>{
  const latest=sourceTrialImpactReport(store,{policyId:policy_id});
  if(latest.fingerprint!==fingerprint||!latest.readyForOwnerSignoff)throw fail('STALE_SOURCE_TRIAL','来源及审核状态已变化',409);
  const snapshot={policyId:policy_id,fingerprint:latest.fingerprint,at:new Date().toISOString(),reason:note,
   approvalRevision:latest.approvalRevision,window:latest.window,reviewed:latest.reviewed,
   reviewedHostCount:latest.reviewedHostCount,changedCount:latest.changedCount,
   changedReviewed:latest.changedReviewed,delta:latest.delta,status:'source_trial_reviewed_not_released'};
  const saved=store.put('discovery_rule_decisions',{id:ID,records:[...history.records,snapshot].slice(-40)},expected_revision);
  store.event('discovery.source_trial.reviewed',ID,'owner',{revision:saved.revision,policyId:policy_id,changed:latest.changedCount});
  return {revision:saved.revision,snapshot,liveRuleChanged:false};
 });
}
// Fail closed: authorization is tied to the exact source contents, label revisions,
// selected policy and its approval. A new post, edited post, or label invalidates the signoff.
export function sourceTrialReleaseGate(store,policyId='require_workaround'){
 const report=sourceTrialImpactReport(store,{policyId});
 const signed=sourceTrialAuditHistory(store).latest;
 const cleared=report.readyForOwnerSignoff&&signed?.policyId===policyId&&signed.fingerprint===report.fingerprint;
 return {cleared:Boolean(cleared),reason:!report.readyForOwnerSignoff?'SOURCE_TRIAL_BLOCKED':
  !signed?'SOURCE_TRIAL_NOT_SIGNED':signed.fingerprint!==report.fingerprint?'SOURCE_TRIAL_STALE':'ready',
  report,signedAt:signed?.at||null};
}
