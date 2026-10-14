import {assessRealProblem} from './real-problem.mjs';
import {productionRuleStatus,selectProductionProblem,changeProductionRule} from './discovery-production-release.mjs';
import {postReleaseEvidenceReport} from './discovery-post-release.mjs';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const id='real_problem_production_monitor';

export function productionMonitorReport(store,{limit=400}={}){
 if(!Number.isInteger(limit)||limit<1||limit>400)throw fail('BAD_LIMIT','最多检查400条来源');
 const release=productionRuleStatus(store);
 const candidates=store.list('sources').filter(s=>['new','saved'].includes(s.status)&&s.id&&s.title).slice(0,limit);
 const labels=new Map(store.list('discovery_quality_labels').map(l=>[l.id,l]));
 const unique=new Set();
 let changed=0,exposed=0,reviewed=0,falseNegativeDelta=0,falsePositiveDelta=0;
 const examples=[];
 for(const s of candidates){
  if(unique.has(s.id))continue;unique.add(s.id);
  const base=assessRealProblem(s),active=selectProductionProblem(store,s);
  if(active.productionVariant==='real_problem_v1')continue;
  exposed++;
  if(base.qualified!==active.qualified){
   changed++;
   if(examples.length<20)examples.push({sourceId:s.id,title:s.title,url:s.url,baseline:base.qualified,production:active.qualified});
  }
  const l=labels.get(s.id);
  if(!l||l.sourceRevision!==s.revision||!['real_problem','not_problem'].includes(l.label))continue;
  reviewed++;
  if(l.label==='real_problem')falseNegativeDelta+=Number(!active.qualified)-Number(!base.qualified);
  else falsePositiveDelta+=Number(active.qualified)-Number(base.qualified);
 }
 return {releaseRevision:release.revision,policyId:release.policyId,percentage:release.percentage,examined:unique.size,exposed,changed,reviewed,
   falseNegativeDelta,falsePositiveDelta,examples,
   notice:'按源ID去重的当前收录帖子快照；不是独立用户或新增需求。未人工标注的结果不能证明质量改善。'};
}

export function productionMonitorHistory(store){
 const row=store.get('discovery_rule_decisions',id);
 return {revision:row?.revision||0,snapshots:row?.snapshots||[],latest:row?.snapshots?.at(-1)||null};
}
export function captureProductionMonitor(store,{reason,expected_revision,expected_release_revision}={}){
 const previous=productionMonitorHistory(store),release=productionRuleStatus(store);
 if(expected_revision!==previous.revision||expected_release_revision!==release.revision)
  throw fail('REVISION_CONFLICT','灰度或监控状态已更新，请刷新',409);
 if(!release.policyId)throw fail('NOT_RELEASED','未启用生产灰度',409);
 const note=String(reason||'').trim();
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','请填写12至500字符的复核理由');
 const report=productionMonitorReport(store);
 // A single human-confirmed new miss is important enough to stop the stricter rule.
 // No selection-biased aggregate accuracy claim, no automatic release escalation.
 const postRelease=postReleaseEvidenceReport(store);
 const autoRollback=report.falseNegativeDelta>0||report.falsePositiveDelta>0||
  postRelease.autoRollbackRecommended;
 return store.transaction(()=>{
  const at=new Date().toISOString();
  const snapshot={...report,at,reason,autoRollback,
   postRelease:{status:postRelease.status,launchAt:postRelease.launchAt,
    baselineVerified:postRelease.baselineVerified,baseline:postRelease.baseline,
    totals:postRelease.totals,regression:postRelease.regression,
    evidenceHash:postRelease.evidenceHash}};
  const result=store.put('discovery_rule_decisions',{id,snapshots:[...previous.snapshots,snapshot].slice(-30)},expected_revision);
  if(autoRollback)changeProductionRule(store,{action:'rollback',
    reason:'人工确认的已暴露规则退化，自动恢复基线并保留对应证据',expected_revision:release.revision});
  store.event('discovery.production_monitor.snapshot',id,'owner',{revision:result.revision,autoRollback,reviewed:report.reviewed,postReleaseStatus:postRelease.status,evidenceHash:postRelease.evidenceHash});
  return {status:productionMonitorHistory(store),release:productionRuleStatus(store),snapshot};
 });
}
