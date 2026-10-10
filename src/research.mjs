import {canonicalArticleUrl} from './source-hub.mjs';
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const host=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return 'unknown'}};
function tokens(value){
 const x=String(value||'').toLowerCase().replace(/[\[\]【】#.:,，。！？!?()（）]/g,' ').trim();
 return new Set([...(x.match(/[a-z]{3,}/g)||[]),...(x.match(/[\p{Script=Han}]{2,}/gu)||[]).flatMap(s=>Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)))]);
}
function similarity(a,b){const x=tokens(a),y=tokens(b);if(x.size<3||y.size<3)return 0;return [...x].filter(t=>y.has(t)).length/Math.max(x.size,y.size);}
export function researchReport(store,id){
 const o=store.get('opportunities',id);if(!o)throw error('NOT_FOUND','机会不存在',404);
 const signals=store.list('sources'),seen=new Set(),evidence=[];
 for(const row of o.sources||[]){
  if(!row.url?.startsWith('https://'))continue;
  const url=canonicalArticleUrl(row.url);if(seen.has(url))continue;seen.add(url);
  const signal=signals.find(s=>s.url===url);
  const feed=signal?.feedIds?.length?store.get('feeds',signal.feedIds[0]):null;
  evidence.push({url,quote:row.quote||'',domain:host(url),author:signal?.author||null,publishedAt:signal?.publishedAt||null,
   sourceTitle:feed?.title||null,sourceClass:feed?.sourceClass||'unknown',firsthand:row.firsthand===true,
   independent:row.independent===true,reviewedAt:row.reviewedAt||null,reviewNote:row.reviewNote||null,
   origin:row.origin||'unknown',classification:row.reviewedAt?'owner_reviewed':'unreviewed'});
 }
 const reviewed=evidence.filter(e=>e.independent&&e.firsthand&&e.reviewedAt);
 const identities=new Set();
 const confirmed=reviewed.filter(e=>{const key=e.author?e.domain+'|'+e.author.toLowerCase():e.url;
  if(identities.has(key))return false;identities.add(key);return true;});
 const domains=[...new Set(evidence.map(e=>e.domain))];
 const caveats=[];
 if(!evidence.length)caveats.push('缺少原文链接，无法判断问题是否存在');
 if(!confirmed.length)caveats.push('缺少人工核查的独立第一手经历');
 if(confirmed.length===1)caveats.push('仅一条独立经历，需要再次交叉验证');
 if(reviewed.length>confirmed.length)caveats.push('同平台同署名作者多帖不能重复计数');
 if(domains.length===1&&evidence.length)caveats.push('来源集中在一个社区，存在样本偏差');
 caveats.push('公开讨论不能证明使用频率、付费意愿、留存、市场规模或获客成本');
 const relatedCandidates=signals.filter(s=>s.status!=='converted'&&!seen.has(s.url)&&similarity(o.title,s.title)>=0.6)
   .sort((a,b)=>similarity(o.title,b.title)-similarity(o.title,a.title)).slice(0,6)
   .map(s=>({signalId:s.id,title:s.title,url:s.url,similarity:'仅标题相似；须人工确认，未计入证据'}));
 const stage=confirmed.length>=2?'corroborated_unvalidated':confirmed.length===1?'single_observation':'unverified';
 return {opportunityId:id,title:o.title,market:o.market,evidenceCount:evidence.length,
  reviewedIndependentFirsthandCount:confirmed.length,pendingReviewCount:evidence.filter(e=>!e.reviewedAt).length,
  sourceDomains:domains,stage,stageDescription:stage==='corroborated_unvalidated'?'多条人工核查的独立描述，商业价值仍未验证':stage==='single_observation'?'单条独立经历，仍需交叉验证':'只有待核查线索或无证据',
  evidence,relatedCandidates,caveats,opposingReason:o.risk||'缺少反证',nextValidation:o.nextAction||'继续访谈真实消费者',
  businessEvidence:'unknown',recommendation:confirmed.length>=2?'先进行不开发产品的需求验证':confirmed.length===1?'补充另一个消费者的第一手经历':'先阅读原文并联系真实消费者',
  automatedVerification:false,generatedAt:new Date().toISOString()};
}
export function reviewOpportunityEvidence(store,id,data){
 const o=store.get('opportunities',id);if(!o)throw error('NOT_FOUND','机会不存在',404);
 if(data.expected_revision!==o.revision)throw error('REVISION_CONFLICT','机会已变更，重新载入',409);
 if(data.reviewed_original!==true)throw error('REVIEW_REQUIRED','必须阅读原文',409);
 const note=String(data.note||'').trim();if(note.length<12||note.length>700)throw error('REVIEW_REQUIRED','说明必须在12-700字之间',409);
 let url;try{url=canonicalArticleUrl(data.source_url)}catch{throw error('BAD_REQUEST','无效证据地址');}
 const idx=(o.sources||[]).findIndex(x=>x.url===url);
 if(idx<0)throw error('NOT_FOUND','证据不在机会中',404);
 const next=[...o.sources];next[idx]={...next[idx],reviewedAt:new Date().toISOString(),reviewNote:note,reviewer:'owner',
  firsthand:data.firsthand===true,independent:data.firsthand===true&&data.independent===true};
 const saved=store.put('opportunities',{...o,sources:next,evidenceStatus:'needs_verification'},o.revision);
 store.event('opportunity.evidence.reviewed',id,'owner',{url,firsthand:next[idx].firsthand,independent:next[idx].independent});
 return saved;
}
