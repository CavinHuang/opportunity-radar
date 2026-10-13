import {candidateContext} from './opportunity-research.mjs';
import {opportunityStage} from './opportunity-stages.mjs';
import {externalResearchStatus} from './opportunity-external-research.mjs';
import {verificationContext} from './problem-verification.mjs';
import {evidenceReviewBoard} from './opportunity-evidence-review.mjs';

// A single read-only view of existing, versioned evidence. It creates no new
// assertion of demand and never launches interviews, experiments or searches.
export function opportunityResearchWorkbench(store,id){
 const {candidate,sources,fingerprint}=candidateContext(store,id);
 const stage=opportunityStage(store,id);
 const review=store.get('problem_verifications',id);
 const verificationCurrent=Boolean(review&&review.fingerprint===verificationContext(store,id).fingerprint);
 const ext=externalResearchStatus(store,id).record;
 const externalCurrent=Boolean(ext&&ext.candidateFingerprint===fingerprint);
 const research=store.get('opportunity_research',id);
 const researchCurrent=Boolean(research&&research.sourceFingerprint===fingerprint);
 const evidenceReview=evidenceReviewBoard(store,id);
 const timeline=store.eventsLatest(400).filter(x=>x.entity_id===id&&(String(x.kind||'').startsWith('opportunity.')||String(x.kind||'').startsWith('problem.'))).slice(-35).reverse();
 const plans=store.list('problem_interview_plans').filter(p=>p.problemId===id);
 const observations=store.list('problem_interview_observations').filter(o=>o.problemId===id);
 const experiments=store.list('problem_experiment_designs').filter(e=>e.problemId===id);
 const planRows=plans.map(p=>({id:p.id,status:p.status,decision:p.decision||null,createdAt:p.createdAt||null,
  observationCount:observations.filter(o=>o.planId===p.id).length,
  currentVerification:Boolean(verificationCurrent&&p.verificationRevision===review.revision)}));
 const actions=[{id:'external-research',label:externalCurrent?'重新检索外部反证':'检索外部反证',available:true},
  {id:'verify-problem',label:verificationCurrent?'重新核查真实问题':'核查真实问题',available:true},
  {id:'problem-interviews',label:'制定或查看访谈计划',available:verificationCurrent&&review.decision==='worth_interviewing'},
  {id:'interview-decision',label:'访谈结果决策',available:plans.some(p=>p.status==='active')},
  {id:'experiment-design',label:'低成本实验设计',available:verificationCurrent&&review.decision==='worth_interviewing'&&plans.some(p=>p.decision==='low_cost_test'&&p.verificationRevision===review.revision)},
  {id:'research-opportunity',label:'AI 研究草稿（可选）',available:true}];
 const nextAction=!externalCurrent?'external_research':!verificationCurrent?'problem_verification':
  !plans.some(p=>p.status==='active'||p.status==='closed'&&p.decision==='low_cost_test')?'interview_plan':
  !experiments.length?'experiment_readiness':'review_evidence';
 return {candidate:{id,title:candidate.title,summary:candidate.summary,
    signalCount:candidate.signalCount,sourceUrls:candidate.sourceUrls,
    evidenceDossier:candidate.evidenceDossier,qualityReview:candidate.qualityReview},
  sourceFingerprint:fingerprint,originalSources:sources,stage,
  external:{current:externalCurrent,stale:!!ext&&!externalCurrent,
   searchedAt:ext?.searchedAt||null,sourceStatus:externalCurrent?ext.sourceStatus||[]:[],
   results:externalCurrent?(ext.results||[]).slice(0,20):[],
   analysis:externalCurrent?ext.analysis||null:null},
  verification:{current:verificationCurrent,stale:!!review&&!verificationCurrent,
   decision:verificationCurrent?review.decision:null,
   confirmedFirsthand:verificationCurrent?review.firsthandConfirmed===true:false,
   impactConfirmed:verificationCurrent?review.impactConfirmed===true:false,
   alternativeAdequacy:verificationCurrent?review.alternativeAdequacy||'unknown':'unknown'},
  aiResearch:{current:researchCurrent,stale:!!research&&!researchCurrent,
   decision:researchCurrent?research.decision:null,sections:researchCurrent?research.sections:null},
  interviews:{plans:planRows,observationCount:observations.length},
  experiments:{designCount:experiments.length,drafts:experiments.slice(0,8).map(e=>({id:e.id,status:e.status,planId:e.planId}))},
  evidenceReview:{current:evidenceReview.current,revision:evidenceReview.revision,searchRevision:evidenceReview.searchRevision,reviews:evidenceReview.reviews},
  timeline:timeline.map(x=>({kind:x.kind,at:x.created_at,actor:x.actor,detail:x.detail})),
  nextAction,actions,readOnly:false,validatedMarketDemand:false,
  notice:'统一视图仅汇集已有记录。外部搜索命中、人工核查及访谈数量不代表经过独立验证的商业需求；过期证据不用于当前结论。'};
}
