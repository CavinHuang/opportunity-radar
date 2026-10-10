import {randomUUID} from 'node:crypto';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(value,label,min=10,max=1800)=>{
 const s=String(value??'').trim();
 if(s.length<min||s.length>max)throw fail('FEEDBACK_INPUT',label+' must be '+min+'-'+max+' characters');
 return s;
};
function https(value){
 if(!value)return null;
 let url;try{url=new URL(value)}catch{throw fail('FEEDBACK_INPUT','Invalid evidence URL');}
 if(url.protocol!=='https:'||url.username||url.password)throw fail('FEEDBACK_INPUT','Evidence URL must be public HTTPS without credentials');
 url.hash='';return url.href;
}
/** Only an explicit closed "continue" decision can be cited as approved research.
 * The record may still contain unverified Owner-reported consumer observations. */
export function approvedResearchBasis(store,opportunityId,planId){
 if(!planId)return {status:'unlinked',warning:'No approved pre-build research decision linked; customer demand is not established'};
 const plan=store.get('validation_plans',planId);
 if(!plan||plan.opportunityId!==opportunityId)throw fail('RESEARCH_PLAN_MISMATCH','Research decision is not for this opportunity',409);
 if(plan.status!=='closed'||plan.outcome!=='continue'||plan.decisionBy!=='owner')
  throw fail('RESEARCH_NOT_APPROVED','Only an Owner-closed continue decision may support a build',409);
 const newest=store.list('validation_plans').find(x=>x.opportunityId===opportunityId);
 if(newest?.id!==planId)throw fail('RESEARCH_PLAN_SUPERSEDED','A more recent research round exists; reassess before launching development',409);
 const rows=store.list('validation_observations').filter(x=>x.planId===planId);
 const count={supports:0,contradicts:0,unclear:0};
 for(const row of rows)count[row.stance]++;
 return {status:'linked_owner_decision',planId:plan.id,planRevision:plan.revision,
  opportunityId,decidedAt:plan.closedAt,decision:'continue',decisionReason:plan.decisionReason,
  hypothesis:plan.hypothesis,successCriterion:plan.successCriterion,stopCondition:plan.stopCondition,
  observationCount:rows.length,stanceCounts:count,
  independentParticipantClaims:new Set(rows.map(x=>x.participantRef.toLowerCase())).size,
  warning:'Owner-reported observations; no external identity or commercial-demand verification'};
}
export function feedbackOverview(store,projectId){
 const project=store.get('projects',projectId);
 if(!project)throw fail('NOT_FOUND','Project not found',404);
 const feedback=store.list('product_feedback').filter(x=>x.projectId===projectId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const counts={activation:0,reuse:0,issue:0,request:0,other:0};
 for(const f of feedback)counts[f.kind]++;
 const milestone=store.list('milestones').find(m=>m.projectId===projectId&&m.order===2);
 return {projectId,approvedResearchBasis:project.researchBasis||{status:'unlinked'},productMilestoneAccepted:milestone?.acceptanceState==='accepted',
  feedback,counts,distinctAnonymousRefs:new Set(feedback.map(f=>f.participantRef.toLowerCase())).size,
  totalRecords:feedback.length,externallyVerified:0,
  warning:'Owner-entered usage observations are not verified by the application and must not be presented as audited product metrics'};
}
export function recordProductFeedback(store,projectId,data){
 return store.transaction(()=>{
  const project=store.get('projects',projectId);
  if(!project)throw fail('NOT_FOUND','Project not found',404);
  const milestone=store.list('milestones').find(m=>m.projectId===projectId&&m.order===2);
  if(!milestone||milestone.acceptanceState!=='accepted')throw fail('PRODUCT_NOT_ACCEPTED','Post-launch usage recording requires Owner-accepted product delivery',409);
  if(!['activation','reuse','issue','request','other'].includes(data.kind))throw fail('FEEDBACK_INPUT','Invalid usage feedback type');
  if(data.consentConfirmed!==true)throw fail('CONSENT_REQUIRED','Consent to record customer feedback is required',409);
  const participantRef=clean(data.participantRef,'Anonymous participant reference',2,64);
  if(/[@\s]|\d{11}/.test(participantRef))throw fail('FEEDBACK_INPUT','Use an anonymous reference, not direct contact details');
  const observedAt=String(data.observedAt||new Date().toISOString());
  const dt=Date.parse(observedAt);
  if(!Number.isFinite(dt)||dt>Date.now()+60_000)throw fail('FEEDBACK_INPUT','Invalid or future observation time');
  const item=store.put('product_feedback',{id:randomUUID(),projectId,opportunityId:project.opportunityId,
   milestoneId:milestone.id,participantRef,kind:data.kind,summary:clean(data.summary,'Concrete usage observation',20,1800),
   evidenceUrl:https(data.evidenceUrl),observedAt:new Date(dt).toISOString(),createdAt:new Date().toISOString(),
   consentConfirmed:true,recordedBy:'owner',verificationState:'owner_reported_unverified',
   baselineRevision:project.baselines.at(-1).revision});
  store.event('product.feedback.recorded',item.id,'owner',{projectId,kind:item.kind},projectId);
  return item;
 });
}
