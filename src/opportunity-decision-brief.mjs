import {candidateContext} from './opportunity-research.mjs';
import {opportunityStage} from './opportunity-stages.mjs';
import {opportunityCompetitionSpace} from './opportunity-competition-space.mjs';
import {opportunityFeasibilityBoard} from './opportunity-feasibility.mjs';
import {verificationContext} from './problem-verification.mjs';

// Read-only decision support; do not convert owner notes into market validation.
export function opportunityDecisionBrief(store,id){
 const {candidate,sources}=candidateContext(store,id);
 const stage=opportunityStage(store,id);
 const competition=opportunityCompetitionSpace(store,id);
 const feasibility=opportunityFeasibilityBoard(store,id);
 const verification=store.get('problem_verifications',id);
 const verified=Boolean(verification&&verification.fingerprint===verificationContext(store,id).fingerprint);
 const plans=store.list('problem_interview_plans').filter(p=>p.problemId===id&&
  verified&&p.verificationRevision===verification.revision);
 const observations=store.list('problem_interview_observations').filter(o=>o.problemId===id&&plans.some(p=>p.id===o.planId));
 const designs=store.list('problem_experiment_designs').filter(d=>d.problemId===id&&plans.some(p=>p.id===d.planId));
 const records=store.list('problem_experiment_records').filter(r=>r.problemId===id&&designs.some(d=>d.id===r.designId));
 const closed=designs.filter(d=>d.status==='closed');
 const stopped=verified&&verification.decision==='not_a_real_problem'||
  plans.some(p=>p.decision==='stop')||closed.some(d=>d.decision==='stop');
 const eligibleReview=stage.stage==='experiment_review_ready'&&
  feasibility.current&&!!feasibility.inputs?.technicalScope&&!!feasibility.inputs?.falsifier;
 const disposition=stopped?'pause_or_stop':eligibleReview?'review_small_experiment':'continue_verification';
 const blockers=[...stage.gaps,...feasibility.needs,...competition.missing];
 const unique=[...new Set(blockers)];
 const nextAction=stopped?'复核明确反证及停止原因，不自动恢复投入':
  disposition==='review_small_experiment'?'人工核对最小实验的预算、成功指标和停止条件':
  unique[0]||'继续核对原始证据并记录真实用户行为';
 return {candidateId:id,title:candidate.title,summary:candidate.summary,sourceUrls:sources.map(s=>s.url),
  disposition,stage:stage.stage,problemVerification:verified?{decision:verification.decision,notes:verification.notes,
   firsthandConfirmed:verification.firsthandConfirmed,impactConfirmed:verification.impactConfirmed}:null,
  alternatives:competition.items,competitionAssessment:competition.assessment,
  feasibility:{current:feasibility.current,inputs:feasibility.inputs,evidence:feasibility.evidence},
  interview:{plans:plans.length,observations:observations.length,
   distinctParticipantLabels:new Set(observations.map(x=>x.participant).filter(Boolean)).size},
  experiments:{designs:designs.length,recordCount:records.length,closed:closed.map(x=>({decision:x.decision,reason:x.decisionReason||null}))},
  blockers:unique,nextAction,canAutoInvest:false,marketValidated:false,readOnly:true,
  notice:'这是研究下一步的证据导航，不是产品投资建议。人工记录、访谈匿名标识或实验结论不证明独立消费者及付费需求；停止状态仍需人工复核。'};
}
