/** Product hypotheses must cite collected text; model conclusions are not verified demand. */
export const HOME_DISCOVERY_MAX_SIGNALS=1200;
export function plainSourceText(value){
 return String(value||'').slice(0,20000).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(m,key)=>{
   if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}
   return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[key.toLowerCase()]||m;
  }).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}
export function candidateOriginals(candidate,store){
 return (candidate.signalIds||[]).map(id=>store.get('sources',id)).filter(Boolean).slice(0,3).map(s=>({
  sourceId:s.id,url:s.url,title:plainSourceText(s.title).slice(0,220),
  text:plainSourceText(s.description).slice(0,1800),publishedAt:s.publishedAt||null,
  dateCaveat:'Feed date may be an update; original post age and current relevance require verification.'
 }));
}
const recurring=/every day|daily|each week|weekly|every month|monthly|repeatedly|每天|每周|每月|反复|每次/i;
const workaround=/manually|spreadsheet|excel|copy.paste|workaround|currently use|have to|手动|表格|人工|不得不|临时|替代/i;
const impact=/\b\d+\s*(?:hours?|minutes?)\b|costs?\s*\$\d+|too expensive|耗时|损失|\d+\s*(?:小时|分钟|元)/i;
const support=/\b(?:error|crash|broken|missing|cannot|can't|unable|failed)\b|报错|崩溃|无法|失败|丢失|卡住/i;
export function opportunitySignals(originals){
 const text=originals.map(s=>s.title+' '+s.text).join(' ');
 const signals={recurring:recurring.test(text),workaround:workaround.test(text),impact:impact.test(text)};
 const supportOnly=support.test(text)&&!signals.recurring&&!signals.impact;
 const freshness=opportunityFreshness(originals);
 return {...signals,supportOnly,freshness,priority:(signals.recurring?4:0)+(signals.impact?4:0)+(signals.workaround?2:0)-(supportOnly?3:0)-(freshness.status==='historical_only'?8:0)};
}
const fields=['user','task','pain','workaround','recurrence','impact','existingGap'];
export function opportunityFreshness(originals,{nowMs=Date.now(),maxAgeDays=180}={}){
 const dates=originals.map(s=>Date.parse(s.publishedAt||'')).filter(ms=>Number.isFinite(ms)&&ms>=0&&ms<=nowMs+86400000);
 const newest=dates.length?Math.max(...dates):null;
 const ageDays=newest===null?null:Math.max(0,Math.floor((nowMs-newest)/86400000));
 return {status:!dates.length?'undated':ageDays>maxAgeDays?'historical_only':'recent_feed_date_unverified',
  newestPublishedAt:newest===null?null:new Date(newest).toISOString(),ageDays,maxAgeDays,
  notice:'采用已收录的 feed 发布时间，不把采集时间当作原帖时间；近期时间也不能证明当前需求成立。历史帖子需要新的相关证据。'};
}
export function groundedOpportunityBrief(raw,originals){
 const evidence={},invalidEvidence=[];
 for(const key of fields){
  const proposed=raw?.evidence?.[key];
  if(!proposed)continue;
  const original=originals.find(s=>s.sourceId===proposed.sourceId);
  const quote=plainSourceText(proposed.quote).slice(0,400);
  const haystack=original?original.title+' '+original.text:'';
  // Short Chinese phrases and exact frequency terms carry meaning without
  // eight characters. Keep literal source matching; don't invent padding.
  const minimumLength=key==='recurrence'&&recurring.test(quote)?2:/[\u3400-\u9fff]/u.test(quote)?4:8;
  if(!original||quote.length<minimumLength||!haystack.includes(quote)){invalidEvidence.push(key);continue;}
  evidence[key]={sourceId:original.sourceId,url:original.url,quote};
 }
 const clip=(s,n=240)=>typeof s==='string'?s.trim().slice(0,n):'';
 const hypothesis=clip(raw?.hypothesis),validation=clip(raw?.validation),counterargument=clip(raw?.counterargument);
 const minimum=['user','task','pain','workaround','existingGap'];
 const gaps=minimum.filter(key=>!evidence[key]);
 if(!evidence.recurrence&&!evidence.impact)gaps.push('recurrence_or_impact');
 if(!hypothesis||!validation||!counterargument)gaps.push('hypothesis_and_test');
 // Only quoted sources can refresh a hypothesis. An unrelated newly collected
 // source or updated scan timestamp must not rejuvenate old evidence.
 const cited=new Set(Object.values(evidence).map(e=>e.sourceId));
 const freshness=opportunityFreshness(originals.filter(s=>cited.has(s.sourceId)));
 if(freshness.status==='historical_only')gaps.push('current_relevance');
 const valid=raw?.kind==='product_hypothesis'&&gaps.length===0&&invalidEvidence.length===0;
 const signals=opportunitySignals(originals);
 const kind=valid?'product_hypothesis':raw?.kind==='support_issue'||signals.supportOnly?'support_issue':'research_lead';
 return {kind,evidence,invalidEvidence,gaps,freshness,hypothesis:valid?hypothesis:null,
  validation:valid?validation:null,counterargument:valid?counterargument:null,
  signals,originals:originals.map(({text,...metadata})=>metadata),
  state:valid?'testable_hypothesis_not_validated':'insufficient_product_evidence',
  notice:'原文包含相关描述，不代表事实已验证。产品方案、反证和验证动作均为模型建议；付费意愿与独立用户尚未核实。'};
}

/** Fill a bounded AI budget with promising workflows first; cap host dominance when alternatives exist. */
export function selectBriefCandidates(items,store,{limit=12}={}){
 const ranked=items.map((item,index)=>({item,index,priority:opportunitySignals(candidateOriginals(item,store)).priority}))
  .sort((a,b)=>b.priority-a.priority||a.index-b.index);
 const selected=[],deferred=[],counts=new Map();
 for(const row of ranked){
  let host='unknown';try{host=new URL(row.item.sourceUrls[0]).hostname;}catch{}
  if((counts.get(host)||0)>=3){deferred.push(row.item);continue;}
  selected.push(row.item);counts.set(host,(counts.get(host)||0)+1);
 }
 return [...selected,...deferred].slice(0,limit);
}
