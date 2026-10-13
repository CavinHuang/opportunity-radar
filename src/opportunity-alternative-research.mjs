import {evidenceReviewBoard} from './opportunity-evidence-review.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function alternativeResearchBoard(store,id){
 const evidence=evidenceReviewBoard(store,id),record=store.get('opportunity_alternative_research',id);
 const valid=evidence.current&&record?.candidateFingerprint===evidence.candidateFingerprint&&record?.searchRevision===evidence.searchRevision&&record?.reviewRevision===evidence.revision;
 const accepted=new Set(evidence.reviews.filter(x=>x.classification==='existing_solution').map(x=>x.url));
 return {candidateId:id,candidateFingerprint:evidence.candidateFingerprint,searchRevision:evidence.searchRevision,
  reviewRevision:evidence.revision,revision:record?.revision||0,
  stale:!!record&&!valid,items:valid?(record.items||[]).filter(x=>accepted.has(x.url)):[],
  eligible:evidence.reviews.filter(x=>x.classification==='existing_solution').map(x=>({url:x.url,title:x.title,notes:x.notes})),
  notice:'所有字段均为人工研究记录，价格、功能与用户抱怨必须注明证据；未知项保持未知，不等于已验证竞争对手或商业需求。'};
}
export function recordAlternativeResearch(store,id,{candidateFingerprint,searchRevision,reviewRevision,expected_revision,url,name,capabilities,priceEvidence,reportedLimitations,notes}={}){
 const board=alternativeResearchBoard(store,id);
 if(candidateFingerprint!==board.candidateFingerprint||searchRevision!==board.searchRevision||reviewRevision!==board.reviewRevision)throw fail('STALE_EVIDENCE','审核证据版本已变化，请重新打开工作台',409);
 if(expected_revision!==board.revision)throw fail('REVISION_CONFLICT','替代方案研究已被更新',409);
 if(!board.eligible.some(x=>x.url===url))throw fail('NOT_REVIEWED_SOLUTION','只能调查已审核为现有方案的链接',409);
 const clean=(v,max)=>String(v||'').trim().slice(0,max);
 const title=clean(name,150),why=clean(notes,700);
 if(title.length<2||why.length<10)throw fail('RESEARCH_REQUIRED','请填写方案名称与至少10字的人工核查依据');
 const current=board.items.filter(x=>x.url!==url);
 const entry={url,name:title,capabilities:clean(capabilities,700)||null,priceEvidence:clean(priceEvidence,350)||null,
  reportedLimitations:clean(reportedLimitations,700)||null,notes:why,reviewedAt:new Date().toISOString(),
  status:'owner_notes_unverified'};
 return store.transaction(()=>{
  const fresh=alternativeResearchBoard(store,id);
  if(fresh.candidateFingerprint!==candidateFingerprint||fresh.searchRevision!==searchRevision||fresh.reviewRevision!==reviewRevision)throw fail('STALE_EVIDENCE','审核依据已变化，请刷新',409);
  if(fresh.revision!==expected_revision)throw fail('REVISION_CONFLICT','记录已被并发更新',409);
  if(!fresh.eligible.some(x=>x.url===url))throw fail('NOT_REVIEWED_SOLUTION','该链接已经不再是已审核方案',409);
  const item=store.put('opportunity_alternative_research',{id,candidateFingerprint,searchRevision,reviewRevision,items:[...current,entry]},expected_revision);
  store.event('opportunity.alternative_research.reviewed',id,'owner',{url,revision:item.revision});
  return item;
 });
}
