import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {createValidationPlan,recordValidationObservation,closeValidationPlan} from '../src/validation.mjs';
import {approvedResearchBasis,recordProductFeedback,feedbackOverview} from '../src/delivery-trace.mjs';

function fixture(){
 const store=openDatabase(),service=createService(store);
 const opportunity=service.createOpportunity({title:'Household receipts',problem:'People may lose important household receipts',market:'International'});
 return {store,service,opportunity};
}
const planInput={audience:'Adults managing purchases',hypothesis:'Households sometimes fail to retrieve purchase receipts.',
 researchQuestion:'When was the most recent failure to find a receipt?',
 channel:'Opt-in research forum',
 successCriterion:'Two independent detailed reports are observed before deciding',
 stopCondition:'Stop after six hours with no real observations',
 nextAction:'Invite three consenting people for short conversations'};
const observation={participantRef:'anon-u01',kind:'interview',stance:'contradicts',
 note:'Synthetic test example that does not establish any real demand or willingness to pay.',consentConfirmed:true};
const experimentInput=o=>({opportunityId:o.id,goal:'Deliver minimally useful prototype',
 hypothesis:'A small UI helps people locate receipts',criteria:['One clear core flow is usable'],stopCondition:'Stop after ten hours',
 hours:7,cash:0});
function approved(store,id){
 const p=createValidationPlan(store,id,planInput);
 recordValidationObservation(store,id,p.id,observation);
 return closeValidationPlan(store,id,p.id,{expected_revision:p.revision,outcome:'continue',
  reason:'An Owner decision to investigate further with the contradictions still unresolved.',
  acknowledgeUncertainty:true});
}
test('only a completed Owner-approved continue decision can be linked to development',()=>{
 const {store,service,opportunity:o}=fixture();try{
 const p=createValidationPlan(store,o.id,planInput);
 assert.throws(()=>approvedResearchBasis(store,o.id,p.id),{code:'RESEARCH_NOT_APPROVED'});
 assert.throws(()=>service.startExperiment({...experimentInput(o),validationPlanId:p.id}),{code:'RESEARCH_NOT_APPROVED'});
 const other=service.createOpportunity({title:'Another consumer problem',problem:'Another concrete use case',market:'China'});
 assert.throws(()=>service.startExperiment({...experimentInput(other),validationPlanId:p.id}),{code:'RESEARCH_PLAN_MISMATCH'});
 recordValidationObservation(store,o.id,p.id,observation);
 const closed=closeValidationPlan(store,o.id,p.id,{expected_revision:p.revision,outcome:'pivot',
  reason:'The original hypothesis should be changed and tested further.'});
 assert.equal(closed.outcome,'pivot');
 assert.throws(()=>service.startExperiment({...experimentInput(o),validationPlanId:p.id}),{code:'RESEARCH_NOT_APPROVED'});
 }finally{store.close();}
});
test('approved immutable research snapshot reaches baseline and Agent with no participant data',()=>{
 const {store,service,opportunity:o}=fixture();try{
 const plan=approved(store,o.id);
 const project=service.startExperiment({...experimentInput(o),validationPlanId:plan.id});
 assert.equal(project.researchBasis.planId,plan.id);
 assert.equal(project.researchBasis.stanceCounts.contradicts,1);
 assert.equal(project.baselines[0].researchBasis.status,'linked_owner_decision');
 const context=service.tool('project.get_context',{project_id:project.id});
 assert.equal(context.researchBasis.planId,plan.id);
 const serialized=JSON.stringify(context);
 assert.ok(!serialized.includes('anon-u01'));
 assert.ok(!serialized.includes(observation.note));
 assert.equal(context.researchBasis.independentParticipantClaims,1);
 assert.equal(context.researchBasis.warning.includes('no external identity'),true);
 }finally{store.close();}
});
test('unlinked legacy experiment is explicitly labelled, never represented as approved research',()=>{
 const {store,service,opportunity:o}=fixture();try{
 const project=service.startExperiment(experimentInput(o));
 assert.equal(project.researchBasis.status,'unlinked');
 assert.equal(service.tool('project.get_context',{project_id:project.id}).researchBasis.status,'unlinked');
 }finally{store.close();}
});
test('post-delivery usage must follow acceptance and affirmative consent',()=>{
 const {store,service,opportunity:o}=fixture();try{
 const project=service.startExperiment(experimentInput(o));
 const request={participantRef:'guest-01',kind:'activation',summary:'A synthetic test user allegedly completed one main task.',consentConfirmed:true};
 assert.throws(()=>recordProductFeedback(store,project.id,request),{code:'PRODUCT_NOT_ACCEPTED'});
 const milestone=service.getFullProject(project.id).milestones.find(x=>x.order===2);
 store.put('milestones',{...milestone,acceptanceState:'accepted'},milestone.revision);
 assert.throws(()=>recordProductFeedback(store,project.id,{...request,consentConfirmed:false}),{code:'CONSENT_REQUIRED'});
 assert.throws(()=>recordProductFeedback(store,project.id,{...request,participantRef:'consumer@example.com'}),{code:'FEEDBACK_INPUT'});
 const item=recordProductFeedback(store,project.id,request);
 assert.equal(item.verificationState,'owner_reported_unverified');
 const summary=feedbackOverview(store,project.id);
 assert.equal(summary.productMilestoneAccepted,true);
 assert.equal(summary.counts.activation,1);
 assert.equal(summary.externallyVerified,0);
 assert.equal(summary.distinctAnonymousRefs,1);
 }finally{store.close();}
});
test('usage is scoped to a project and records repeat participants without overstating counts',()=>{
 const {store,service,opportunity:o}=fixture();try{
 const project=service.startExperiment(experimentInput(o));
 const milestone=service.getFullProject(project.id).milestones.find(x=>x.order===2);
 store.put('milestones',{...milestone,acceptanceState:'accepted'},milestone.revision);
 const a={participantRef:'guest-01',kind:'reuse',summary:'Synthetic repeated use record; test only, not a real customer.',consentConfirmed:true};
 recordProductFeedback(store,project.id,a);
 recordProductFeedback(store,project.id,{...a,kind:'issue'});
 const out=feedbackOverview(store,project.id);
 assert.equal(out.totalRecords,2);assert.equal(out.distinctAnonymousRefs,1);
 assert.equal(out.counts.reuse,1);assert.equal(out.counts.issue,1);
 assert.throws(()=>feedbackOverview(store,'unknown'),{code:'NOT_FOUND'});
 }finally{store.close();}
});

