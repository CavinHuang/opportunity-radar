import {candidateContext} from './opportunity-research.mjs';
import {verificationContext} from './problem-verification.mjs';
import {externalResearchStatus} from './opportunity-external-research.mjs';

// Read-only evidence gates: do not translate search hits, model guesses or owner labels
// into independently confirmed consumers, commercial viability, or product approval.
export function opportunityStage(store,id){
 const {candidate,fingerprint}=candidateContext(store,id);
 const ctx=verificationContext(store,id);
 const v=store.get('problem_verifications',id);
 const verified=Boolean(v&&v.fingerprint===ctx.fingerprint);
 const research=externalResearchStatus(store,id).record;
 const searched=Boolean(research&&research.candidateFingerprint===fingerprint);
 const sources=candidate.evidenceDossier?.sources||[];
 const originalSources=sources.length;
 const reviewedProblem=verified&&v.decision==='worth_interviewing'&&v.firsthandConfirmed&&v.impactConfirmed&&
  v.alternativeAdequacy==='inadequate'&&Boolean(v.actualWorkaround);
 const existingSolutionAssessed=searched&&research.sourceStatus?.some(x=>x.status==='ok');
 const interviewPlans=store.list('problem_interview_plans').filter(x=>x.problemId===id);
 const interviewObservations=store.list('problem_interview_observations').filter(x=>x.problemId===id);
 const distinctParticipants=new Set(interviewObservations.map(x=>x.participant).filter(Boolean)).size;
 const interviewed=interviewPlans.some(p=>p.decision==='low_cost_test')&&distinctParticipants>=2;
 const gaps=[];
 if(originalSources<1)gaps.push('缺少可核对的原始问题链接');
 if(originalSources<2)gaps.push('少于两条独立性待验证的原始来源');
 if(!searched)gaps.push('尚未完成与当前原帖版本匹配的外部反证检索');
 if(searched&&!existingSolutionAssessed)gaps.push('所有外部检索来源均失败，无法评估现有方案');
 if(!verified)gaps.push('尚无与当前原帖版本一致的人工问题核查');
 else if(!reviewedProblem)gaps.push('一手经历、实际影响、现有替代方案不足尚未全部得到人工确认');
 if(!interviewed)gaps.push('尚未达到至少两名不同匿名标识访谈对象并获准开展低成本实验');
 const stage=reviewedProblem&&searched&&existingSolutionAssessed&&interviewed?'experiment_review_ready':
   originalSources>=1&&searched&&existingSolutionAssessed?'worth_investigating':'insufficient_evidence';
 return {id,title:candidate.title,stage,originalSources,externalSources:searched?research.results?.length||0:0,
  externalProviderStatus:searched?research.sourceStatus||[]:[],reviewedProblem,distinctParticipantLabels:distinctParticipants,
  evidenceFresh:{problemReview:verified,externalResearch:searched},gaps,nextAction:gaps[0]||'人工审核低成本实验设计与停止条件',
  mayAutoInvest:false,validatedMarketDemand:false,
  notice:'分级是工作流程门槛；人工记录和搜索命中均不能证明独立消费者、产品市场匹配或付费行为。'};
}
