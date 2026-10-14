import {createHash} from 'node:crypto';
import {assessRealProblem} from './real-problem.mjs';
import {replayFrozenRegressionSuite,frozenRegressionReviewHistory} from './discovery-regression-suite.mjs';

const ID='real_problem_frozen_regression_suite';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\\./,'')}catch{return null;}};
const allowed='require_workaround';
const sorted=(rows)=>rows.sort((a,b)=>String(a.sourceId).localeCompare(String(b.sourceId)));

function newReviewedHoldout(store,snapshot,policyId){
 const frozen=new Set(snapshot?.records?.map(x=>x.sourceId)||[]);
 const freezeAt=Date.parse(snapshot?.at||'');
 const labels=new Map(store.list('discovery_quality_labels').map(x=>[x.id,x]));
 const candidates=store.list('sources').filter(s=>s.id&&s.title&&['new','saved'].includes(s.status)&&
  typeof s.url==='string'&&/^https:\/\//i.test(s.url)).slice(0,400);
 const usedUrls=new Set(),usedSources=new Set(),rows=[];
 let updatedOrUnconfirmed=0,oldLabels=0,duplicateUrls=0;
 for(const s of candidates){
  if(frozen.has(s.id)||usedSources.has(s.id))continue;
  const l=labels.get(s.id);
  if(!l)continue;
  const at=Date.parse(l.at||'');
  if(!Number.isFinite(at)||!Number.isFinite(freezeAt)||at<=freezeAt){oldLabels++;continue;}
  if(l.sourceRevision!==s.revision||!['real_problem','not_problem'].includes(l.label)){
   updatedOrUnconfirmed++;continue;
  }
  const origin=host(s.url);
  if(!origin){updatedOrUnconfirmed++;continue;}
  // A second record of the same URL is not new independent evidence.
  const normalized=new URL(s.url);normalized.hash='';normalized.search='';
  const urlKey=normalized.href;
  if(usedUrls.has(urlKey)){duplicateUrls++;continue;}
  usedUrls.add(urlKey);usedSources.add(s.id);
  const assessed=assessRealProblem(s);
  const before=assessed.qualified;
  const after=policyId==='require_workaround'?before&&assessed.flags.workaround:
   assessed.flags.actor&&assessed.flags.task&&assessed.flags.pain;
  rows.push({sourceId:s.id,sourceRevision:s.revision,labelRevision:l.revision,
   label:l.label,labelAt:l.at,url:urlKey,host:origin,title:s.title,
   description:String(s.description||''),before,after:Boolean(after)});
 }
 const samples=sorted(rows);
 const positive=samples.filter(x=>x.label==='real_problem');
 const negative=samples.filter(x=>x.label==='not_problem');
 const newMisses=positive.filter(x=>x.before&&!x.after);
 const newFalsePositives=negative.filter(x=>!x.before&&x.after);
 const removedFalsePositives=negative.filter(x=>x.before&&!x.after);
 const rescued=positive.filter(x=>!x.before&&x.after);
 const count={reviewed:samples.length,positive:positive.length,negative:negative.length,
  hosts:new Set(samples.map(x=>x.host)).size,newMisses:newMisses.length,
  newFalsePositives:newFalsePositives.length,removedFalsePositives:removedFalsePositives.length,
  rescued:rescued.length,labelsBeforeFreeze:oldLabels,staleOrUncertain:updatedOrUnconfirmed,
  duplicateUrls};
 return {count,fingerprint:hash({policyId,suite:snapshot?.fingerprint||null,rows:samples}),
  // Do not send full frozen/current post bodies in a dashboard or release response.
  examples:samples.filter(x=>x.before!==x.after).slice(0,15).map(x=>({
   sourceId:x.sourceId,host:x.host,label:x.label,before:x.before,after:x.after,url:x.url,title:x.title})),
  note:'这里的“新证据”仅指冻结后新标注、未包含于冻结集、且URL去重的帖子。两个站点不是两个独立用户；人工标注不是身份真实性证明。'};
}

export function frozenRegressionReleaseGate(store,policyId=allowed){
 const snapshots=store.get('discovery_rule_decisions',ID)?.snapshots||[];
 const latest=snapshots.at(-1)||null;
 const report=replayFrozenRegressionSuite(store,{policyId});
 const review=frozenRegressionReviewHistory(store).latest;
 const holdout=newReviewedHoldout(store,latest,policyId);
 const count=holdout.count;
 const checks={
  supportedPolicy:policyId===allowed,
  frozenSuitePresent:Boolean(latest&&latest.records?.length>=20&&latest.counts?.positives>=5&&latest.counts?.negatives>=5&&latest.counts?.hosts>=2),
  noFrozenRegression:Boolean(report.available&&report.verdict==='manual_review_only'&&report.newMisses===0&&report.newFalsePositives===0&&report.baselineDrift===0),
  frozenOwnerReviewed:Boolean(latest&&report.available&&review?.policyId===policyId&&review.suiteRevision===latest.revision&&
   review.fingerprint===report.fingerprint&&review.decision==='recommend_shadow_review'),
  newlyReviewedAtLeast6:count.reviewed>=6,
  newPositivesAtLeast2:count.positive>=2,
  newNegativesAtLeast2:count.negative>=2,
  newReviewAcross2Hosts:count.hosts>=2,
  noNewEvidenceRegression:count.newMisses===0&&count.newFalsePositives===0
 };
 const blockers=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
 const evidence={policyId,suiteRevision:latest?.revision||null,suiteFingerprint:latest?.fingerprint||null,
  replayFingerprint:report.available?report.fingerprint:null,
  reviewedAt:review?.at||null,reviewDecision:review?.decision||null,
  holdoutFingerprint:holdout.fingerprint,holdoutCounts:count};
 return {ready:blockers.length===0,checks,blockers,evidence,evidenceHash:hash(evidence),
  suite:{revision:latest?.revision||null,count:latest?.counts?.total||0,
   fingerprint:latest?.fingerprint||null,verdict:report.verdict||'not_available',
   newMisses:report.available?report.newMisses:null,
   newFalsePositives:report.available?report.newFalsePositives:null,
   baselineDrift:report.available?report.baselineDrift:null},
  latestReview:{decision:review?.decision||null,at:review?.at||null},
  fresh:{...count,examples:holdout.examples,note:holdout.note},
  readOnly:true,productionChanged:false,
  notice:'仅允许对已冻结人工样本完成无已知退化回放，并用冻结后、未出现在旧样本中、URL去重的至少6条新人工标注原帖复核；其中正负各2条、来源域名至少2个。不证明独立用户或总体准确率。仍需原有规则审批、来源影响签收、影子评估和发布前验收。'};
}
export function frozenRegressionTrend(store,policyId=allowed){
 const snapshots=store.get('discovery_rule_decisions',ID)?.snapshots||[];
 const versions=snapshots.map((s,i)=>{
  const r=replayFrozenRegressionSuite(store,{suiteRevision:s.revision,policyId});
  const earlier=i?snapshots[i-1]:null;
  return {revision:s.revision,at:s.at,fingerprint:s.fingerprint,
   samples:s.counts?.total||0,positive:s.counts?.positives||0,
   negative:s.counts?.negatives||0,hosts:s.counts?.hosts||0,
   baselinePrecision:r.before?.precision??null,baselineRecall:r.before?.recall??null,
   trialPrecision:r.trial?.precision??null,trialRecall:r.trial?.recall??null,
   changed:r.changedCount||0,newMisses:r.newMisses||0,newFalsePositives:r.newFalsePositives||0,
   removedFalsePositives:r.removedFalsePositives||0,sourceDrift:r.sourceDrift||0,
   baselineDrift:r.baselineDrift||0,verdict:r.verdict||'not_available',
   comparableWithPrevious:Boolean(earlier&&earlier.fingerprint===s.fingerprint),
   comparisonNote:!earlier?'首个冻结基线':earlier.fingerprint===s.fingerprint?
    '完全相同冻结语料，仅可比较固定样本上的规则预测':'样本内容或标签变化，不可将两个版本指标差异解读为规则质量改善'};
 });
 // Both policies replay against exactly the same latest frozen corpus.
 const latest=snapshots.at(-1)||null;
 const sameCorpus=latest?['require_workaround','review_promotion_block'].map(policyId=>{
  const r=replayFrozenRegressionSuite(store,{suiteRevision:latest.revision,policyId});
  return {policyId,revision:latest.revision,fingerprint:r.suiteFingerprint,
   baselinePrecision:r.before.precision,trialPrecision:r.trial.precision,
   baselineRecall:r.before.recall,trialRecall:r.trial.recall,
   newMisses:r.newMisses,newFalsePositives:r.newFalsePositives,
   removedFalsePositives:r.removedFalsePositives,changed:r.changedCount,verdict:r.verdict};
 }):[];
 return {policyId,versions,sameCorpus,latestSuiteRevision:latest?.revision||null,
  releaseGate:frozenRegressionReleaseGate(store,policyId),
  readOnly:true,productionChanged:false,
  notice:'跨冻结版本图表只显示各版本独立结果，版本样本一旦不同就禁止计算环比准确率；同一冻结版本内可横向比较不同规则。标注为选择性人工样本，不代表生产总体质量或新增真实用户。'};
}