test('Owner can prepare exactly one claimable kickoff task per approved baseline',()=>{
 const {store,service,opportunity:o}=fixture();try{
 const plan=approved(store,o.id);
 const project=service.startExperiment({...experimentInput(o),validationPlanId:plan.id});
 const a=service.prepareKickoff(project.id);
 assert.equal(a.alreadyPrepared,false);
 assert.equal(a.task.status,'open');
 assert.equal(a.task.baselineRevision,1);
 assert.ok(a.task.description.includes('Acceptance criteria:'));
 assert.ok(a.task.description.includes('linked_owner_decision'));
 const again=service.prepareKickoff(project.id);
 assert.equal(again.alreadyPrepared,true);assert.equal(again.task.id,a.task.id);
 const next=service.tool('project.get_next_work',{project_id:project.id});
 assert.ok(next.tasks.some(t=>t.id===a.task.id));
 service.ownerDecision(project.id,{action:'revise_baseline',reason:'Clarified acceptance of the actual MVP',
  criteria:['The user can complete the core receipt recovery flow safely']});
 const revised=service.prepareKickoff(project.id);
 assert.equal(revised.task.baselineRevision,2);assert.notEqual(revised.task.id,a.task.id);
 assert.equal(store.get('tasks',a.task.id).status,'blocked');
 assert.equal(service.tool('project.get_next_work',{project_id:project.id}).tasks.some(t=>t.id===a.task.id),false);
 }finally{store.close();}
});

test('newer research rounds supersede older continue decisions',()=>{
 const {store,service,opportunity:o}=fixture();try{
 const old=approved(store,o.id);
 const newer=createValidationPlan(store,o.id,planInput);
 assert.equal(newer.status,'active');
 assert.throws(()=>service.startExperiment({...experimentInput(o),validationPlanId:old.id}),{code:'RESEARCH_PLAN_SUPERSEDED'});
 }finally{store.close();}
});
