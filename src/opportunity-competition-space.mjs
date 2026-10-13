import {alternativeResearchBoard} from './opportunity-alternative-research.mjs';
import {evidenceReviewBoard} from './opportunity-evidence-review.mjs';
import {verificationContext} from './problem-verification.mjs';

// Owner notes are *claims to investigate*, not verified feature, pricing, or demand facts.
export function opportunityCompetitionSpace(store,id){
 const alternatives=alternativeResearchBoard(store,id);
 const evidence=evidenceReviewBoard(store,id);
 const problem=store.get('problem_verifications',id);
 const currentProblem=Boolean(problem&&problem.fingerprint===verificationContext(store,id).fingerprint);
 const solutionLeads=evidence.reviews.filter(x=>x.classification==='existing_solution');
 const relatedReports=evidence.reviews.filter(x=>x.classification==='related_problem');
 const items=alternatives.items.map(x=>({
  url:x.url,name:x.name,
  coverage:x.capabilities?{status:'owner_reported_unverified',text:x.capabilities}:{status:'unknown',text:null},
  pricing:x.priceEvidence?{status:'owner_reported_unverified',text:x.priceEvidence}:{status:'unknown',text:null},
  limitations:x.reportedLimitations?{status:'owner_reported_unverified',text:x.reportedLimitations}:{status:'unknown',text:null},
  notes:x.notes
 }));
 const withLimits=items.filter(x=>x.limitations.status!=='unknown');
 const missing=[];
 if(!evidence.current)missing.push('未完成当前原帖版本的外部检索');
 if(!solutionLeads.length)missing.push('没有人工分类的现有方案线索：不能视为市场空白');
 if(solutionLeads.length>items.length)missing.push('部分方案线索尚未完成结构化核查');
 if(items.some(x=>x.coverage.status==='unknown'))missing.push('有方案缺少可核对的功能覆盖');
 if(items.some(x=>x.pricing.status==='unknown'))missing.push('有方案缺少价格证据');
 if(!withLimits.length)missing.push('尚无人工记录的现有方案局限');
 if(!currentProblem||problem.decision!=='worth_interviewing')missing.push('真实问题和现有替代方案不足尚未通过当前版本的人工确认');
 const assessment=withLimits.length&&currentProblem&&problem.decision==='worth_interviewing'&&
  problem.alternativeAdequacy==='inadequate'?'hypothesis_for_user_validation':'insufficient_comparison_evidence';
 return {candidateId:id,assessment,items,counts:{reviewedSolutionLeads:solutionLeads.length,
  investigatedAlternatives:items.length,withReportedLimitations:withLimits.length,relatedProblemLeads:relatedReports.length},
  sourceFresh:{external:evidence.current,alternatives:!alternatives.stale,problem:currentProblem},
  missing,nextAction:missing[0]||'对照原帖访谈实际替代方案、切换成本和付费行为',
  marketGapVerified:false,canAutoInvest:false,
  notice:'功能、价格与抱怨均为人工笔记，不等于独立确认的产品事实；搜索结果不足不能推断市场空白。有局限的方案也不等于有付费意愿。'};
}
