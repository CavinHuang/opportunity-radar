import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {opportunityPortfolioReview} from '../src/opportunity-portfolio-review.mjs';
const put=(db,id,title)=>db.put('sources',{id,status:'new',url:'https://example.org/'+id,title,description:'I manually reconcile invoice records every day and spend hours fixing errors in this workflow'});
test('portfolio prioritizes pending feedback without pretending commercial ROI',()=>{
 const db=openDatabase();try{
  put(db,'a','I cannot reconcile invoice records manually');
  const candidate=opportunityScanCandidates(db).items[0];
  db.put('opportunity_decision_history',{id:'decision-1',problemId:candidate.id,
    adopted:'continue_verification',recommended:'continue_verification',
    plannedHours:10,plannedBudget:100,createdAt:'2026-10-13T00:00:00Z',outcome:null});
  const report=opportunityPortfolioReview(db);
  assert.equal(report.rows[0].reviewClass,'close_feedback_loop');
  assert.equal(report.summary.pendingDecisions,1);
  assert.equal(report.commercialValueScore,null);
  assert.equal(report.manualSelectionRequired,true);
  assert.equal(report.suggested[0].id,candidate.id);
 }finally{db.close();}
});
test('stopped opportunities are flagged for review, not recommended for automatic investment',()=>{
 const db=openDatabase();try{
  put(db,'a','I cannot reconcile invoice records manually');
  const id=opportunityScanCandidates(db).items[0].id;
  const {verificationContext}=await import('../src/problem-verification.mjs');
  const context=verificationContext(db,id);
  db.put('problem_verifications',{id,fingerprint:context.fingerprint,decision:'not_a_real_problem',
    firsthandConfirmed:false,impactConfirmed:false,alternativeAdequacy:'adequate',notes:'人工判断并没有真实需求'});
  const report=opportunityPortfolioReview(db);
  assert.equal(report.rows[0].reviewClass,'review_stop');
  assert.equal(report.suggested.length,0);
  assert.equal(report.summary.paused,1);
 }finally{db.close();}
});
test('empty portfolio stays honest',()=>{
 const db=openDatabase();try{
  const report=opportunityPortfolioReview(db);
  assert.equal(report.rows.length,0);
  assert.deepEqual(report.suggested,[]);
  assert.equal(report.summary.inconclusiveResearchHours,0);
 }finally{db.close();}
});
