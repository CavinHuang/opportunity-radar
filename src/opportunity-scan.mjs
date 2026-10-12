import {assessRealProblem} from './real-problem.mjs';
import {opportunityQualityReview} from './opportunity-quality.mjs';
import {discoveryClusters,problemTokens} from './discovery.mjs';
const hints=[['repetitive_work',/automati[sz]|manual(?:ly)?|repetit|tedious|time.consum|耗时|重复|手动|自动化/i,'提及重复操作或手动处理'],['workaround',/workaround|alternative|replace|instead of|looking for|recommend|替代|有没有|求推荐|找不到/i,'明确寻找替代工具或临时解决办法'],['friction',/difficult|frustrat|struggl|cannot|can't|broken|problem|pain|issue|无法|困难|麻烦|不方便/i,'描述具体使用障碍']];
const isHttps=x=>{try{return new URL(x).protocol==='https:'}catch{return false}};
const domain=s=>{try{return new URL(s.url).hostname.replace(/^www\./,'')}catch{return ''}};
function explain(signals,cluster=null){
 const problemEvidence=signals.map(x=>({id:x.id,...assessRealProblem(x)})).filter(x=>x.qualified);
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
  signalIds:signals.map(s=>s.id),sourceUrls:signals.map(s=>s.url),signalCount:signals.length,siteCount,
  reasons,warnings,confidence,domains,competitionMentioned:competition,counterEvidence,clusterId:cluster?.id||null,
  problemEvidence:{qualifiedSignals:problemEvidence.map(x=>x.id),grade:problemEvidence.some(x=>x.grade==='concrete_workflow_with_workaround')?'concrete_workflow_with_workaround':'concrete_workflow',criteria:['使用主体','具体操作','障碍或成本'],unverified:true},
  nextAction:'打开原帖，核对真实场景、现有替代方案、独立用户与反面案例，随后进行低成本访谈'};
}
/** Deterministic, non-LLM candidate read model. Never creates approved opportunities. */
export function opportunityScanCandidates(store,{limit=12,maxSignals=400}={}){
 if(!Number.isInteger(limit)||limit<1||limit>50)throw Object.assign(new Error('invalid limit'),{code:'BAD_LIMIT',status:400});
 const candidates=store.list('sources').filter(s=>['new','saved'].includes(s.status)&&isHttps(s.url)&&s.title).slice(0,maxSignals);
 const qualifiedIds=new Set(candidates.filter(s=>assessRealProblem(s).qualified).map(s=>s.id));
 const groups=discoveryClusters(store,{limit:300,maxSignals}).items.filter(x=>x.state!=='dismissed');
 const groupedIds=new Set(groups.flatMap(g=>g.signals.map(x=>x.id)));
 const collected=[];
 for(const g of groups){const members=g.signals.map(s=>candidates.find(x=>x.id===s.id)).filter(Boolean);if(members.length>1&&members.some(m=>qualifiedIds.has(m.id)))collected.push(explain(members,g));}
 for(const signal of candidates){if(groupedIds.has(signal.id)||!qualifiedIds.has(signal.id)||problemTokens(signal.title).size<3)continue;const row=explain([signal]);if(row.reasons.length===1&&row.reasons[0].startsWith('公开标题'))continue;collected.push(row);}
 const scored=collected.map(item=>({...item,qualityReview:opportunityQualityReview(item),priority:Math.min(5,item.reasons.length+(item.siteCount>1?1:0)),status:'unverified_candidate'}));
 scored.sort((a,b)=>b.priority-a.priority||b.signalCount-a.signalCount||a.id.localeCompare(b.id));
 return {items:scored.slice(0,limit),total:scored.length,examined:candidates.length,insufficientEvidence:candidates.length-qualifiedIds.size,generatedAt:new Date().toISOString(),
  note:'仅推荐文本同时出现使用主体、具体任务和障碍或成本的待核查问题；不把工具话题、发布公告或热度当作真实需求证明。仍需阅读原帖、查证使用者与影响。'};
}
