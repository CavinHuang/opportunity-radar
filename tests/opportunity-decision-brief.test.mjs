import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {opportunityDecisionBrief} from '../src/opportunity-decision-brief.mjs';
import {opportunityResearchWorkbench} from '../src/opportunity-research-workbench.mjs';
import {verificationContext} from '../src/problem-verification.mjs';
const seed=db=>{
 db.put('sources',{id:'source',status:'new',url:'https://example.org/post',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
 return opportunityScanCandidates(db).items[0].id;
};
test('unreviewed candidate yields evidence needs, never automatic investment',()=>{
 const db=openDatabase();try{
 const id=seed(db),r=opportunityDecisionBrief(db,id);
 assert.equal(r.disposition,'continue_verification');
 assert.equal(r.marketValidated,false);
 assert.equal(r.canAutoInvest,false);
 assert.equal(r.readOnly,true);
 assert.ok(r.blockers.length>0);
 assert.equal(opportunityResearchWorkbench(db,id).decisionBrief.candidateId,id);
 }finally{db.close();}
});
test('current owner rejection pauses research, source revisions revoke it',()=>{
 const db=openDatabase();try{
 const id=seed(db),ctx=verificationContext(db,id);
 db.put('problem_verifications',{id,fingerprint:ctx.fingerprint,decision:'not_a_real_problem',firsthandConfirmed:false,impactConfirmed:false,alternativeAdequacy:'adequate',notes:'原帖不是实际问题，属于推广信息'});
 let r=opportunityDecisionBrief(db,id);
 assert.equal(r.disposition,'pause_or_stop');
 const s=db.get('sources','source');
 db.put('sources',{...s,description:s.description+' revised'},s.revision);
 r=opportunityDecisionBrief(db,id);
 assert.equal(r.disposition,'continue_verification');
 assert.equal(r.problemVerification,null);
 }finally{db.close();}
});
test('freeform payment claims and feasibility records do not bypass experiment gates',()=>{
 const db=openDatabase();try{
 const id=seed(db);
 db.put('opportunity_feasibility_reviews',{id,candidateFingerprint:'bogus',competitionRevision:0,verificationRevision:0,paymentEvidence:'Users will definitely pay',technicalScope:'Technically possible',falsifier:'No users show interest'});
 const r=opportunityDecisionBrief(db,id);
 assert.equal(r.disposition,'continue_verification');
 assert.equal(r.feasibility.current,false);
 assert.equal(r.marketValidated,false);
 }finally{db.close();}
});
