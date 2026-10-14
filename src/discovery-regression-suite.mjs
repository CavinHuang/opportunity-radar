import {createHash} from 'node:crypto';
import {assessRealProblem} from './real-problem.mjs';
import {replayDiscoveryRules} from './discovery-rule-replay.mjs';

const SUITE_ID='real_problem_frozen_regression_suite';
const REVIEW_ID='real_problem_frozen_regression_reviews';
const POLICY_IDS=new Set(['require_workaround','review_promotion_block']);
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hostname=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return 'unknown';}};
const measure=rows=>{
 const tp=rows.filter(x=>x.predicted&&x.label==='real_problem').length;
 const fp=rows.filter(x=>x.predicted&&x.label==='not_problem').length;
 const fn=rows.filter(x=>!x.predicted&&x.label==='real_problem').length;
 const tn=rows.filter(x=>!x.predicted&&x.label==='not_problem').length;
 return {truePositive:tp,falsePositive:fp,falseNegative:fn,trueNegative:tn,
  precision:tp+fp?Number((tp/(tp+fp)).toFixed(4)):null,
  recall:tp+fn?Number((tp/(tp+fn)).toFixed(4)):null};
};
function sampleForFreeze(store){
 const labels=new Map(store.list('discovery_quality_labels').map(x=>[x.id,x]));
 const eligible=store.list('sources').filter(s=>s.id&&s.title&&typeof s.url==='string'&&
  /^https:\/\//i.test(s.url)&&['new','saved'].includes(s.status)).slice(0,400);
 const candidates=eligible.flatMap(s=>{
  const l=labels.get(s.id);
  if(!l||l.sourceRevision!==s.revision||!['real_problem','not_problem'].includes(l.label))return [];
  const text={title:String(s.title).slice(0,2400),description:String(s.description||'').slice(0,2400)};
  return [{sourceId:s.id,sourceRevision:s.revision,labelRevision:l.revision,
   host:hostname(s.url),url:s.url,...text,label:l.label,baseline:assessRealProblem(text).qualified}];
 });
 const groups=new Map();
 for(const row of candidates.sort((a,b)=>a.sourceId.localeCompare(b.sourceId))){
  const key=row.label+'|'+row.host;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 // Alternating labels and hosts prevents one busy site or one class taking the first 100 slots.
 const positive=[...groups.keys()].filter(x=>x.startsWith('real_problem|')).sort();
 const negative=[...groups.keys()].filter(x=>x.startsWith('not_problem|')).sort();
 const rows=[],seen=new Set();
 while(rows.length<100){
  let progress=false;
  for(const keys of [positive,negative]){
   for(const key of keys){
    const row=groups.get(key).shift();
    if(row&&!seen.has(row.sourceId)){rows.push(row);seen.add(row.sourceId);progress=true;}
    if(rows.length>=100)break;
   }
   if(rows.length>=100)break;
  }
  if(!progress)break;
 }
 const counts={total:rows.length,positives:rows.filter(x=>x.label==='real_problem').length,
  negatives:rows.filter(x=>x.label==='not_problem').length,
  hosts:new Set(rows.map(x=>x.host)).size,eligible:candidates.length,
  excludedByCap:Math.max(0,candidates.length-rows.length)};
 return {rows,counts,ready:rows.length>=20&&counts.positives>=5&&counts.negatives>=5&&counts.hosts>=2};
}
export function frozenRegressionSuiteBoard(store){
 const row=store.get('discovery_rule_decisions',SUITE_ID);
 const {counts,ready}=sampleForFreeze(store);
 const snapshots=row?.snapshots||[];
 return {revision:row?.revision||0,snapshots:snapshots.map(s=>({
  revision:s.revision,at:s.at,reason:s.reason,fingerprint:s.fingerprint,counts:s.counts,
  baseline:s.baseline})),latest:snapshots.at(-1)||null,
  candidate:{counts,ready},readOnly:true,productionChanged:false,
  notice:'只冻结Owner已审核且原帖版本相同的公开文本（最多100条），保存在本地SQLite；样本为非随机人工选择，无法估算总体准确率。旧样本永不因来源编辑而重写。'};
}
export function freezeRegressionSuite(store,{reason,expected_revision}={}){
 const note=typeof reason==='string'?reason.trim():'';
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','请输入12–500字的冻结理由');
 const board=frozenRegressionSuiteBoard(store);
 if(expected_revision!==board.revision)throw fail('REVISION_CONFLICT','回归基线已被更新，请刷新',409);
 const input=sampleForFreeze(store);
 if(!input.ready)throw fail('INSUFFICIENT_SAMPLES','冻结至少需要20条有效标注、正负例各5条并覆盖2个来源域名',409);
 const fingerprint=digest({version:1,rows:input.rows});
 if(board.latest?.fingerprint===fingerprint)throw fail('SAME_SNAPSHOT','当前人工标注和原文未改变，不需要重复冻结',409);
 return store.transaction(()=>{
  const latest=frozenRegressionSuiteBoard(store),fresh=sampleForFreeze(store);
  if(latest.revision!==expected_revision||!fresh.ready||
    digest({version:1,rows:fresh.rows})!==fingerprint)throw fail('FROZEN_INPUT_CHANGED','冻结内容或人工标签发生变化，请刷新',409);
  const snapshot={revision:expected_revision+1,at:new Date().toISOString(),reason:note,
   fingerprint,counts:fresh.counts,baseline:measure(fresh.rows.map(x=>({...x,predicted:x.baseline}))),
   records:fresh.rows};
  const saved=store.put('discovery_rule_decisions',{id:SUITE_ID,
   snapshots:[...(store.get('discovery_rule_decisions',SUITE_ID)?.snapshots||[]),snapshot].slice(-20)},expected_revision);
  store.event('discovery.regression_suite.frozen',SUITE_ID,'owner',
   {revision:saved.revision,positive:snapshot.counts.positives,negative:snapshot.counts.negatives,hosts:snapshot.counts.hosts});
  return {revision:saved.revision,snapshot:{...snapshot,records:undefined}};
 });
}
function policyPredict(id,a){
 if(id==='require_workaround')return a.qualified&&a.flags.workaround;
 if(id==='review_promotion_block')return a.flags.actor&&a.flags.task&&a.flags.pain;
 throw fail('BAD_POLICY','未知离线规则');
}
export function replayFrozenRegressionSuite(store,{suiteRevision,policyId='require_workaround'}={}){
 if(!POLICY_IDS.has(policyId))throw fail('BAD_POLICY','未知离线规则');
 const board=frozenRegressionSuiteBoard(store);
 const snapshot=suiteRevision===undefined?board.latest:
  (store.get('discovery_rule_decisions',SUITE_ID)?.snapshots||[]).find(x=>x.revision===suiteRevision);
 if(!snapshot)return {available:false,policyId,liveRuleChanged:false,notice:'还没有可回放的冻结人工基线'};
 const rows=snapshot.records.map(x=>{
  const assessed=assessRealProblem({title:x.title,description:x.description});
  const after=Boolean(policyPredict(policyId,assessed));
  const current=store.get('sources',x.sourceId);
  const stale=!current||current.revision!==x.sourceRevision||
   current.title!==x.title||String(current.description||'')!==x.description;
  return {...x,before:x.baseline,after,currentBaseline:assessed.qualified,
   baselineDrift:assessed.qualified!==x.baseline,sourceDrift:stale};
 });
 const before=measure(rows.map(x=>({...x,predicted:x.before})));
 const trial=measure(rows.map(x=>({...x,predicted:x.after})));
 const changed=rows.filter(x=>x.before!==x.after);
 const baselineDrifts=rows.filter(x=>x.baselineDrift);
 const originalDrifts=rows.filter(x=>x.sourceDrift);
 const newMisses=changed.filter(x=>x.label==='real_problem'&&x.before&&!x.after);
 const newFalsePositives=changed.filter(x=>x.label==='not_problem'&&!x.before&&x.after);
 const rescued=changed.filter(x=>x.label==='real_problem'&&!x.before&&x.after);
 const removed=changed.filter(x=>x.label==='not_problem'&&x.before&&!x.after);
 const cohorts=new Map();
 for(const x of changed){
  if(!cohorts.has(x.host))cohorts.set(x.host,{host:x.host,changed:0,newMisses:0,newFalsePositives:0,rescued:0,removedFalsePositives:0});
  const c=cohorts.get(x.host);c.changed++;
  if(newMisses.includes(x))c.newMisses++;
  if(newFalsePositives.includes(x))c.newFalsePositives++;
  if(rescued.includes(x))c.rescued++;
  if(removed.includes(x))c.removedFalsePositives++;
 }
 const delta={falseNegative:trial.falseNegative-before.falseNegative,
  falsePositive:trial.falsePositive-before.falsePositive};
 const fingerprint=digest({snapshot:snapshot.fingerprint,policyId,baselineDriftIds:baselineDrifts.map(x=>x.sourceId),
  results:rows.map(x=>[x.sourceId,x.after])});
 const verdict=baselineDrifts.length?'baseline_version_drift_do_not_compare':
  newMisses.length||newFalsePositives.length?'observed_regression_do_not_approve':
  changed.length===0?'no_difference_on_frozen_sample':'manual_review_only';
 return {available:true,policyId,suiteRevision:snapshot.revision,suiteFingerprint:snapshot.fingerprint,
  fingerprint,at:snapshot.at,counts:snapshot.counts,before,trial,delta,
  changedCount:changed.length,newMisses:newMisses.length,newFalsePositives:newFalsePositives.length,
  rescued:rescued.length,removedFalsePositives:removed.length,
  baselineDrift:baselineDrifts.length,sourceDrift:originalDrifts.length,
  examples:changed.slice(0,30).map(x=>({sourceId:x.sourceId,host:x.host,url:x.url,title:x.title,
   label:x.label,before:x.before,after:x.after,sourceDrift:x.sourceDrift})),
  changedTruncated:changed.length>30,
  cohorts:[...cohorts.values()].sort((a,b)=>b.newMisses-a.newMisses||b.newFalsePositives-a.newFalsePositives||a.host.localeCompare(b.host)),
  verdict,liveRuleChanged:false,readOnly:true,
  notice:'固定当时的原帖文本和Owner标签反复回放。来源更新不改变旧基线，只显示漂移；如果基础规则实现相较冻结时发生变化则禁止比较。通过离线样本不证明新规则更准确，也不自动审批影子或上线。'};
}
export function frozenRegressionReviewHistory(store){
 const row=store.get('discovery_rule_decisions',REVIEW_ID);
 return {revision:row?.revision||0,records:row?.records||[],latest:row?.records?.at(-1)||null};
}
export function recordFrozenRegressionReview(store,{policy_id='require_workaround',suite_revision,fingerprint,decision,reason,expected_revision}={}){
 if(!['hold_for_more_evidence','reject_trial','recommend_shadow_review'].includes(decision))
  throw fail('BAD_DECISION','请明确选择继续取证、拒绝试验或提请影子评审');
 const note=typeof reason==='string'?reason.trim():'';
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','请输入至少12字的具体复核理由');
 const history=frozenRegressionReviewHistory(store);
 if(history.revision!==expected_revision)throw fail('REVISION_CONFLICT','回归复核记录已更新，请刷新',409);
 const report=replayFrozenRegressionSuite(store,{policyId:policy_id,suiteRevision:suite_revision});
 if(!report.available||report.fingerprint!==fingerprint)throw fail('STALE_REGRESSION','回归内容或规则已改变，请刷新',409);
 if(decision==='recommend_shadow_review'&&
  (policy_id!=='require_workaround'||report.verdict!=='manual_review_only'))
  throw fail('REGRESSION_BLOCKED','只有没有观察到退化、且具备变化样本的既有严格规则可以提请影子复核',409);
 return store.transaction(()=>{
  const newest=frozenRegressionReviewHistory(store);
  const current=replayFrozenRegressionSuite(store,{policyId:policy_id,suiteRevision:suite_revision});
  if(newest.revision!==expected_revision||current.fingerprint!==fingerprint)
   throw fail('STALE_REGRESSION','回归证据或复核历史已变化',409);
  if(newest.latest?.fingerprint===fingerprint&&newest.latest?.decision===decision)
   throw fail('REVIEW_ALREADY_RECORDED','相同证据和意见已归档',409);
  const record={at:new Date().toISOString(),policyId:policy_id,suiteRevision:report.suiteRevision,
   fingerprint,decision,reason:note,verdict:report.verdict,delta:report.delta,
   changedCount:report.changedCount,status:'advisory_only_not_rule_approved'};
  const saved=store.put('discovery_rule_decisions',{id:REVIEW_ID,
   records:[...newest.records,record].slice(-40)},expected_revision);
  store.event('discovery.regression_suite.reviewed',REVIEW_ID,'owner',
   {revision:saved.revision,decision,policyId:policy_id,suiteRevision:report.suiteRevision});
  return {revision:saved.revision,record,liveRuleChanged:false};
 });
}
