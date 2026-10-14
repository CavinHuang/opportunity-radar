import {researchContextForCandidate} from './opportunity-research.mjs';
import {evidenceReviewBoard} from './opportunity-evidence-review.mjs';

/** Summarize existing versioned research without issuing requests or approving demand. */
export function homeResearchSummary(store,candidate){
 const context=researchContextForCandidate(store,candidate);
 const board=evidenceReviewBoard(store,candidate.id,context);
 const record=store.get('opportunity_external_research',candidate.id);
 const base={readOnly:true,marketValidated:false,independentConsumers:'unknown',canAutoInvest:false};
 if(!board.current)return {...base,state:record?'stale':'not_searched',searchedAt:null,automatic:null,
  progress:null,ownerClassifications:null,coverage:'unknown',references:[],
  nextAction:{action:'external-research',label:record?'更新过期检索':'检索现有方案与反证',
   reason:record?'原帖证据已变化，旧检索与人工分类不能用于当前判断':'先检查现有方案、类似问题和反面案例，再决定是否继续验证'}};
 const urls=new Set(board.results.map(x=>x.url));
 const reviews=board.reviews.filter(x=>urls.has(x.url));
 const reviewed=new Set(reviews.map(x=>x.url)).size;
 const ownerClassifications=Object.fromEntries(['related_problem','existing_solution','not_relevant','uncertain'].map(k=>[k,reviews.filter(x=>x.classification===k).length]));
 const counts=record.analysis?.counts;
 const countKeys=['weak_match','related_discussion','related_problem_report','possible_alternative','solution_with_reported_limits'];
 const automatic=counts&&countKeys.every(k=>Number.isInteger(counts[k])&&counts[k]>=0)?Object.fromEntries(countKeys.map(k=>[k,counts[k]])):null;
 const statuses=record.sourceStatus||[];
 const coverage=!statuses.length?'unknown':statuses.every(x=>x.status==='ok')?'complete':'partial';
 const state=board.results.length===0?(coverage==='partial'?'incomplete_search':'no_hits'):
  reviewed===board.results.length?'reviewed':reviewed?'partially_reviewed':'needs_review';
 const nextAction=ownerClassifications.existing_solution?
  {action:'workbench-alternatives',label:'对照已有方案',reason:'人工已标记现有方案，先核查其能力与不足；不要把它视为市场空白'}:
  coverage==='partial'?{action:'external-research',label:'补齐失败的查询',reason:'部分来源未查询成功；已返回结果保留，不能据此判断没有替代方案'}:
  state==='no_hits'?{action:'external-research',label:'扩展查询并核查原帖',reason:'当前查询未命中；空结果不能证明没有竞争或存在需求'}:
  reviewed<board.results.length?{action:'workbench-evidence-review',label:board.queue.priority.length?'优先核查相关线索':'复查弱相关与未分组结果',reason:board.queue.priority.length?'先区分相同问题与已有解决方案，自动相关性不等于独立用户':'重点线索已核查或暂无重点线索；弱相关中也可能有漏判，折叠结果仍需人工复查'}:
  {action:'verify-problem',label:'核对一手经历与实际成本',reason:'外部分类已记录，仍需核查使用主体、当前办法及其实际不足'};
 const references=board.results.filter(x=>x.triageType&&x.triageType!=='weak_match').slice(0,3)
  .filter(x=>{try{return new URL(x.url).protocol==='https:'}catch{return false}})
  .map(x=>({url:x.url,title:x.title,source:x.source,automatedType:x.triageType,verified:false}));
 return {...base,state,searchedAt:record.searchedAt||null,coverage,automatic,
  progress:{total:board.results.length,reviewed,pending:board.results.length-reviewed},priorityProgress:board.queue.priorityProgress,ownerClassifications,references,nextAction,
  notice:'自动初筛与人工分类分开统计；人工分类也不等于独立用户、现有产品能力或付费需求已验证。'};
}
