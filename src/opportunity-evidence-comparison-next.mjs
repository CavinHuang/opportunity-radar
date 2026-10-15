import {evidenceReviewBoard} from './opportunity-evidence-review.mjs';
import {draftEvidenceComparison} from './opportunity-evidence-comparison.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const reasons={LLM_UNGROUNDED_QUOTE:'引用未通过核对，未保存草稿',LLM_INVALID_RESPONSE:'模型返回格式无效，未保存草稿',
 LLM_NOT_CONFIGURED:'研究模型尚未配置',LLM_HTTP_ERROR:'模型服务请求失败',BAD_LLM_ENDPOINT:'模型地址配置无效',
 LLM_TIMEOUT:'模型响应超时，未保存新草稿，可单独重试',LLM_UNAVAILABLE:'暂时无法连接研究模型，可稍后重试'};
function pendingHits(board){
 const saved=new Set(board.comparisons.map(x=>x.url));
 return [...board.queue.priority,...board.queue.other,...board.queue.differentTask].filter(x=>!saved.has(x.url));
}
/** One bounded owner-requested step; no background loop and no owner classifications. */
export async function continueEvidenceComparisons(store,id,{candidateFingerprint,searchRevision,limit=2,skipUrls=[]}={},options={}){
 const board=evidenceReviewBoard(store,id);
 if(!board.current||candidateFingerprint!==board.candidateFingerprint||searchRevision!==board.searchRevision)
  throw fail('STALE_EVIDENCE','证据已变化，请重新打开复核列表',409);
 if(!Number.isInteger(limit)||limit<1||limit>2)throw fail('BAD_REQUEST','每次只支持对照1至2条线索');
 const allowed=new Set(board.results.map(x=>x.url));
 if(!Array.isArray(skipUrls)||skipUrls.length>35||skipUrls.some(x=>typeof x!=='string'||!allowed.has(x)))
  throw fail('BAD_REQUEST','跳过列表必须来自当前检索结果');
 const skipped=new Set(skipUrls);
 const selected=pendingHits(board).filter(x=>!skipped.has(x.url)).slice(0,limit);
 const results=await Promise.all(selected.map(async hit=>{
  try{return {url:hit.url,title:hit.title,status:'saved',draft:await draftEvidenceComparison(store,id,
   {url:hit.url,candidateFingerprint,searchRevision},options)};}
  catch(e){return {url:hit.url,title:hit.title,status:'failed',code:e.code==='STALE_EVIDENCE'?'STALE_EVIDENCE':reasons[e.code]?e.code:'MODEL_UNAVAILABLE',
   reason:reasons[e.code]||'对照未完成，可单独重试或直接人工核查'};}
 }));
 const fresh=evidenceReviewBoard(store,id);
 if(!fresh.current||fresh.candidateFingerprint!==candidateFingerprint||fresh.searchRevision!==searchRevision||results.some(x=>x.code==='STALE_EVIDENCE'))
  throw fail('STALE_EVIDENCE','对照期间证据已变化，请重新打开复核列表',409);
 for(const x of results)if(x.status==='failed')skipped.add(x.url);
 const remaining=pendingHits(fresh),available=remaining.filter(x=>!skipped.has(x.url)).length;
 return {candidateId:id,candidateFingerprint,searchRevision,results,skipUrls:[...skipped],
  progress:{total:fresh.results.length,compared:fresh.comparisons.length,pending:remaining.length,available,skipped:remaining.length-available},
  status:results.some(x=>x.status==='failed')?'partial':available?'more':remaining.length?'paused':'complete',
  ownerReviewed:false,marketValidated:false,
  notice:'每次最多对照2条未审核线索，已有有效草稿自动跳过；失败只在本次会话暂时跳过，仍可单独重试，不计为已完成或已人工审核。'};
}
