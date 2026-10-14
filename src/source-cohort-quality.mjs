import {opportunityScanCandidates} from './opportunity-scan.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{code,status:400});
const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return 'unknown';}};
const rate=(num,den)=>den?Number((num/den).toFixed(3)):null;
const kinds=['false_negative','false_positive','stale_label','uncertain_label','unlabeled_negative','unlabeled_positive'];

function balancedQueue(rows,limit){
 const chosen=[],seen=new Set();
 for(const kind of kinds){
  const buckets=new Map();
  for(const item of rows.filter(x=>x.issue===kind).sort((a,b)=>a.sourceId.localeCompare(b.sourceId))){
   if(!buckets.has(item.host))buckets.set(item.host,[]);
   buckets.get(item.host).push(item);
  }
  const hosts=[...buckets.keys()].sort();
  while(chosen.length<limit&&hosts.some(h=>buckets.get(h).length)){
   for(const h of hosts){
    const item=buckets.get(h).shift();
    if(item&&!seen.has(item.sourceId)){chosen.push(item);seen.add(item.sourceId);}
    if(chosen.length>=limit)break;
   }
  }
  if(chosen.length>=limit)break;
 }
 return chosen;
}

/**
 * Owner-only, read-only diagnosis. This measures current source posts entering
 * the top 50 visible candidates, not consumer demand or causal model accuracy.
 */
