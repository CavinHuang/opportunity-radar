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
