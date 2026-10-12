import {randomUUID} from 'node:crypto';
import {titleSimilarity} from './discovery.mjs';
const overlap=(a,b)=>(a||[]).some(x=>(b||[]).includes(x));
/** Stable local identities built only from previously AI-kept observations. */
export function resolveOpportunityIdentity(store,candidate,{at=new Date().toISOString()}={}){
 const identities=store.list('home_opportunity_identities');
 const previous=identities.map(x=>({item:x,score:x.candidateIds?.includes(candidate.id)?2:overlap(x.sourceUrls,candidate.sourceUrls)?1.5:titleSimilarity(x.title,candidate.title)}))
 .filter(x=>x.score>=0.62).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
 const selected=previous[0]?.item;
 const id=selected?.id||randomUUID();
 const links=[...new Set([...(selected?.sourceUrls||[]),...(candidate.sourceUrls||[])])].slice(0,100);
 const fresh=(candidate.sourceUrls||[]).filter(x=>!(selected?.sourceUrls||[]).includes(x));
 return {id,title:selected?.title||candidate.title,sourceUrls:links,candidateIds:[...new Set([...(selected?.candidateIds||[]),candidate.id])].slice(-50),
   firstSeenAt:selected?.firstSeenAt||at,lastSeenAt:at,observations:(selected?.observations||0)+1,
   change:selected?fresh.length?'new_evidence':'seen_before':'new_since_previous_scan',
   addedSourceCount:fresh.length,revision:selected?.revision||0};
}
export function persistOpportunityIdentities(store,items,{at=new Date().toISOString()}={}){
 const results=[];
 for(const item of items){
  const identity=resolveOpportunityIdentity(store,item,{at});
  const saved=store.put('home_opportunity_identities',identity,identity.revision);
  store.put('home_opportunity_identity_events',{id:randomUUID(),identityId:saved.id,candidateId:item.id,at,addedSourceCount:identity.addedSourceCount,sourceUrls:item.sourceUrls.slice(0,8)});
  results.push({candidateId:item.id,identityId:saved.id,firstSeenAt:saved.firstSeenAt,observations:saved.observations,knownSources:saved.sourceUrls.length,novelty:identity.change,addedSourceCount:identity.addedSourceCount});
 }
 return results;
}

/** Read-only dossier. Unknown identity never invents history. */
export function opportunityIdentityDossier(store,id){
 const identity=store.get('home_opportunity_identities',id);
 if(!identity)return null;
 const events=store.list('home_opportunity_identity_events').filter(e=>e.identityId===id).sort((a,b)=>(b.at||'').localeCompare(a.at||''));
 const feedback=store.list('home_opportunity_feedback').filter(f=>(identity.candidateIds||[]).includes(f.id)).map(f=>({candidateId:f.id,verdict:f.verdict,reason:f.reason,at:f.at}));
 const decisions=store.list('home_opportunity_decisions').filter(d=>(identity.candidateIds||[]).includes(d.id)).map(d=>({candidateId:d.id,action:d.action,at:d.at}));
 return {id:identity.id,title:identity.title,firstSeenAt:identity.firstSeenAt,lastSeenAt:identity.lastSeenAt,observations:identity.observations,sourceUrls:identity.sourceUrls||[],events,feedback,decisions,identityMethod:'规则关联：候选 ID、来源 URL 或标题相似度；未经人工验证',warning:'扫描次数不等于独立用户数，来源数量也不能证明付费需求'};
}
export function opportunityIdentityIndex(store,{limit=100}={}){
 return {items:store.list('home_opportunity_identities').sort((a,b)=>(b.lastSeenAt||'').localeCompare(a.lastSeenAt||'')).slice(0,Math.min(100,Math.max(1,limit))).map(x=>({id:x.id,title:x.title,firstSeenAt:x.firstSeenAt,lastSeenAt:x.lastSeenAt,observations:x.observations,sourceCount:(x.sourceUrls||[]).length})),notice:'仅统计已被 AI 初筛保留的候选身份，不等于已验证商业机会'};
}
