import {randomUUID} from 'node:crypto';
import {titleSimilarity} from './discovery.mjs';
const overlap=(a,b)=>(a||[]).some(x=>(b||[]).includes(x));
/** Stable local identities built only from previously AI-kept observations. */
export function resolveOpportunityIdentity(store,candidate,{at=new Date().toISOString()}={}){
 const identities=store.list('home_opportunity_identities');
 const blocked=new Set(store.list('home_identity_separations').filter(x=>x.candidateId===candidate.id).map(x=>x.fromIdentityId));
 const previous=identities.filter(x=>!blocked.has(x.id)).map(x=>({item:x,score:x.candidateIds?.includes(candidate.id)?2:overlap(x.sourceUrls,candidate.sourceUrls)?1.5:titleSimilarity(x.title,candidate.title)}))
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
  const prior=item.analysisId&&store.list('home_opportunity_identity_events').find(x=>x.candidateId===item.id&&x.analysisId===item.analysisId);
  const existing=prior&&store.get('home_opportunity_identities',prior.identityId);
  if(existing){
   results.push({candidateId:item.id,identityId:existing.id,firstSeenAt:existing.firstSeenAt,observations:existing.observations,knownSources:existing.sourceUrls.length,novelty:'seen_before',addedSourceCount:0});
   continue;
  }
  const identity=resolveOpportunityIdentity(store,item,{at});
  const saved=store.put('home_opportunity_identities',identity,identity.revision);
  store.put('home_opportunity_identity_events',{id:randomUUID(),identityId:saved.id,candidateId:item.id,...(item.analysisId?{analysisId:item.analysisId}:{}),at,addedSourceCount:identity.addedSourceCount,sourceUrls:item.sourceUrls.slice(0,8)});
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
 return {id:identity.id,revision:identity.revision,candidateIds:identity.candidateIds||[],title:identity.title,firstSeenAt:identity.firstSeenAt,lastSeenAt:identity.lastSeenAt,observations:identity.observations,sourceUrls:identity.sourceUrls||[],events,feedback,decisions,identityMethod:'规则关联：候选 ID、来源 URL 或标题相似度；未经人工验证',warning:'扫描次数不等于独立用户数，来源数量也不能证明付费需求'};
}
export function opportunityIdentityIndex(store,{limit=100}={}){
 return {items:store.list('home_opportunity_identities').sort((a,b)=>(b.lastSeenAt||'').localeCompare(a.lastSeenAt||'')).slice(0,Math.min(100,Math.max(1,limit))).map(x=>({id:x.id,title:x.title,firstSeenAt:x.firstSeenAt,lastSeenAt:x.lastSeenAt,observations:x.observations,sourceCount:(x.sourceUrls||[]).length})),notice:'仅统计已被 AI 初筛保留的候选身份，不等于已验证商业机会'};
}

/** Owner correction: detach a candidate and its observation events from a mistakenly matched identity. */
export function splitOpportunityIdentity(store,id,{candidateId,reason,expected_revision}={}){
 const original=store.get('home_opportunity_identities',id);
 if(!original)throw Object.assign(new Error('历史身份不存在'),{code:'NOT_FOUND',status:404});
 if(expected_revision!==original.revision)throw Object.assign(new Error('档案已变更，请刷新'),{code:'REVISION_CONFLICT',status:409});
 if(!original.candidateIds?.includes(candidateId)||original.candidateIds.length<2)throw Object.assign(new Error('请选择已合并的次要候选'),{code:'BAD_SPLIT',status:400});
 const note=String(reason||'').trim().slice(0,500);
 if(note.length<10)throw Object.assign(new Error('请填写至少10字的拆分原因'),{code:'REASON_REQUIRED',status:400});
 const events=store.list('home_opportunity_identity_events').filter(x=>x.identityId===id&&x.candidateId===candidateId);
 if(!events.length)throw Object.assign(new Error('缺少该候选的历史观察，无法安全拆分'),{code:'MISSING_HISTORY',status:409});
 const others=store.list('home_opportunity_identity_events').filter(x=>x.identityId===id&&x.candidateId!==candidateId);
 const eventLinks=list=>[...new Set(list.flatMap(x=>x.sourceUrls||[]))].slice(0,100);
 const freshId=randomUUID(),at=new Date().toISOString();
 store.transaction(()=>{
  for(const e of events)store.put('home_opportunity_identity_events',{...e,identityId:freshId},e.revision);
  store.put('home_opportunity_identities',{...original,candidateIds:original.candidateIds.filter(x=>x!==candidateId),sourceUrls:eventLinks(others),observations:others.length,firstSeenAt:others.map(x=>x.at).sort()[0]||original.firstSeenAt,lastSeenAt:others.map(x=>x.at).sort().at(-1)||original.lastSeenAt},original.revision);
  store.put('home_opportunity_identities',{id:freshId,title:store.get('sources',candidateId.replace(/^signal:/,''))?.title||original.title,candidateIds:[candidateId],sourceUrls:eventLinks(events),observations:events.length,firstSeenAt:events.map(x=>x.at).sort()[0]||at,lastSeenAt:events.map(x=>x.at).sort().at(-1)||at});
  store.put('home_identity_separations',{id:randomUUID(),candidateId,fromIdentityId:id,toIdentityId:freshId,reason:note,at});
  store.event('home.identity.split',id,'owner',{candidateId,toIdentityId:freshId,reason:note});
 });
 return {fromIdentityId:id,toIdentityId:freshId,candidateId};
}
