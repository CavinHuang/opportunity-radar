// Historical dossier from persisted weekly plans, hypotheses and owner-reviewed provenance.
// Never infer users, market validation or commercial outcomes from source-event counts.
function normalizedOrigin(value){
 const raw=String(value??'').trim();if(!raw)return '';
 try{
  const u=new URL(raw);
  if(!['http:','https:'].includes(u.protocol))return raw.toLowerCase();
  u.hash='';u.hostname=u.hostname.toLowerCase();u.pathname=u.pathname.replace(/\/$/,'')||'/';
  for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
  u.searchParams.sort();return u.toString();
 }catch{return raw.toLowerCase()}
}

function dossierReviewFlags(history,originHistory,recurring,asOf=new Date()){
 const flags=[];
 const add=(code,severity,message)=>flags.push({code,severity,message});
 if(!history.length)return [{code:'NO_RESEARCH',severity:'info',message:'尚无研究记录，请先制定真实的验证任务。'}];
 const latest=history.at(-1);
 if(!latest.hypothesis?.text)add('NO_HYPOTHESIS','warning','最近一周尚未记录可证伪的研究假设。');
 if(latest.provenance.unreviewedLinkedEvents>0)add('UNREVIEWED_PROVENANCE','warning','最近一周存在 '+latest.provenance.unreviewedLinkedEvents+' 条未审核来源的关联证据。');
 if(latest.hypothesis?.referencedEventCount===0)add('NO_LINKED_EVIDENCE','warning','最近一周的研究假设尚未关联可追溯事件。');
 if(latest.status!=='reviewed')add('WEEK_NOT_REVIEWED','info','最近一周尚未完成正式复盘，不能将其视为已验证。');
 if(originHistory.some(o=>o.weeks.length>1))add('REUSED_SOURCES','warning','多周重复引用同一来源；不能当作新增独立证据。');
 if(recurring.some(h=>h.changedConclusion))add('CONFLICTING_FINDINGS','warning','同一文本假设出现不同人工结论，需要核对原因和反证。');
 const date=asOf instanceof Date?asOf:new Date(asOf);
 const weekDate=new Date(String(latest.weekStart)+'T00:00:00Z');
 if(Number.isFinite(date.getTime())&&Number.isFinite(weekDate.getTime())){
  const days=Math.floor((date.getTime()-weekDate.getTime())/86400000);
  if(days>=28)add('STALE_RESEARCH','warning','最近研究周距今 '+days+' 天；应重新确认问题是否仍然存在。');
 }
 return flags;
}
const textKey=x=>String(x??'').trim().replace(/\s+/g,' ').toLowerCase();
export function crossWeekResearchDossier(store,candidateId){
 if(typeof candidateId!=='string'||!candidateId.trim())throw Object.assign(new Error('无效候选 ID'),{status:400,code:'BAD_CANDIDATE'});
 const weeks=store.list('opportunity_weekly_plans').filter(p=>(p.items||[]).some(x=>x.candidateId===candidateId))
  .sort((a,b)=>String(a.weekStart).localeCompare(String(b.weekStart)));
 const history=weeks.map(plan=>{
  const task=plan.items.find(x=>x.candidateId===candidateId);
  const hypothesis=store.get('opportunity_weekly_hypotheses',plan.id)?.items?.find(x=>x.candidateId===candidateId)||null;
  const provenance=(store.get('opportunity_weekly_provenance',plan.id)?.reviews||[]).filter(x=>x.candidateId===candidateId);
  const linkedIds=new Set(hypothesis?.eventSeqs||[]);
  const evidenceReviews=provenance.filter(r=>linkedIds.has(r.seq));
  const originMap=new Map();
  for(const r of evidenceReviews){
   if(r.classification==='unverified')continue;
   const key=normalizedOrigin(r.origin);if(!key)continue;
   const row=originMap.get(key)||{origin:key,seqs:[],classifications:[]};
   row.seqs.push(r.seq);row.classifications.push(r.classification);originMap.set(key,row);
  }
  const result=plan.review?.results?.find(r=>r.candidateId===candidateId)||null;
  return {weekStart:plan.weekStart,status:plan.status,title:task.title,task:task.task,
   plan:{hours:task.hours,budget:task.budget},
   progress:(plan.progress||[]).filter(p=>p.candidateId===candidateId),
   result,hypothesis:hypothesis?{text:hypothesis.hypothesis,expectedEvidence:hypothesis.expectedEvidence,
    falsifier:hypothesis.falsifier,finding:hypothesis.finding||'unknown',rationale:hypothesis.rationale,
    referencedEventCount:linkedIds.size}:null,
   provenance:{reviewedEvents:evidenceReviews.length,unreviewedLinkedEvents:Math.max(0,linkedIds.size-evidenceReviews.length),
    distinctOrigins:[...originMap.values()],nonIndependentOrigins:[...originMap.values()].filter(g=>g.classifications.some(c=>c==='same_origin'||c==='repost')).length}
  };
 });
 const allOrigins=new Map();
 for(const week of history)for(const group of week.provenance.distinctOrigins){
  const item=allOrigins.get(group.origin)||{origin:group.origin,weeks:[],eventReferences:0,nonIndependent:false};
  item.weeks.push(week.weekStart);item.eventReferences+=group.seqs.length;
  item.nonIndependent ||=group.classifications.some(c=>c==='same_origin'||c==='repost');
  allOrigins.set(group.origin,item);
 }
 const hypotheses=new Map();
 for(const w of history)if(w.hypothesis){
  const key=textKey(w.hypothesis.text),h=hypotheses.get(key)||{hypothesis:w.hypothesis.text,weeks:[],findings:[]};
  h.weeks.push(w.weekStart);h.findings.push(w.hypothesis.finding);hypotheses.set(key,h);
 }
 const recurring=[...hypotheses.values()].filter(h=>h.weeks.length>1).map(h=>({...h,changedConclusion:new Set(h.findings.filter(f=>f!=='unknown')).size>1}));
 const reviewed=history.filter(w=>w.status==='reviewed');
 const actualHours=reviewed.reduce((s,w)=>s+(Number(w.result?.actualHours)||0),0);
 const plans=history.reduce((s,w)=>s+(Number(w.plan.hours)||0),0);
 return {candidateId,title:history.at(-1)?.title||candidateId,weeks:history,
  overview:{researchWeeks:history.length,reviewedWeeks:reviewed.length,plannedHours:Number(plans.toFixed(2)),
   actualHoursClosed:Number(actualHours.toFixed(2)),distinctReviewedOrigins:allOrigins.size,
   repeatedOriginCount:[...allOrigins.values()].filter(x=>x.weeks.length>1).length,
   repeatedHypotheses:recurring.length,changedConclusionHypotheses:recurring.filter(x=>x.changedConclusion).length},
  originHistory:[...allOrigins.values()],repeatedHypotheses:recurring,reviewFlags:dossierReviewFlags(history,[...allOrigins.values()],recurring),readOnly:true,
  notice:'档案仅汇集已保存的跨周记录。原始来源按链接和人工标识合并，不代表独立用户；实际小时只计已复盘周。重复假设按规范化文本匹配，不能自动判断语义相同。结论变化仅是人工记录变化，不代表因果验证或商业成功。'};
}
