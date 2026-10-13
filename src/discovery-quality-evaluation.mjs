import {assessRealProblem} from './real-problem.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function labelDiscoveryExample(store,sourceId,{label,reason,expected_revision}={}){
 const s=store.get('sources',sourceId);if(!s)throw fail('SOURCE_NOT_FOUND','原始线索不存在',404);
 if(!['real_problem','not_problem','uncertain'].includes(label))throw fail('BAD_LABEL','请选择真实问题、非问题或不确定');
 const note=String(reason||'').trim().slice(0,600);if(note.length<8)throw fail('REASON_REQUIRED','人工标注理由至少8字');
 const prev=store.get('discovery_quality_labels',sourceId);if(expected_revision!==(prev?.revision||0))throw fail('REVISION_CONFLICT','标注已更新，请刷新',409);
 const row=store.put('discovery_quality_labels',{id:sourceId,label,reason:note,sourceRevision:s.revision,at:new Date().toISOString()},prev?.revision||0);
 store.event('discovery.quality.labeled',sourceId,'owner',{label,revision:row.revision});return row;
}
export function discoveryQualityReport(store,{limit=60}={}){
 const labels=store.list('discovery_quality_labels').sort((a,b)=>(b.at||'').localeCompare(a.at||''));
 const rows=labels.map(l=>{const s=store.get('sources',l.id);if(!s)return null;const rule=assessRealProblem(s);return {sourceId:l.id,title:s.title,url:s.url,label:l.label,reason:l.reason,revision:l.revision,stale:l.sourceRevision!==s.revision,predicted:rule.qualified,blockers:rule.blockers};}).filter(Boolean);
 const eligible=rows.filter(x=>!x.stale&&x.label!=='uncertain');
 const tp=eligible.filter(x=>x.predicted&&x.label==='real_problem').length;
 const fp=eligible.filter(x=>x.predicted&&x.label==='not_problem').length;
 const fn=eligible.filter(x=>!x.predicted&&x.label==='real_problem').length;
 const tn=eligible.filter(x=>!x.predicted&&x.label==='not_problem').length;
 return {counts:{labeled:rows.length,usable:eligible.length,stale:rows.filter(x=>x.stale).length,truePositive:tp,falsePositive:fp,falseNegative:fn,trueNegative:tn,uncertain:rows.filter(x=>x.label==='uncertain').length},
  precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,
  unlabeled:store.list('sources').filter(x=>x.title&&!labels.some(l=>l.id===x.id)).slice(0,10).map(x=>({sourceId:x.id,title:x.title,url:x.url,predicted:assessRealProblem(x).qualified})),
  items:rows.slice(0,Math.min(100,Math.max(1,limit))),notice:'只针对人工标注的小样本估算规则准确率；样本有选择偏差，不代表所有信息源或 AI 模型表现'};
}