export function sourceCohortQualityReview(store,{limit=18}={}){
 if(!Number.isInteger(limit)||limit<1||limit>50)throw fail('BAD_LIMIT','复核队列长度必须在 1–50');
 const active=store.list('sources').filter(s=>['new','saved'].includes(s.status)&&s.id&&s.title&&
  typeof s.url==='string'&&s.url.startsWith('https://')).slice(0,400);
 const labels=new Map(store.list('discovery_quality_labels').map(x=>[x.id,x]));
 const visible=opportunityScanCandidates(store,{limit:50,maxSignals:400}).items;
 const surfaced=new Map();
 const originCandidate=new Map();
 for(const c of visible){
  for(const id of c.problemEvidence?.qualifiedSignals||[]){
   if(!surfaced.has(id))surfaced.set(id,c.id);
  }
  // For contextual owner feedback only. A post can appear in multiple candidates.
  for(const origin of c.sourceUrls||[]){
   const h=host(origin);
   if(!originCandidate.has(h))originCandidate.set(h,new Set());
   originCandidate.get(h).add(c.id);
  }
 }
 const homeFeedback=store.list('home_opportunity_feedback');
 const researchFeedback=store.list('opportunity_research_guidance_feedback');
 const cohorts=new Map();
 const attention=[];
 const counts={inWindow:active.length,reviewed:0,uncertain:0,stale:0,unlabeled:0,
  truePositive:0,falsePositive:0,falseNegative:0,trueNegative:0,visible:0};
 const freshIds=new Set();
 for(const source of active){
  const h=host(source.url);
  if(!cohorts.has(h))cohorts.set(h,{host:h,inWindow:0,visible:0,reviewed:0,uncertain:0,stale:0,unlabeled:0,
   truePositive:0,falsePositive:0,falseNegative:0,trueNegative:0});
  const row=cohorts.get(h),label=labels.get(source.id);
  const predicted=surfaced.has(source.id);
  row.inWindow++;if(predicted){row.visible++;counts.visible++;}
  const fresh=label&&label.sourceRevision===source.revision;
  let issue=null,actualLabel=null;
  if(label&&!fresh){issue='stale_label';row.stale++;counts.stale++;}
  else if(fresh&&label.label==='uncertain'){issue='uncertain_label';row.uncertain++;counts.uncertain++;}
  else if(fresh&&['real_problem','not_problem'].includes(label.label)){
   freshIds.add(source.id);row.reviewed++;counts.reviewed++;actualLabel=label.label;
   const kind=predicted
    ?(actualLabel==='real_problem'?'truePositive':'falsePositive')
    :(actualLabel==='real_problem'?'falseNegative':'trueNegative');
   row[kind]++;counts[kind]++;
   if(kind==='falseNegative')issue='false_negative';
   if(kind==='falsePositive')issue='false_positive';
  }else{issue=predicted?'unlabeled_positive':'unlabeled_negative';row.unlabeled++;counts.unlabeled++;}
  if(issue){
   attention.push({sourceId:source.id,title:source.title,url:source.url,host:h,issue,
    predicted,ownerLabel:actualLabel,needsHumanReview:true,
    explanation:issue==='false_negative'?'人工标记为具体问题，但该帖未进入当前前50候选；需要区分过滤、聚合与榜单截断':
     issue==='false_positive'?'人工标记非问题，但当前候选榜单仍展示该帖':
     issue==='stale_label'?'来源记录已发生变化，旧标注不能用于本次质量统计':
     issue==='uncertain_label'?'人工尚未得到明确结论，不能自动归为正例或负例':
     issue==='unlabeled_negative'?'过滤或未展示的原帖还未人工审核，可能存在漏报':
     '已展示的原帖还未人工审核，可能存在误报'});
  }
 }
 const excluded=store.list('discovery_quality_labels').filter(x=>!freshIds.has(x.id));
 const index=[...cohorts.values()].map(row=>{
  const evidenceMin=row.reviewed>=10;
  const cids=originCandidate.get(row.host)||new Set();
  const manual=homeFeedback.filter(x=>cids.has(x.id));
  const advice=researchFeedback.filter(x=>cids.has(x.candidateId));
  return {...row,coverage:rate(row.reviewed,row.inWindow),
   reviewedSampleRates:evidenceMin?{
    precision:row.truePositive+row.falsePositive>=5?rate(row.truePositive,row.truePositive+row.falsePositive):null,
    recall:row.truePositive+row.falseNegative>=5?rate(row.truePositive,row.truePositive+row.falseNegative):null
   }:null,
   contextualFeedback:{homeUseful:manual.filter(x=>x.verdict==='useful').length,
    homeRejected:manual.filter(x=>x.verdict==='false_positive').length,
    guidanceAccepted:advice.filter(x=>x.response==='accepted').length,
    guidanceAdapted:advice.filter(x=>x.response==='adapted').length,
    guidanceDeclined:advice.filter(x=>x.response==='declined').length,
    followedUp:advice.filter(x=>Boolean(x.followup)).length},
   reviewPriority:row.falseNegative?'misses':row.falsePositive?'false_positives':
    row.stale?'stale_labels':row.unlabeled?'need_labels':'observe_only'};
 }).sort((a,b)=>b.falseNegative-a.falseNegative||b.falsePositive-a.falsePositive||
   b.stale-a.stale||b.unlabeled-a.unlabeled||a.host.localeCompare(b.host));
 const queued=balancedQueue(attention,limit);
 return {scope:'current_active_https_post_window_top50',readOnly:true,liveRuleChanged:false,
  totals:{...counts,unreviewedHostCount:index.filter(x=>!x.reviewed).length,hosts:index.length,
   labelsOutsideFreshWindow:excluded.length,unseenPending:Math.max(0,attention.length-queued.length)},
  cohorts:index.slice(0,40),moreCohorts:index.length>40,queue:queued,
  queuePolicy:'errors_then_stale_then_uncertain_then_unreviewed; stable round_robin_per_host',
  evaluatedRates:counts.reviewed>=10?{
   precision:counts.truePositive+counts.falsePositive>=5?rate(counts.truePositive,counts.truePositive+counts.falsePositive):null,
   recall:counts.truePositive+counts.falseNegative>=5?rate(counts.truePositive,counts.truePositive+counts.falseNegative):null
  }:null,
  notice:'仅使用已采集的最多400条活跃 HTTPS 原帖、当前前50机会候选和来源版本仍匹配的人工标签。各来源误报/漏报是帖子级人工样本观察，不是独立用户数、真实需求或跨站准确率。部分记录因窗口、排序和分层非随机标注不可直接比较；小样本不展示比例。人工采纳与后续反馈单独列示，不用于校准分类正确率；不会自动调整线上规则。'};
}
