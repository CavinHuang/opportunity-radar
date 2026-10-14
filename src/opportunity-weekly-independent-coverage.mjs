import {weeklyHypothesisBoard} from './opportunity-weekly-hypotheses.mjs';
import {weeklyEvidenceProvenance} from './opportunity-weekly-provenance.mjs';

// Counts reviewed original sources, not events or independent human beings.
const normalizeOrigin=value=>{
 const s=String(value||'').trim();
 try{const u=new URL(s);if(!['http:','https:'].includes(u.protocol))return s.toLowerCase();u.hash='';u.hostname=u.hostname.toLowerCase();u.pathname=u.pathname.replace(/\/$/,'')||'/';for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.toString()}catch{return s.toLowerCase()}
};
const negative=e=>['stop','contradicted'].includes(String(e.detail?.decision||e.detail?.outcome||''));
export function weeklyIndependentEvidenceCoverage(store,options={}){
 const hypotheses=weeklyHypothesisBoard(store,options);
 const provenance=weeklyEvidenceProvenance(store,options);
 const reviewed=new Map(provenance.events.filter(e=>e.review).map(e=>[e.seq,e.review]));
 const rows=hypotheses.items.map(item=>{
  const references=item.linkedEvidence;
  const groups=new Map();
  const unverified=[];
  for(const e of references){
   const review=reviewed.get(e.seq),origin=normalizeOrigin(review?.origin);
   if(!review||review.classification==='unverified'||!origin){unverified.push(e.seq);continue;}
   const key=origin;
   const group=groups.get(key)||{origin:key,seqs:[],classifications:[],signals:new Set()};
   group.seqs.push(e.seq);
   group.classifications.push(review.classification);
   group.signals.add(negative(e)?'negative':e.quality==='recorded_observation'?'observed':'activity_or_assessment');
   groups.set(key,group);
  }
  const origins=[...groups.values()].map(g=>({...g,signals:[...g.signals]}));
  const firstHand=origins.filter(g=>g.classifications.every(x=>x==='independent_firsthand'));
  const nonIndependent=origins.filter(g=>g.classifications.some(x=>x==='same_origin'||x==='repost'));
  const negativeOrigins=origins.filter(g=>g.signals.includes('negative'));
  const positiveCandidateOrigins=firstHand.filter(g=>g.signals.includes('observed')&&!g.signals.includes('negative'));
  const conflicts=origins.filter(g=>g.signals.includes('negative')&&g.signals.includes('observed'));
  const signals={reviewedOrigins:origins.length,independentFirsthandOrigins:firstHand.length,
   nonIndependentOrigins:nonIndependent.length,unverifiedEventCount:unverified.length,
   duplicateEventCount:origins.reduce((s,g)=>s+Math.max(0,g.seqs.length-1),0),
   observedIndependentOrigins:positiveCandidateOrigins.length,negativeOrigins:negativeOrigins.length,
   conflictingOrigins:conflicts.length};
  const warnings=[];
  if(unverified.length)warnings.push('部分事件没有人工核实的原始来源');
  if(nonIndependent.length)warnings.push('存在转载或标记为同源的证据');
  if(signals.duplicateEventCount)warnings.push('存在同一原始来源被多个事件重复引用');
  if(negativeOrigins.length)warnings.push('存在明确停止或反驳的研究决策来源');
  return {candidateId:item.candidateId,title:item.title,finding:item.finding,linkedEventCount:references.length,
   sourceCoverage:signals,origins,unverifiedEventSeqs:unverified,warnings,
   calibration:item.finding==='unknown'?'unanswered':item.finding==='supported'&&(!positiveCandidateOrigins.length||negativeOrigins.length)?'requires_review':'human_judgement_only'};
 });
 return {weekStart:hypotheses.weekStart,rows,summary:{hypotheses:rows.length,unanswered:rows.filter(r=>r.calibration==='unanswered').length,
  requiresReview:rows.filter(r=>r.calibration==='requires_review').length,
  reviewedDistinctOrigins:rows.reduce((s,r)=>s+r.sourceCoverage.reviewedOrigins,0)},
  marketValidated:false,notice:'按人工填写的规范化来源标识去重，不保证不同标识代表独立用户；观察事件也不是商业正例。支持、反驳和未知仍为人工判断；此处仅显示可核查的来源覆盖和风险，不生成市场验证结论。'};
}
