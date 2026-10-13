import {assessRealProblem} from './real-problem.mjs';

// All variants are offline-only. Never write to the source, rules or label tables.
const variants={
 require_workaround:{description:'只有同时提及现有替代做法才推荐',predict:r=>r.qualified&&r.flags.workaround},
 review_promotion_block:{description:'离线测试不使用营销词硬拦截的影响；不建议直接上线',predict:r=>r.flags.actor&&r.flags.task&&r.flags.pain}
};
const metrics=rows=>{
 const tp=rows.filter(r=>r.predicted&&r.label==='real_problem').length;
 const fp=rows.filter(r=>r.predicted&&r.label==='not_problem').length;
 const fn=rows.filter(r=>!r.predicted&&r.label==='real_problem').length;
 const tn=rows.filter(r=>!r.predicted&&r.label==='not_problem').length;
 return {truePositive:tp,falsePositive:fp,falseNegative:fn,trueNegative:tn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null};
};
export function replayDiscoveryRules(store){
 const labels=store.list('discovery_quality_labels');
 const eligible=[],stale=[];
 for(const l of labels){
  const s=store.get('sources',l.id);
  if(!s||s.revision!==l.sourceRevision){stale.push(l.id);continue;}
  if(!['real_problem','not_problem'].includes(l.label))continue;
  eligible.push({source:s,label:l.label,assessment:assessRealProblem(s)});
 }
 const baseline=metrics(eligible.map(x=>({label:x.label,predicted:x.assessment.qualified})));
 const policies=Object.entries(variants).map(([id,variant])=>{
  const rows=eligible.map(x=>({sourceId:x.source.id,label:x.label,before:x.assessment.qualified,after:Boolean(variant.predict(x.assessment))}));
  const after=metrics(rows.map(x=>({label:x.label,predicted:x.after})));
  return {id,description:variant.description,after,delta:{falsePositive:after.falsePositive-baseline.falsePositive,falseNegative:after.falseNegative-baseline.falseNegative},
   changed:rows.filter(x=>x.before!==x.after).map(x=>({sourceId:x.sourceId,label:x.label,before:x.before,after:x.after})).slice(0,25),
   recommendation:eligible.length<20?'insufficient_reviewed_examples':after.falseNegative>baseline.falseNegative?'increased_misses_do_not_apply':after.falsePositive>baseline.falsePositive?'increased_false_positives_do_not_apply':'manual_review_required'};
 });
 return {sampleSize:eligible.length,staleLabels:stale.length,baseline,policies,liveRuleChanged:false,
  notice:'仅在人工标注且原文版本未变的样本上离线回放；样本非随机，不代表总体精准率或召回率。不会自动应用任何规则。'};
}
