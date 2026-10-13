import {assessRealProblem} from './real-problem.mjs';
import {replayDiscoveryRules} from './discovery-rule-replay.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function labelDiscoveryExample(store,sourceId,{label,reason,expected_revision}={}){
 const s=store.get('sources',sourceId);if(!s)throw fail('SOURCE_NOT_FOUND','原始线索不存在',404);
 if(!['real_problem','not_problem','uncertain'].includes(label))throw fail('BAD_LABEL','请选择真实问题、非问题或不确定');
 const note=String(reason||'').trim().slice(0,600);if(note.length<8)throw fail('REASON_REQUIRED','人工标注理由至少8字');
 const prev=store.get('discovery_quality_labels',sourceId);if(expected_revision!==(prev?.revision||0))throw fail('REVISION_CONFLICT','标注已更新，请刷新',409);
 const row=store.put('discovery_quality_labels',{id:sourceId,label,reason:note,sourceRevision:s.revision,at:new Date().toISOString()},prev?.revision||0);
 store.event('discovery.quality.labeled',sourceId,'owner',{label,revision:row.revision});return row;
}
/** Review both predicted positives and rejected posts so missed problems remain visible.
 * This is a deterministic review queue, not a statistically random evaluation set. */
export function discoveryReviewSample(store,{limit=10}={}){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('BAD_LIMIT','标注样本数必须为 1–100');
 const labeled=new Set(store.list('discovery_quality_labels').map(x=>x.id));
 const sources=store.list('sources').filter(s=>s.id&&s.title&&!labeled.has(s.id));
 const groups={predictedPositive:[],predictedNegative:[]};
 for(const s of sources){
  const rule=assessRealProblem(s);
  const item={sourceId:s.id,title:s.title,url:s.url,predicted:rule.qualified};
  groups[rule.qualified?'predictedPositive':'predictedNegative'].push(item);
 }
 // Stable ordering avoids arrival-order bias and prevents the same sample jumping on refresh.
 const stable=(a,b)=>a.sourceId.localeCompare(b.sourceId);
 groups.predictedPositive.sort(stable);groups.predictedNegative.sort(stable);
 const items=[],seen=new Set();
 // Alternate strata whenever possible. Negative predictions are intentionally sampled:
 // only reviewing accepted posts makes false negatives invisible.
 let turn=0;
 while(items.length<limit&&(groups.predictedPositive.length||groups.predictedNegative.length)){
  const first=turn++%2?'predictedPositive':'predictedNegative';
  const second=first==='predictedPositive'?'predictedNegative':'predictedPositive';
  const item=groups[first].shift()||groups[second].shift();
  if(item&&!seen.has(item.sourceId)){seen.add(item.sourceId);items.push(item);}
 }
 return {items,remainingUnlabeled:sources.length,samplePolicy:'balanced_deterministic_review_queue_not_random_sample'};
}
export function discoveryQualityReport(store,{limit=60}={}){
 const labels=store.list('discovery_quality_labels').sort((a,b)=>(b.at||'').localeCompare(a.at||''));
 const rows=labels.map(l=>{const s=store.get('sources',l.id);if(!s)return null;const rule=assessRealProblem(s);return {sourceId:l.id,title:s.title,url:s.url,label:l.label,reason:l.reason,revision:l.revision,stale:l.sourceRevision!==s.revision,predicted:rule.qualified,blockers:rule.blockers};}).filter(Boolean);
 const eligible=rows.filter(x=>!x.stale&&x.label!=='uncertain');
 const tp=eligible.filter(x=>x.predicted&&x.label==='real_problem').length;
 const fp=eligible.filter(x=>x.predicted&&x.label==='not_problem').length;
 const fn=eligible.filter(x=>!x.predicted&&x.label==='real_problem').length;
 const tn=eligible.filter(x=>!x.predicted&&x.label==='not_problem').length;
 const review=discoveryReviewSample(store);
 return {counts:{labeled:rows.length,usable:eligible.length,stale:rows.filter(x=>x.stale).length,truePositive:tp,falsePositive:fp,falseNegative:fn,trueNegative:tn,uncertain:rows.filter(x=>x.label==='uncertain').length,remainingUnlabeled:review.remainingUnlabeled},
  precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,
  unlabeled:review.items,samplePolicy:review.samplePolicy,offlineReplay:replayDiscoveryRules(store),
  items:rows.slice(0,Math.min(100,Math.max(1,limit))),notice:'只针对人工标注的小样本估算规则准确率；抽样队列是确定性的分层待审核列表，并非随机抽样，存在选择偏差，不代表所有信息源或 AI 模型表现'};
}
