import {assessRealProblem} from './real-problem.mjs';
const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return 'unknown';}};
const pct=(n,d)=>d?Math.round(n/d*100):null;
/**
 * Review coverage is diagnostic, not statistical sampling or independent users.
 * It prioritizes unreviewed predicted negatives and under-reviewed source hosts.
 */
export function discoveryReviewCoverage(store,{limit=20}={}){
 if(!Number.isInteger(limit)||limit<1||limit>40)
  throw Object.assign(new Error('复核队列应为1-40条'),{code:'BAD_LIMIT',status:400});
 const labels=new Map(store.list('discovery_quality_labels').map(l=>[l.id,l]));
 const sources=store.list('sources').filter(s=>s.id&&s.title&&['new','saved'].includes(s.status)&&
  typeof s.url==='string'&&/^https:\/\//i.test(s.url)).slice(0,400);
 const buckets=new Map(),pending=[],totals={sources:sources.length,
  currentReviewed:0,positivePredictions:0,negativePredictions:0,
  reviewedPositive:0,reviewedNegative:0,staleLabels:0,uncertain:0,unreviewed:0};
 const ids=new Set();
 for(const s of sources){
  if(ids.has(s.id))continue;ids.add(s.id);
  const h=host(s.url),predicted=assessRealProblem(s).qualified;
  const key=h+'|'+(predicted?'positive':'negative');
  if(!buckets.has(key))buckets.set(key,{key,host:h,predicted:predicted?'positive':'negative',
   total:0,reviewed:0,unreviewed:0,stale:0,uncertain:0,pending:[]});
  const b=buckets.get(key);b.total++;
  if(predicted)totals.positivePredictions++;else totals.negativePredictions++;
  const l=labels.get(s.id),fresh=l?.sourceRevision===s.revision;
  if(l&&!fresh){totals.staleLabels++;b.stale++;}
  else if(fresh&&l.label==='uncertain'){totals.uncertain++;b.uncertain++;}
  else if(fresh&&['real_problem','not_problem'].includes(l.label)){
   totals.currentReviewed++;b.reviewed++;
   if(predicted)totals.reviewedPositive++;else totals.reviewedNegative++;
   continue;
  }else{totals.unreviewed++;b.unreviewed++;}
  const record={sourceId:s.id,host:h,title:s.title,url:s.url,
   predicted:predicted?'positive':'negative',reason:l&&!fresh?'stale_label':
    fresh?'uncertain_label':'not_reviewed'};
  b.pending.push(record);pending.push(record);
 }
 const hosts=new Map();
 for(const b of buckets.values()){
  if(!hosts.has(b.host))hosts.set(b.host,{host:b.host,total:0,reviewed:0,
   positive:0,negative:0,reviewedPositive:0,reviewedNegative:0});
  const h=hosts.get(b.host);h.total+=b.total;h.reviewed+=b.reviewed;
  if(b.predicted==='positive'){h.positive+=b.total;h.reviewedPositive+=b.reviewed;}
  else{h.negative+=b.total;h.reviewedNegative+=b.reviewed;}
 }
 const sortedHosts=[...hosts.values()].map(h=>({
  ...h,coveragePercent:pct(h.reviewed,h.total),
  shortfall:h.total-h.reviewed
 })).sort((a,b)=>a.coveragePercent-b.coveragePercent||
    b.shortfall-a.shortfall||a.host.localeCompare(b.host));
 const distribution=[...buckets.values()].map(b=>({
  host:b.host,predicted:b.predicted,total:b.total,
  reviewed:b.reviewed,unreviewed:b.unreviewed,stale:b.stale,uncertain:b.uncertain,
  coveragePercent:pct(b.reviewed,b.total)
 })).sort((a,b)=>a.coveragePercent-b.coveragePercent||b.total-a.total||
   a.host.localeCompare(b.host));
 const samples=[];
 // Alternate prediction strata, choose least-reviewed host each time, then rotate.
 const bucketsInOrder=[...buckets.values()].filter(b=>b.pending.length).sort((a,b)=>
   (a.reviewed/a.total)-(b.reviewed/b.total)||b.total-a.total||a.key.localeCompare(b.key));
 for(const b of bucketsInOrder)b.pending.sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
 const visited=new Set();let turn=0;
 while(samples.length<limit&&bucketsInOrder.some(b=>b.pending.length)){
  const side=turn++%2?'positive':'negative';
  const choices=bucketsInOrder.filter(b=>b.predicted===side&&b.pending.length);
  const use=choices.length?choices:bucketsInOrder.filter(b=>b.pending.length);
  use.sort((a,b)=>((a.reviewed+visited.has(a.key))/(a.total))-
   ((b.reviewed+visited.has(b.key))/(b.total))||
   (visited.has(a.key)-visited.has(b.key))||a.key.localeCompare(b.key));
  const group=use[0];samples.push(group.pending.shift());visited.add(group.key);
 }
 const hostCount=sortedHosts.length;
 const maxReviewed=sortedHosts.reduce((m,h)=>Math.max(m,h.reviewed),0);
 const reviewedHostSharePercent=pct(maxReviewed,totals.currentReviewed);
 const risks=[];
 if(totals.currentReviewed<20)risks.push('fewer_than_20_current_labels');
 if(hostCount<2)risks.push('single_source_domain');
 if(reviewedHostSharePercent!==null&&reviewedHostSharePercent>70)risks.push('reviewed_labels_concentrated_in_one_host');
 if(totals.negativePredictions>0&&totals.reviewedNegative===0)risks.push('negative_predictions_never_reviewed');
 if(totals.positivePredictions>0&&totals.reviewedPositive===0)risks.push('positive_predictions_never_reviewed');
 if(totals.staleLabels)risks.push('source_edits_invalidated_labels');
 return {scope:'active_https_sources_first400',readOnly:true,productionChanged:false,
  totals:{...totals,distinctSourceHosts:hostCount,reviewedHostSharePercent,
   overallCoveragePercent:pct(totals.currentReviewed,ids.size),unreviewedQueue:pending.length},
  risks,hosts:sortedHosts.slice(0,40),strata:distribution.slice(0,60),queue:samples,
  truncatedHosts:hostCount>40,truncatedStrata:distribution.length>60,
  notice:'本报告只衡量最近400条活跃公开原帖中各域名和基础规则正/负预测的人工标注覆盖。队列是确定性补漏列表，不是概率随机样本；同域名或不同域名不代表独立用户。覆盖率和来源分布不证明整体预测准确率、真实性或商业需求。'};
}
