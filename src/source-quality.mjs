import {canonicalArticleUrl} from './source-hub.mjs';

const identity=(item,signal)=>signal?.author
  ? `${new URL(item.url).hostname.toLowerCase()}|${signal.author.trim().toLowerCase()}`
  : item.url;

/**
 * Observational feedback, NOT a verified-demand score.
 * A story may belong to multiple feeds; totals across feeds are not additive.
 */
export function sourceQualityReport(store,{nowMs=Date.now()}={}){
 const feeds=store.list('feeds'),signals=store.list('sources'),opportunities=store.list('opportunities');
 const opportunityEvidence=new Map();
 for(const opportunity of opportunities)for(const evidence of opportunity.sources||[]){
   if(!evidence.url)continue;
   let url;try{url=canonicalArticleUrl(evidence.url)}catch{continue}
   if(!opportunityEvidence.has(url))opportunityEvidence.set(url,[]);
   opportunityEvidence.get(url).push({opportunity,evidence});
 }
 const items=feeds.map(feed=>{
   const captured=signals.filter(s=>(s.feedIds||[]).includes(feed.id));
   const linkedIds=new Set(),reviewedUrls=new Set(),firsthandIdentity=new Set();
   let unreviewedLinked=0;
   for(const signal of captured){
     const matches=opportunityEvidence.get(signal.url)||[];
     if(matches.length&&!matches.some(({evidence})=>evidence.reviewedAt))unreviewedLinked++;
     for(const {opportunity,evidence} of matches){
       linkedIds.add(opportunity.id);
       if(evidence.reviewedAt){
         reviewedUrls.add(signal.url);
         if(evidence.firsthand===true&&evidence.independent===true)firsthandIdentity.add(identity(evidence,signal));
       }
     }
   }
   const counts=Object.fromEntries(['new','saved','dismissed','converted'].map(status=>[status,captured.filter(s=>s.status===status).length]));
   const firsthand=firsthandIdentity.size;
   const newest=captured.map(s=>s.createdAt).filter(Boolean).sort().at(-1)||null;
   const due=feed.enabled&&(!feed.nextScanAt||!Number.isFinite(Date.parse(feed.nextScanAt))||Date.parse(feed.nextScanAt)<=nowMs);
   return {feedId:feed.id,title:feed.title,market:feed.market,enabled:feed.enabled,url:feed.url,
     lastCheckedAt:feed.lastCheckedAt||null,lastSuccessAt:feed.lastSuccessAt||null,nextScanAt:feed.nextScanAt||null,
     failing:Boolean(feed.lastError),consecutiveFailures:feed.consecutiveFailures||0,due:Boolean(due),
     captured:captured.length,counts,linkedOpportunities:linkedIds.size,reviewedEvidenceUrls:reviewedUrls.size,
     ownerReviewedIndependentFirsthand:firsthand,unreviewedLinked,latestSignalAt:newest,
     assessment:feed.lastError?'scan_problem':!feed.lastSuccessAt?'not_scanned':!captured.length?'no_signals':
       firsthand?'has_owner_reviewed_evidence':linkedIds.size?'needs_original_review':'untriaged',
     warning:'Captures and owner-classified stories do not establish willingness to pay.'};
 });
 const linkedOpportunities=new Set();
 for(const signal of signals)if((signal.feedIds||[]).length)for(const {opportunity} of opportunityEvidence.get(signal.url)||[])linkedOpportunities.add(opportunity.id);
 return {generatedAt:new Date(nowMs).toISOString(),overview:{
    configuredSources:feeds.length,healthySources:items.filter(x=>x.lastSuccessAt&&!x.failing).length,
    failingSources:items.filter(x=>x.failing).length,uniqueSignals:new Set(signals.map(s=>s.url)).size,
    linkedOpportunities:linkedOpportunities.size,
    sourcesWithOwnerReviewedFirsthand:items.filter(x=>x.ownerReviewedIndependentFirsthand>0).length},
   ranking:items.map(x=>({...x,observedUtility:x.ownerReviewedIndependentFirsthand*5+x.linkedOpportunities*2+x.counts.saved,rankingCaveat:'仅供优先复核的观察排序，非需求真实性评分'})).sort((a,b)=>b.observedUtility-a.observedUtility||a.title.localeCompare(b.title)),
   items,notes:[
    'One story may be present in multiple feeds. Do not sum source counts as independent users.',
    'Firsthand and independent labels reflect owner review; author identity is not independently verified.',
    'Captured posts, associated opportunities and manual review do not prove product demand or willingness to pay.'
   ]};
}
