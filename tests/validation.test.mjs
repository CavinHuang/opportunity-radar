import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {createValidationPlan,recordValidationObservation,closeValidationPlan,validationSummary,validationOverview} from '../src/validation.mjs';

function fixture(){
 const db=openDatabase();const service=createService(db);
 const o=service.createOpportunity({title:'Receipt problem',problem:'Consumers repeatedly lose receipts after shopping',market:'International'});
 return {db,o};
}
const planInput={
 audience:'People managing family receipts',
 hypothesis:'At least some households repeatedly fail to retrieve receipts.',
 researchQuestion:'How often did you need to retrieve a receipt in the last month?',
 channel:'Opt-in customer research in forum',
 successCriterion:'Two independent users describe a recent real retrieval failure',
 stopCondition:'Stop after ten hours of outreach without useful findings',
 nextAction:'Reach out to three people willing to describe their last receipt issue',
 timeBudgetHours:6,cashBudget:0
};
const observed={
 participantRef:'anon-001',kind:'interview',stance:'contradicts',
 note:'This is a mock test record only; the participant did not experience recurring receipt loss.',
 consentConfirmed:true
};
test('plans require explicit criteria and enforce one active plan per opportunity',()=>{
 const {db,o}=fixture();try{
 assert.throws(()=>createValidationPlan(db,o.id,{...planInput,successCriterion:'short'}),{code:'VALIDATION_INPUT'});
 const plan=createValidationPlan(db,o.id,planInput);assert.equal(plan.status,'active');
 assert.equal(validationOverview(db)[0].status,'active');
 assert.throws(()=>createValidationPlan(db,o.id,planInput),{code:'VALIDATION_ACTIVE'});
 assert.equal(validationSummary(db,o.id).observationCount,0);
 }finally{db.close();}
});
test('observations require anonymous refs, affirmative recording consent and real notes',()=>{
 const {db,o}=fixture();try{
 const p=createValidationPlan(db,o.id,planInput);
 assert.throws(()=>recordValidationObservation(db,o.id,p.id,{...observed,consentConfirmed:false}),{code:'CONSENT_REQUIRED'});
 assert.throws(()=>recordValidationObservation(db,o.id,p.id,{...observed,participantRef:'test@example.com'}),{code:'VALIDATION_INPUT'});
 assert.throws(()=>recordValidationObservation(db,o.id,p.id,{...observed,note:'too brief'}),{code:'VALIDATION_INPUT'});
 const row=recordValidationObservation(db,o.id,p.id,observed);
 assert.equal(row.basis,'owner_reported');assert.equal(row.independentlyVerified,false);
 assert.equal(validationSummary(db,o.id).counts.contradicts,1);
 }finally{db.close();}
});
test('multiple observations from one participant do not count as independent people',()=>{
 const {db,o}=fixture();try{
 const p=createValidationPlan(db,o.id,planInput);
 recordValidationObservation(db,o.id,p.id,observed);
 recordValidationObservation(db,o.id,p.id,{...observed,kind:'observed_use',stance:'supports'});
 const s=validationSummary(db,o.id);assert.equal(s.observationCount,2);assert.equal(s.distinctParticipantRefs,1);
 assert.equal(s.counts.supports,1);assert.equal(s.counts.contradicts,1);
 }finally{db.close();}
});
test('without observations user cannot claim a validated go decision',()=>{
 const {db,o}=fixture();try{
 const p=createValidationPlan(db,o.id,planInput);
 const closing={outcome:'continue',reason:'We think this idea deserves further research.',expected_revision:p.revision,acknowledgeUncertainty:true};
 assert.throws(()=>closeValidationPlan(db,o.id,p.id,closing),{code:'INSUFFICIENT_OBSERVATIONS'});
 const result=closeValidationPlan(db,o.id,p.id,{...closing,outcome:'inconclusive'});
 assert.equal(result.status,'closed');assert.equal(result.actualEvidenceVerified,false);
 assert.throws(()=>recordValidationObservation(db,o.id,p.id,observed),{code:'VALIDATION_CLOSED'});
 const newPlan=createValidationPlan(db,o.id,planInput);assert.notEqual(newPlan.id,p.id);
 }finally{db.close();}
});
test('optimistic version, uncertainty and ownership of plan are enforced',()=>{
 const {db,o}=fixture();try{
 const p=createValidationPlan(db,o.id,planInput);
 recordValidationObservation(db,o.id,p.id,observed);
 const closing={outcome:'continue',reason:'The first interview suggests a real problem to investigate.',expected_revision:p.revision};
 assert.throws(()=>closeValidationPlan(db,o.id,p.id,{...closing,expected_revision:999}),{code:'REVISION_CONFLICT'});
 assert.throws(()=>closeValidationPlan(db,o.id,p.id,closing),{code:'UNCERTAINTY_ACK_REQUIRED'});
 const finished=closeValidationPlan(db,o.id,p.id,{...closing,acknowledgeUncertainty:true});
 assert.equal(finished.decisionBy,'owner');assert.equal(finished.actualEvidenceVerified,false);
 assert.equal(validationSummary(db,o.id).decisions[0].outcome,'continue');
 assert.throws(()=>closeValidationPlan(db,o.id,p.id,{...closing,acknowledgeUncertainty:true}),{code:'VALIDATION_CLOSED'});
 }finally{db.close();}
});
test('opportunity and validation-plan bindings reject foreign references',()=>{
 const {db,o}=fixture();try{
 const other=createService(db).createOpportunity({title:'Another',problem:'Different experience altogether',market:'China'});
 const p=createValidationPlan(db,o.id,planInput);
 assert.throws(()=>recordValidationObservation(db,other.id,p.id,observed),{code:'NOT_FOUND'});
 assert.throws(()=>validationSummary(db,'does-not-exist'),{code:'NOT_FOUND'});
 assert.equal(validationOverview(db).length,2);
 }finally{db.close();}
});
