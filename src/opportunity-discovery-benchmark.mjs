import {createHash} from 'node:crypto';
import {opportunityScanCandidates} from './opportunity-scan.mjs';
import {assessRealProblem} from './real-problem.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const key='real_problem_discovery_quality_benchmark';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rate=(numerator,denominator)=>denominator?Number((numerator/denominator).toFixed(4)):null;
const counts=rows=>{
 const tp=rows.filter(x=>x.predicted&&x.label==='real_problem').length;
 const fp=rows.filter(x=>x.predicted&&x.label==='not_problem').length;
 const fn=rows.filter(x=>!x.predicted&&x.label==='real_problem').length;
 const tn=rows.filter(x=>!x.predicted&&x.label==='not_problem').length;
 return {truePositive:tp,falsePositive:fp,falseNegative:fn,trueNegative:tn,
  precision:rate(tp,tp+fp),recall:rate(tp,tp+fn),falsePositiveRate:rate(fp,fp+tn)};
};
export function opportunityDiscoveryBenchmark(store){
 const sources=store.list('sources').filter(s=>['new','saved'].includes(s.status)&&s.id&&s.title&&/^https:\/\//i.test(s.url));
 const window=sources.slice(0,400),eligible=new Set(window.map(s=>s.id));
 const scan=opportunityScanCandidates(store,{limit:50,maxSignals:400});
 const surfaced=new Map();
 for(const c of scan.items)for(const id of c.problemEvidence?.qualifiedSignals||[])
  if(!surfaced.has(id))surfaced.set(id,{candidateId:c.id,priority:c.priority});
 const fresh=[],stale=[],outOfWindow=[],uncertain=[];
 for(const label of store.list('discovery_quality_labels')){
  if(!['real_problem','not_problem','uncertain'].includes(label.label))continue;
  const source=store.get('sources',label.id);
  if(!source||source.revision!==label.sourceRevision){stale.push(label.id);continue;}
  if(!eligible.has(label.id)){outOfWindow.push(label.id);continue;}
  if(label.label==='uncertain'){uncertain.push(label.id);continue;}
  const hit=surfaced.get(label.id);
  fresh.push({sourceId:label.id,title:source.title,url:source.url,label:label.label,
   sourceRevision:source.revision,labelRevision:label.revision,
   predicted:Boolean(hit),candidateId:hit?.candidateId||null,
   ruleQualified:assessRealProblem(source).qualified,
   missReason:hit?null:assessRealProblem(source).qualified?'未进入前50条候选或在聚合/排序中丢失':'原始问题门槛未通过'});
 }
 fresh.sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 const trialScan=opportunityScanCandidates(store,{limit:50,maxSignals:400,descriptionFallback:true});
 const trialVisible=new Set(trialScan.items.flatMap(item=>item.problemEvidence?.qualifiedSignals||[]));
 const trialRows=fresh.map(row=>({...row,predicted:trialVisible.has(row.sourceId)}));
 const trialMetric=counts(trialRows);
 const rescued=fresh.filter(row=>row.label==='real_problem'&&!row.predicted&&trialVisible.has(row.sourceId))
  .map(row=>({sourceId:row.sourceId,title:row.title,url:row.url}));
 const addedFalsePositives=fresh.filter(row=>row.label==='not_problem'&&!row.predicted&&trialVisible.has(row.sourceId))
  .map(row=>({sourceId:row.sourceId,title:row.title,url:row.url}));
 const lostTruePositives=fresh.filter(row=>row.label==='real_problem'&&row.predicted&&!trialVisible.has(row.sourceId))
  .map(row=>({sourceId:row.sourceId,title:row.title,url:row.url}));
 const recallTrial={id:'description_fallback_trial',liveRuleChanged:false,baseline:counts(fresh),
  trial:trialMetric,rescued:rescued.slice(0,25),addedFalsePositives:addedFalsePositives.slice(0,25),
  lostTruePositives:lostTruePositives.slice(0,25),
  delta:{falseNegative:trialMetric.falseNegative-counts(fresh).falseNegative,
   falsePositive:trialMetric.falsePositive-counts(fresh).falsePositive},
  recommendation:!fresh.length?'insufficient_labels':
   addedFalsePositives.length||lostTruePositives.length?'review_regressions_do_not_apply':
   rescued.length?'manual_review_required':'no_observed_recall_gain',
  caveat:'同一批当前人工标注样本对比生产候选前50与离线候选前50。标题词数不足时允许使用描述补足，绝不绕过真实问题门槛。样本有选择偏差，不自动发布。'};
 const diversityScan=opportunityScanCandidates(store,{limit:50,maxSignals:400,sourceDiversityTrial:true});
 const diversityVisible=new Set(diversityScan.items.flatMap(x=>x.problemEvidence?.qualifiedSignals||[]));
 const diversityRows=fresh.map(x=>({...x,predicted:diversityVisible.has(x.sourceId)}));
 const diversityMetric=counts(diversityRows);
 const diversityRescued=fresh.filter(x=>x.label==='real_problem'&&!x.predicted&&diversityVisible.has(x.sourceId));
 const diversityLost=fresh.filter(x=>x.label==='real_problem'&&x.predicted&&!diversityVisible.has(x.sourceId));
 const diversityAddedFalsePositives=fresh.filter(x=>x.label==='not_problem'&&!x.predicted&&diversityVisible.has(x.sourceId));
 const diversityTrial={id:'source_diversity_trial',liveRuleChanged:false,trial:diversityMetric,
  rescued:diversityRescued.slice(0,25),lostTruePositives:diversityLost.slice(0,25),
  addedFalsePositives:diversityAddedFalsePositives.slice(0,25),
  recommendation:!fresh.length?'insufficient_labels':diversityLost.length||diversityAddedFalsePositives.length?'review_regressions_do_not_apply':diversityRescued.length?'manual_review_required':'no_observed_recall_gain',
  caveat:'仅按候选首个来源域名轮询分配前50名复核位置；同域名不等于同用户，同样本上的提升不代表总体召回。生产排序保持不变。'};
 const metric=counts(fresh);
 const missed=fresh.filter(x=>x.label==='real_problem'&&!x.predicted);
 const falsePositives=fresh.filter(x=>x.label==='not_problem'&&x.predicted);
 const matched=fresh.filter(x=>x.label==='real_problem'&&x.predicted);
 const evidenceFingerprint=hash(fresh.map(x=>[x.sourceId,x.sourceRevision,x.labelRevision,x.label,x.predicted,x.candidateId]));
 return {metric,reviewed:fresh.length,positiveLabeled:fresh.filter(x=>x.label==='real_problem').length,
  negativeLabeled:fresh.filter(x=>x.label==='not_problem').length,uncertain:uncertain.length,
  stale:stale.length,outOfWindow:outOfWindow.length,examined:scan.examined,topCandidateLimit:50,
  candidateCount:scan.items.length,missed:missed.slice(0,30),falsePositives:falsePositives.slice(0,30),
  matched:matched.slice(0,15),recallTrial,diversityTrial,evidenceFingerprint,generatedAt:new Date().toISOString(),
  policy:'current_version_owner_labels_top50_candidate_visibility',
  notice:'只评估400条已收录来源窗口内，人工标注且原帖版本未变的帖子是否进入前50条机会候选；漏报可能是门槛、聚合或榜单截断造成。标注不是随机样本，指标不能推断总体表现或商业价值。'};
}
export function opportunityBenchmarkHistory(store){
 const x=store.get('discovery_rule_decisions',key);
 return {revision:x?.revision||0,snapshots:x?.snapshots||[],latest:x?.snapshots?.at(-1)||null};
}
export function captureOpportunityBenchmark(store,{reason,expected_revision}={}){
 const note=String(reason||'').trim();
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','需要12至500字的评估说明');
 const history=opportunityBenchmarkHistory(store);
 if(expected_revision!==history.revision)throw fail('REVISION_CONFLICT','评估版本已变化，请刷新',409);
 const report=opportunityDiscoveryBenchmark(store);
 if(!report.reviewed)throw fail('NO_REVIEWED_SAMPLES','没有当前版本的可用人工标注样本',409);
 const previous=history.latest;
 const comparable=Boolean(previous&&previous.evidenceFingerprint===report.evidenceFingerprint);
 const entry={at:new Date().toISOString(),reason:note,evidenceFingerprint:report.evidenceFingerprint,
  metric:report.metric,reviewed:report.reviewed,stale:report.stale,outOfWindow:report.outOfWindow,
  comparison:comparable?{precisionDelta:report.metric.precision===null||previous.metric.precision===null?null:report.metric.precision-previous.metric.precision,
   recallDelta:report.metric.recall===null||previous.metric.recall===null?null:report.metric.recall-previous.metric.recall}:null,
  note:comparable?'相同来源标签和预测快照，不代表总体改善':'与上一快照标注或候选不同，不可直接比较质量变化'};
 return store.transaction(()=>{
  // Recompute inside the same transaction so the saved fingerprint is not stale.
  if(opportunityDiscoveryBenchmark(store).evidenceFingerprint!==report.evidenceFingerprint)
   throw fail('EVIDENCE_CHANGED','评估证据已变化',409);
  const saved=store.put('discovery_rule_decisions',{id:key,snapshots:[...history.snapshots,entry].slice(-40)},expected_revision);
  store.event('discovery.benchmark.recorded',key,'owner',{revision:saved.revision,reviewed:entry.reviewed});
  return {revision:saved.revision,entry};
 });
}
