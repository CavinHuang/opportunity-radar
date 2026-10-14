export const COMPARISON_POLICY='task-comparison-v1';

/** Only current server-generated drafts influence presentation; never owner classification. */
export function currentEvidenceComparisons(store,id,{current,candidateFingerprint,searchRevision,results}){
 const row=store.get('opportunity_evidence_comparisons',id);
 if(!current||row?.policy!==COMPARISON_POLICY||row.candidateFingerprint!==candidateFingerprint||row.searchRevision!==searchRevision)return [];
 const urls=new Set(results.map(x=>x.url));
 return (row.items||[]).filter(x=>urls.has(x.url)&&x.status==='unreviewed_model_draft'&&
  ['same_task','different_task','uncertain'].includes(x.comparison?.taskRelation));
}
