import {problemTokens} from './discovery.mjs';
const alternative=/\b(?:alternative|workaround|replace|replacement|solution|solved|fixed|plugin|library|open.source)\b|替代|解决方案|开源|修复|插件/i;
const unmet=/\b(?:still|doesn't work|does not work|broken|failed|cannot|missing|limitation|issue|bug|painful)\b|仍然|无法|失败|缺少|问题|限制|不支持/i;
const stop=new Set(['cannot','manually','record','records','problem','issue','issues','every','using','about','alternative','alternatives','other','could','would','their','there','which','after','before']);
const topical=title=>new Set([...problemTokens(title)].filter(t=>t.length>2&&!stop.has(t)));
export function analyzeExternalCounterevidence(title,records=[],sourceStatus=[]){
 const target=topical(title),items=[],seen=new Set();
 for(const hit of records){
  if(!hit?.url||seen.has(hit.url))continue;
  seen.add(hit.url);
  const tokens=topical(hit.title);
  const common=[...target].filter(x=>tokens.has(x));
  const overlap=common.length/Math.max(target.size,1);
  const related=common.length>=2&&overlap>=0.25;
  const text=String(hit.title||'')+' '+String(hit.excerpt||'');
  const hints={existingSolution:alternative.test(text),unresolvedPain:unmet.test(text)};
  const type=!related?'weak_match':hints.existingSolution&&hints.unresolvedPain?'solution_with_reported_limits':
   hints.existingSolution?'possible_alternative':hints.unresolvedPain?'related_problem_report':'related_discussion';
  items.push({url:hit.url,source:hit.source,title:hit.title,type,
   sharedTerms:common.slice(0,8),hints,verified:false});
 }
 const counts=Object.fromEntries(['weak_match','related_discussion','related_problem_report','possible_alternative','solution_with_reported_limits'].map(k=>[k,items.filter(x=>x.type===k).length]));
 const failed=sourceStatus.filter(x=>x.status!=='ok').map(x=>x.source);
 const stage=items.some(x=>x.type==='solution_with_reported_limits'||x.type==='possible_alternative')?'inspect_existing_solutions':
  items.some(x=>x.type==='related_problem_report')?'verify_related_problems':'insufficient_external_evidence';
 return {stage,counts,items:items.slice(0,35),missing:[
  '检索命中未验证为同一用户任务或同一根因',
  '未核实不同帖子是否属于独立用户或转载',
  '未比较现有产品的功能、价格和真实使用效果',
  '未获得愿意付费或迁移的行为证据',
  ...(failed.length?['部分信息源查询失败：'+failed.join('、')]:[])
 ],nextAction:stage==='inspect_existing_solutions'?'打开疑似现有方案，核查它解决了什么、哪些需求仍未解决':
 stage==='verify_related_problems'?'核对相关报告的原帖上下文、作者及是否同一任务':'扩展具体场景关键词，不要从空结果推断市场空白',
 caveat:'只基于搜索标题与片段做保守词汇归类；这是调查优先级而非市场缺口、竞品确认或需求验证。'};
}
