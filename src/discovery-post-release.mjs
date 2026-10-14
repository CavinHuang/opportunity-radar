import {createHash} from 'node:crypto';
import {assessRealProblem} from './real-problem.mjs';
import {productionRuleStatus,selectProductionProblem} from './discovery-production-release.mjs';

const digest=obj=>createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return 'unknown'}};
const since=value=>{const ms=Date.parse(value||'');return Number.isFinite(ms)?ms:null;};
const count=row=>row.length;
const bounded=items=>items.slice(0,20).map(x=>({
 sourceId:x.sourceId,host:x.host,url:x.url,title:x.title,label:x.label,
 baseline:x.baseline,production:x.production,reviewedAt:x.reviewedAt
}));

/**
 * A read-only, release-scoped assessment. New means the Owner's label timestamp
 * is strictly AFTER this release event, NOT an independent user or a new post.
 * The exposure cohort is deterministic and cannot be inferred from a label alone.
 */
export function postReleaseEvidenceReport(store,{limit=400}={}){
 if(!Number.isInteger(limit)||limit<1||limit>400)
  throw Object.assign(new Error('最多检查400条来源'),{code:'BAD_LIMIT',status:400});
 const release=productionRuleStatus(store);
 const releaseEvent=[...release.history].reverse().find(x=>x.action==='release')||null;
 const latestEvent=release.history.at(-1)||null;
 const active=Boolean(release.policyId&&releaseEvent&&latestEvent?.action==='release');
 const launchAt=since(releaseEvent?.at);
 const preflight=store.get('discovery_rule_decisions','real_problem_release_preflight');
 const pinned=preflight?.records?.findLast(x=>x.evidenceHash===releaseEvent?.evidenceHash)||null;
 const identity=Boolean(releaseEvent?.evidenceHash&&pinned&&
  pinned.policyId===releaseEvent.policyId&&launchAt!==null);
 const baseline=identity?{
  preflightEvidenceHash:releaseEvent.evidenceHash,
  frozenSuiteRevision:pinned.frozenRegressionEvidence?.suiteRevision??null,
  frozenSuiteFingerprint:pinned.frozenRegressionEvidence?.suiteFingerprint??null,
  frozenHoldoutFingerprint:pinned.frozenRegressionEvidence?.holdoutFingerprint??null,
  sourceTrialFingerprint:pinned.sourceTrialFingerprint??null,
  preflightCapturedAt:pinned.capturedAt||null
 }:null;
 const totals={examined:0,exposed:0,exposureChanged:0,
  reviewedSinceRelease:0,exposedReviewedSinceRelease:0,changedReviewedSinceRelease:0,
  newMisses:0,newFalsePositives:0,removedFalsePositives:0,rescuedTruePositives:0,
  staleLabels:0,labelsWithoutTimestamp:0,reviewedBeforeOrAtRelease:0};
 const changed=[],cohorts=new Map(),included=new Set();
 if(active&&launchAt!==null){
  const labels=new Map(store.list('discovery_quality_labels').map(x=>[x.id,x]));
  const sources=store.list('sources').filter(s=>['new','saved'].includes(s.status)&&s.id&&s.title&&
   typeof s.url==='string'&&/^https:\/\//i.test(s.url)).slice(0,limit);
  for(const s of sources){
   if(included.has(s.id))continue;included.add(s.id);totals.examined++;
   const base=assessRealProblem(s),live=selectProductionProblem(store,s);
   const exposure=live.productionVariant!=='real_problem_v1';
   if(exposure)totals.exposed++;
   const different=exposure&&base.qualified!==live.qualified;
   if(different)totals.exposureChanged++;
   const label=labels.get(s.id);
   if(!label)continue;
   if(label.sourceRevision!==s.revision||!['real_problem','not_problem'].includes(label.label)){
    totals.staleLabels++;continue;
   }
   const labelTime=since(label.at);
   if(labelTime===null){totals.labelsWithoutTimestamp++;continue;}
   if(labelTime<=launchAt){totals.reviewedBeforeOrAtRelease++;continue;}
   totals.reviewedSinceRelease++;
   if(!exposure)continue;
   totals.exposedReviewedSinceRelease++;
   if(!different)continue;
   totals.changedReviewedSinceRelease++;
   const h=host(s.url);
   if(!cohorts.has(h))cohorts.set(h,{host:h,changedReviewed:0,newMisses:0,newFalsePositives:0,
    removedFalsePositives:0,rescuedTruePositives:0});
   const cohort=cohorts.get(h);cohort.changedReviewed++;
   const row={sourceId:s.id,host:h,title:s.title,url:s.url,label:label.label,
    baseline:base.qualified,production:live.qualified,reviewedAt:label.at};
   if(label.label==='real_problem'&&base.qualified&&!live.qualified){
    totals.newMisses++;cohort.newMisses++;
   }else if(label.label==='not_problem'&&!base.qualified&&live.qualified){
    totals.newFalsePositives++;cohort.newFalsePositives++;
   }else if(label.label==='not_problem'&&base.qualified&&!live.qualified){
    totals.removedFalsePositives++;cohort.removedFalsePositives++;
   }else if(label.label==='real_problem'&&!base.qualified&&live.qualified){
    totals.rescuedTruePositives++;cohort.rescuedTruePositives++;
   }
   changed.push(row);
  }
 }
 const regression=totals.newMisses>0||totals.newFalsePositives>0;
 const status=!releaseEvent?'no_release_record':
  !release.policyId?'rolled_back':
  !active?'release_state_unverified':
  !identity?'unverified_launch_baseline':
  regression?'confirmed_post_release_regression':
  !totals.changedReviewedSinceRelease?'awaiting_post_release_review':'no_known_post_release_regression';
 const evidenceHash=digest({
  releaseRevision:release.revision,launchAt:releaseEvent?.at||null,releaseHash:releaseEvent?.evidenceHash||null,
  status,totals,
  changed:changed.map(x=>[x.sourceId,x.reviewedAt,x.label,x.baseline,x.production]),
  baseline
 });
 return {status,active,releaseRevision:release.revision,policyId:release.policyId,
  lastPublishedPolicyId:releaseEvent?.policyId||null,percentage:release.percentage,
  launchAt:releaseEvent?.at||null,baselineVerified:identity,baseline,
  totals,regression,autoRollbackRecommended:active&&regression,
  changedExamples:bounded(changed),changedTruncated:changed.length>20,
  cohorts:[...cohorts.values()].sort((a,b)=>b.newMisses-a.newMisses||
   b.newFalsePositives-a.newFalsePositives||a.host.localeCompare(b.host)).slice(0,30),
  evidenceHash,readOnly:true,liveRuleChanged:false,
  notice:'仅对本次发布哈希桶中实际受控的来源计算影响。发布后的新证据指人工在发布时刻之后更新的有效来源标签，不是新用户或随机实验；未标注及未暴露来源不能视为通过。发现人工确认的新增漏报/误报则建议回滚；没有观察到退化不能证明准确率改善。'};
}
