import {weeklyHypothesisBoard} from './opportunity-weekly-hypotheses.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const classifications=new Set(['independent_firsthand','same_origin','repost','unverified']);
const clean=x=>String(x??'').trim().slice(0,600);
export function weeklyEvidenceProvenance(store,options={}){
 const board=weeklyHypothesisBoard(store,options),saved=store.get('opportunity_weekly_provenance',board.id);
 const events=board.items.flatMap(x=>x.eligibleEvidence.map(e=>({...e,candidateId:x.candidateId})));
 const records=saved?.reviews||[];
 return {id:board.id,weekStart:board.weekStart,planRevision:board.planRevision,planStatus:board.planStatus,
  revision:saved?.revision||0,events:events.map(e=>({...e,review:records.find(r=>r.seq===e.seq&&r.candidateId===e.candidateId)||null})),
  notice:'真实性与来源独立性只能由人工审核。事件本身不等于已验证原始证据，未核查一律视为未验证。'};
}
export function reviewWeeklyEvidenceProvenance(store,data={},options={}){
 const board=weeklyEvidenceProvenance(store,options);
 if(board.planStatus!=='planned')throw fail('WEEK_CLOSED','已复盘周计划不能修改来源审核',409);
 if(data.expected_revision!==board.revision||data.planRevision!==board.planRevision)throw fail('REVISION_CONFLICT','来源核查版本已改变',409);
 const e=board.events.find(x=>x.seq===data.seq&&x.candidateId===data.candidateId);
 if(!e)throw fail('FOREIGN_EVIDENCE','只能审核本周候选关联的真实事件',409);
 if(!classifications.has(data.classification))throw fail('INVALID_CLASSIFICATION','无效的来源独立性分类');
 const rationale=clean(data.rationale),origin=clean(data.origin);
 if(rationale.length<12)throw fail('REASON_REQUIRED','请输入至少12字的核查依据');
 if(data.classification!=='unverified'&&origin.length<5)throw fail('ORIGIN_REQUIRED','请填写可追溯的原始来源标识或链接');
 return store.transaction(()=>{
  const latest=weeklyEvidenceProvenance(store,options);
  if(latest.revision!==board.revision||latest.planRevision!==board.planRevision||latest.planStatus!=='planned')throw fail('REVISION_CONFLICT','审核或周计划已更新',409);
  if(!latest.events.some(x=>x.seq===data.seq&&x.candidateId===data.candidateId))throw fail('FOREIGN_EVIDENCE','事件不再有效',409);
  const existing=store.get('opportunity_weekly_provenance',board.id);
  const reviews=(existing?.reviews||[]).filter(x=>x.seq!==data.seq);
  reviews.push({seq:data.seq,candidateId:data.candidateId,classification:data.classification,origin, rationale,reviewedAt:new Date().toISOString()});
  const row=store.put('opportunity_weekly_provenance',{id:board.id,weekStart:board.weekStart,reviews},board.revision);
  store.event('opportunity.weekly_evidence.provenance_reviewed',board.id,'owner',{seq:data.seq,candidateId:data.candidateId,classification:data.classification,revision:row.revision});
  return row;
 });
}
