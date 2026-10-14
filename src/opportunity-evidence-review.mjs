import {candidateContext} from './opportunity-research.mjs';
import {externalResearchStatus} from './opportunity-external-research.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const choices=new Set(['related_problem','existing_solution','not_relevant','uncertain']);
const priorityTypes=new Set(['related_discussion','related_problem_report','possible_alternative','solution_with_reported_limits']);
export function evidenceReviewQueue(results,reviews){
 const reviewed=new Set(reviews.map(x=>x.url));
 const priority=results.filter(x=>priorityTypes.has(x.triageType));
 const pending=priority.filter(x=>!reviewed.has(x.url));
 return {priority:pending,
  other:results.filter(x=>!priorityTypes.has(x.triageType)&&!reviewed.has(x.url)),
  reviewed:results.filter(x=>reviewed.has(x.url)),
  priorityProgress:{total:priority.length,reviewed:priority.length-pending.length,pending:pending.length}};
}
export function evidenceReviewBoard(store,id,context=null){
 const ctx=context||candidateContext(store,id),external=externalResearchStatus(store,id);
 const current=Boolean(external.record&&external.record.candidateFingerprint===ctx.fingerprint);
 const saved=store.get('opportunity_evidence_reviews',id);
 const valid=Boolean(current&&saved?.candidateFingerprint===ctx.fingerprint&&saved?.searchRevision===external.revision);
 const results=current?(external.record.results||[]).slice(0,35):[];
 const reviews=valid?saved.items||[]:[];
 return {candidateId:id,candidateFingerprint:ctx.fingerprint,searchRevision:external.revision,
  current,revision:saved?.revision||0,stale:!!saved&&!valid,
  reviews,results,queue:evidenceReviewQueue(results,reviews),
  notice:'逐条分类是人工判断，不是独立核实的竞争产品、需求或付费数据；重新检索后旧审核必须重做。'};
}
export function reviewExternalEvidence(store,id,{candidateFingerprint,searchRevision,url,classification,notes,expected_revision}={}){
 const board=evidenceReviewBoard(store,id);
 if(!board.current)throw fail('STALE_SEARCH','请先完成当前版本的外部检索',409);
 if(board.candidateFingerprint!==candidateFingerprint||board.searchRevision!==searchRevision)throw fail('STALE_EVIDENCE','检索结果已变化，请刷新',409);
 if(expected_revision!==board.revision)throw fail('REVISION_CONFLICT','审核记录已经更新',409);
 if(!choices.has(classification))throw fail('BAD_CLASSIFICATION','请选择证据类别');
 const note=String(notes||'').trim();
 if(note.length<10||note.length>700)throw fail('REASON_REQUIRED','审核依据需10至700字');
 const hit=board.results.find(x=>x.url===url);
 if(!hit)throw fail('UNKNOWN_EVIDENCE','只能审核当前检索结果的原始链接',409);
 const items=board.reviews.filter(x=>x.url!==url);
 items.push({url:hit.url,title:hit.title,source:hit.source,classification,notes:note,reviewedAt:new Date().toISOString()});
 return store.transaction(()=>{
  const again=evidenceReviewBoard(store,id);
  if(!again.current||again.candidateFingerprint!==candidateFingerprint||again.searchRevision!==searchRevision)
   throw fail('STALE_EVIDENCE','检索结果已变化',409);
  if(again.revision!==expected_revision)throw fail('REVISION_CONFLICT','审核记录已经更新',409);
  const row=store.put('opportunity_evidence_reviews',{id,candidateFingerprint,searchRevision,items},expected_revision);
  store.event('opportunity.external_evidence.reviewed',id,'owner',{url,classification,revision:row.revision});
  return row;
 });
}
