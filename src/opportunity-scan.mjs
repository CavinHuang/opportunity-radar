import {assessRealProblem,problemCaseFile} from './real-problem.mjs';
import {selectProductionProblem,productionRuleStatus} from './discovery-production-release.mjs';
import {opportunityQualityReview} from './opportunity-quality.mjs';
import {reviewPriority} from './opportunity-evidence-priority.mjs';
import {opportunityEvidenceDossier} from './opportunity-evidence-dossier.mjs';
import {taskPainClusters} from './task-pain-clusters.mjs';
import {discoveryClusters,problemTokens} from './discovery.mjs';
import {candidateOriginals,opportunitySignals} from './opportunity-brief.mjs';
const hints=[['repetitive_work',/automati[sz]|manual(?:ly)?|repetit|tedious|time.consum|耗时|重复|手动|自动化/i,'提及重复操作或手动处理'],['workaround',/workaround|alternative|replace|instead of|looking for|recommend|替代|有没有|求推荐|找不到/i,'明确寻找替代工具或临时解决办法'],['friction',/difficult|frustrat|struggl|cannot|can't|broken|problem|pain|issue|无法|困难|麻烦|不方便/i,'描述具体使用障碍']];
const isHttps=x=>{try{return new URL(x).protocol==='https:'}catch{return false}};
const domain=s=>{try{return new URL(s.url).hostname.replace(/^www\./,'')}catch{return ''}};
function explain(signals,cluster=null,assess=assessRealProblem){
 const evidencePriority=reviewPriority(signals,{assess,possibleRepost:Boolean(cluster?.diagnostics?.possibleRepost)});
 const evidenceDossier=opportunityEvidenceDossier(signals.filter(x=>assess(x).qualified));
 const problemEvidence=signals.map(x=>({id:x.id,...assess(x)})).filter(x=>x.qualified);
 const cases=signals.map(x=>({id:x.id,sourceUrl:x.url,...problemCaseFile(x)})).filter(x=>x.qualified);
 const strongest=cases.sort((a,b)=>b.evidenceCompleteness-a.evidenceCompleteness)[0];
 const combined=signals.map(x=>String(x.title||'')+' '+String(x.description||'')).join(' ').slice(0,6000);
 const evidence=hints.filter(([_,rx])=>rx.test(combined)).map(([id,_,text])=>({id,text}));
 const siteCount=new Set(signals.map(domain)).size;
 const first=signals[0];
 const reasons=[...evidence.map(e=>e.text)];
 if(cluster&&siteCount>1)reasons.push('相似标题在多个网站出现（独立性尚未核实）');
 if(!reasons.length)reasons.push('公开标题涉及具体工具或使用场景，值得进一步核查');
 const warnings=['原始文章及用户身份未经核验，可能包含广告、转载或一次性问题','讨论数量不是独立用户数，也不代表付费意愿'];
 if(cluster?.diagnostics?.possibleRepost)warnings.unshift('存在疑似转载、重复署名或重复内容');
 const categories=[['AI 与自动化',/\bai\b|agent|llm|automat|模型|自动化/i],['开发者工具',/develop|program|github|code|debug|terminal|cli|开发|代码/i],['个人效率',/productiv|workflow|calendar|note|organize|效率|笔记|整理/i],['支付与财务',/receipt|invoice|payment|bill|budget|账单|发票|支付/i]];
 const domains=categories.filter(([_,test])=>test.test(combined)).map(([label])=>label);
 const competition=/(?:alternative|competitor|replace|existing tool|instead of|替代|竞品|已有工具)/i.test(combined);
 const counterEvidence=[competition?'提到替代工具或已有方案，需要检查竞争和切换成本':'缺少现有竞品与替代方案的独立调查','未取得独立访谈、留存或付费证据'];
 const confidence=evidence.length>=2&&siteCount>1?'needs_original_verification':'weak_signal';
 return {id:cluster?'group:'+cluster.id:'signal:'+first.id,title:first.title,summary:String(first.description||'').slice(0,260),
  signalIds:signals.map(s=>s.id),sourceUrls:signals.map(s=>s.url),signalCount:signals.length,siteCount,evidencePriority,evidenceDossier,
  reasons,warnings,confidence,domains,competitionMentioned:competition,counterEvidence,clusterId:cluster?.id||null,
  problemCase:strongest||null,problemEvidence:{qualifiedSignals:problemEvidence.map(x=>x.id),grade:problemEvidence.some(x=>x.grade==='concrete_workflow_with_workaround')?'concrete_workflow_with_workaround':'concrete_workflow',criteria:['使用主体','具体操作','障碍或成本'],unverified:true},
  nextAction:'打开原帖，核对真实场景、现有替代方案、独立用户与反面案例，随后进行低成本访谈'};
}
/** Deterministic, non-LLM candidate read model. Never creates approved opportunities. */
export function opportunityScanCandidates(store,{limit=12,maxSignals=400,descriptionFallback=false,sourceDiversityTrial=false,productDiscovery=false}={}){
 if(!Number.isInteger(limit)||limit<1||limit>50)throw Object.assign(new Error('invalid limit'),{code:'BAD_LIMIT',status:400});
 const candidates=store.list('sources').filter(s=>['new','saved'].includes(s.status)&&isHttps(s.url)&&s.title).slice(0,maxSignals);
 const qualifiedIds=new Set(candidates.filter(s=>selectProductionProblem(store,s).qualified).map(s=>s.id));
 const allGroups=discoveryClusters(store,{includeDismissed:true,limit:300,maxSignals}).items;
 const groups=allGroups.filter(x=>x.state!=='dismissed');
 // An owner-dismissed "different problem" grouping must not silently reform
 // as a task/action cluster. Restore qualifying members as separate review cards.
 // Fingerprint matching inside discoveryClusters makes the override expire after source edits.
 const splitRecoveryIds=new Set(allGroups.filter(x=>x.state==='dismissed'&&x.reviewClass==='different_problem')
  .flatMap(x=>x.signals.map(s=>s.id)));
 const groupedIds=new Set();
 const collected=[];
 for(const g of groups){
  const members=g.signals.map(s=>candidates.find(x=>x.id===s.id)).filter(Boolean);
  if(members.length>1&&members.some(m=>qualifiedIds.has(m.id))){
   collected.push(explain(members,g,s=>selectProductionProblem(store,s)));
   members.forEach(m=>groupedIds.add(m.id));
  }
 }
 // Second pass finds task/action similarities missed by near-identical title grouping.
 // Previously reviewed title groups keep their own fingerprints and owner decisions.
 for(const group of taskPainClusters(candidates.filter(s=>!groupedIds.has(s.id)&&!splitRecoveryIds.has(s.id)),{assess:s=>selectProductionProblem(store,s)})){
  const row=explain(group.members,null,s=>selectProductionProblem(store,s));
  row.id='task:'+group.task+':'+group.members.map(s=>s.id).sort().join(',');
  row.clusterMethod=group.matchingBasis;
  row.clusterCaveat=group.caveat;
  row.nextAction='先人工核对组内原帖是否为同一操作和同一根因，再调查现有替代方案';
  collected.push(row);
  group.members.forEach(m=>groupedIds.add(m.id));
 }
 for(const signal of candidates){if(groupedIds.has(signal.id)||!qualifiedIds.has(signal.id)||(problemTokens(signal.title).size<3&&(!descriptionFallback||problemTokens(signal.title+' '+String(signal.description||'')).size<3)))continue;const row=explain([signal],null,s=>selectProductionProblem(store,s));if(splitRecoveryIds.has(signal.id)){row.clusterMethod='owner_recovered_different_problem';row.recoveryReason='人工确认原聚合包含不同问题，已独立恢复待核查候选';}if(row.reasons.length===1&&row.reasons[0].startsWith('公开标题'))continue;collected.push(row);}
 const scored=collected.map(item=>({...item,qualityReview:opportunityQualityReview(item),priority:item.evidencePriority.priority,status:'unverified_candidate'}));
 scored.sort((a,b)=>b.priority-a.priority||b.evidencePriority.qualifiedSources-a.evidencePriority.qualifiedSources||a.id.localeCompare(b.id));
 // Homepage review uses product-workflow clues before the top-50 cutoff. Other
 // production/benchmark callers retain their existing evidence ordering.
 if(productDiscovery){
  const priorities=new Map(scored.map(x=>[x.id,opportunitySignals(candidateOriginals(x,store)).priority]));
  scored.sort((a,b)=>priorities.get(b.id)-priorities.get(a.id));
 }
 // Offline-only round-robin by source host. Does not change eligibility, priority or live ranking.
 // Spread limited review slots across communities instead of filling the entire top 50 from one host.
 if(sourceDiversityTrial){
  const buckets=new Map();
  for(const item of scored){
   let host='unknown';try{host=new URL(item.sourceUrls[0]).hostname.toLowerCase().replace(/^www\\./,'')}catch{}
   if(!buckets.has(host))buckets.set(host,[]);
   buckets.get(host).push(item);
  }
  const diversified=[];
  while(diversified.length<scored.length){
   let progressed=false;
   for(const bucket of buckets.values())if(bucket.length){diversified.push(bucket.shift());progressed=true;}
   if(!progressed)break;
  }
  scored.splice(0,scored.length,...diversified);
 }
 return {items:scored.slice(0,limit),total:scored.length,examined:candidates.length,insufficientEvidence:candidates.length-qualifiedIds.size,recoveredSplitSources:splitRecoveryIds.size,generatedAt:new Date().toISOString(),productionRule:productionRuleStatus(store),strategy:sourceDiversityTrial?'source_diversity_trial':descriptionFallback?'description_fallback_trial':'production_baseline',
  note:'依据具体工作障碍、替代做法及可去重来源安排人工核查优先级；不把热度、转载数或话题关键词当成需求。必须进一步确认原帖、独立用户和真实成本。'};
}
