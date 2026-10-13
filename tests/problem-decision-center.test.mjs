import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {decisionReviewCenter,saveDecisionReview} from '../src/problem-decision-center.mjs';
test('review center only shows closed actual designs and preserves counter-evidence',()=>{
 const db=openDatabase();try{
  db.put('problem_experiment_designs',{id:'d1',problemId:'signal:p',planId:'plan1',status:'closed',decision:'iterate',decisionReason:'Still has workflow friction',closedAt:'2026-10-12T12:00:00Z',currency:'CNY',budgetLimit:300,successCondition:'User completes task faster',stopCondition:'No meaningful time savings',acceptanceEvidence:'Task logs'});
  db.put('problem_experiment_designs',{id:'d2',problemId:'signal:p',planId:'plan2',status:'draft',currency:'CNY',budgetLimit:100});
  db.put('problem_interview_observations',{id:'o1',planId:'plan1',participant:'anon',contradiction:'An existing free tool already solves some cases'});
  db.put('problem_experiment_records',{id:'r1',planId:'plan1',designId:'d1',step:'Test actual import',behavior:'Person imported an invoice',outcome:'Still required manual corrections',cost:12.5});
  const center=decisionReviewCenter(db);assert.equal(center.items.length,1);
  assert.equal(center.items[0].actualCost,12.5);assert.equal(center.items[0].counterEvidence.length,1);
  assert.throws(()=>saveDecisionReview(db,'d1',{assessment:'inconclusive',nextStep:'recheck',reason:'Evidence still does not show durable improvement',expected_revision:0}),{code:'DATE_REQUIRED'});
  const review=saveDecisionReview(db,'d1',{assessment:'inconclusive',nextStep:'recheck',revisitAt:'2026-11-01',reason:'Evidence still does not show durable improvement',expected_revision:0});
  assert.equal(review.revisitAt,'2026-11-01');
  assert.throws(()=>saveDecisionReview(db,'d1',{assessment:'supported',nextStep:'continue',reason:'We need independent evidence before proceeding',expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.equal(db.list('projects').length,0);
 }finally{db.close()}
});
test('empty center does not manufacture completed experiments',()=>{const db=openDatabase();try{assert.deepEqual(decisionReviewCenter(db).items,[]);}finally{db.close()}});
