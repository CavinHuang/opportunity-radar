import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {freezeRegressionSuite,replayFrozenRegressionSuite,recordFrozenRegressionReview} from '../src/discovery-regression-suite.mjs';
import {frozenRegressionReleaseGate,frozenRegressionTrend} from '../src/discovery-regression-release.mjs';
import {freezeAndReviewRegression,addReviewedHoldout,researchReviewReason} from './helpers/frozen-regression-release-fixture.mjs';

function seed(db,{regression=false}={}){
 for(let i=0;i<25;i++){
  const positive=i<8,affected=i>=8&&i<10;
  const s=db.put('sources',{id:'original-'+i,status:'new',
   url:'https://'+(i%2?'site-two.example':'site-one.example')+'/posts/'+i,
   title:positive||affected?'Cannot automate invoice workflow':'New AI product announcement',
   description:positive?(regression&&i===0?
    'I copy invoices every day and spend hours fixing errors':
    'I manually copy invoices every day and spend hours fixing errors'):
    affected?'I copy invoices every day and spend hours fixing errors':'Our team launched a new product'});
  db.put('discovery_quality_labels',{id:s.id,label:positive?'real_problem':'not_problem',
   sourceRevision:s.revision,reason:'Owner逐条核实原文之后的保守分类'});
 }
}
test('cannot release with no frozen suite, unsigned suite or no fresh reviewed holdout',()=>{
 const db=openDatabase();try{
  assert.equal(frozenRegressionReleaseGate(db).ready,false);
  seed(db);
  const frozen=freezeRegressionSuite(db,{reason:researchReviewReason,expected_revision:0});
  const noReview=frozenRegressionReleaseGate(db);
  assert.ok(noReview.blockers.includes('frozenOwnerReviewed'));
  assert.ok(noReview.blockers.includes('newlyReviewedAtLeast6'));
  const replay=replayFrozenRegressionSuite(db);
  recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:frozen.revision,
   fingerprint:replay.fingerprint,decision:'recommend_shadow_review',
   reason:researchReviewReason,expected_revision:0});
  assert.equal(frozenRegressionReleaseGate(db).checks.frozenOwnerReviewed,true);
  assert.equal(frozenRegressionReleaseGate(db).ready,false);
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_release'),null);
 }finally{db.close();}
});
test('newly owner-reviewed non-frozen posts unlock gate only with both classes and sources',()=>{
 const db=openDatabase();try{
  seed(db);
  const {frozen}=freezeAndReviewRegression(db);
  const first=addReviewedHoldout(db,frozen.snapshot.at,{total:6});
  const gate=frozenRegressionReleaseGate(db);
  assert.equal(gate.ready,true);
  assert.equal(gate.fresh.reviewed,6);
  assert.equal(gate.fresh.positive,3);
  assert.equal(gate.fresh.negative,3);
  assert.equal(gate.fresh.hosts,2);
  assert.equal(gate.fresh.newMisses,0);
  assert.equal(gate.evidenceHash.length,64);
  assert.equal(gate.suite.count,25);
  assert.equal(gate.fresh.examples.length,0);
  assert.ok(!JSON.stringify(gate).includes('I manually copy invoices'));
  const p=first[0].s;
  db.put('sources',{...p,title:'Article updated after owner review'},p.revision);
  assert.equal(frozenRegressionReleaseGate(db).ready,false);
  assert.ok(frozenRegressionReleaseGate(db).blockers.includes('newlyReviewedAtLeast6'));
  assert.notEqual(frozenRegressionReleaseGate(db).evidenceHash,gate.evidenceHash);
 }finally{db.close();}
});
test('candidate rule misses on new holdout block release despite clean frozen suite',()=>{
 const db=openDatabase();try{
  seed(db);
  const {frozen}=freezeAndReviewRegression(db);
  addReviewedHoldout(db,frozen.snapshot.at,{modified:true});
  const report=frozenRegressionReleaseGate(db);
  assert.equal(report.suite.newMisses,0);
  assert.equal(report.fresh.newFalsePositives,0);
  assert.equal(report.fresh.newMisses,0);
  assert.equal(report.ready,true);
  // Turn an independently held-out confirmed real problem into a missing-workaround positive.
  const s=db.get('sources','after-freeze-0');
  const updated=db.put('sources',{...s,description:'I copy invoices every day and spend hours fixing errors'},s.revision);
  const l=db.get('discovery_quality_labels',s.id);
  db.put('discovery_quality_labels',{...l,sourceRevision:updated.revision,
   at:new Date(Date.parse(frozen.snapshot.at)+2000).toISOString()},l.revision);
  const report2=frozenRegressionReleaseGate(db);
  assert.equal(report2.fresh.newMisses,1);
  assert.equal(report2.checks.noNewEvidenceRegression,false);
  assert.equal(report2.ready,false);
 }finally{db.close();}
});
test('rejected newest Owner decision, alternative policy and insufficient host diversity block promotion',()=>{
 const db=openDatabase();try{
  seed(db);const {frozen,replay}=freezeAndReviewRegression(db);
  addReviewedHoldout(db,frozen.snapshot.at);
  assert.equal(frozenRegressionReleaseGate(db).ready,true);
  assert.equal(frozenRegressionReleaseGate(db,'review_promotion_block').ready,false);
  recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:frozen.revision,
   fingerprint:replay.fingerprint,decision:'reject_trial',reason:researchReviewReason,expected_revision:1});
  assert.equal(frozenRegressionReleaseGate(db).checks.frozenOwnerReviewed,false);
 }finally{db.close();}
 const db2=openDatabase();try{
  seed(db2);const {frozen}=freezeAndReviewRegression(db2);
  addReviewedHoldout(db2,frozen.snapshot.at,{sameHost:true});
  assert.ok(frozenRegressionReleaseGate(db2).blockers.includes('newReviewAcross2Hosts'));
 }finally{db2.close();}
});
test('historical trend disallows naive version-on-version accuracy deltas while comparing same corpus policies',()=>{
 const db=openDatabase();try{
  seed(db);const {frozen}=freezeAndReviewRegression(db);
  addReviewedHoldout(db,frozen.snapshot.at);
  const previous=frozenRegressionTrend(db);
  assert.equal(previous.versions.length,1);
  assert.equal(previous.sameCorpus.length,2);
  assert.equal(previous.sameCorpus[0].fingerprint,previous.sameCorpus[1].fingerprint);
  assert.equal(previous.sameCorpus[0].newMisses,0);
  const s=db.get('sources','original-20');
  const changed=db.put('sources',{...s,title:'Updated release article'},s.revision);
  const l=db.get('discovery_quality_labels',s.id);
  db.put('discovery_quality_labels',{...l,sourceRevision:changed.revision},l.revision);
  freezeRegressionSuite(db,{reason:'再次保存Owner最新人工标注作为新的回归历史版本',expected_revision:1});
  const trend=frozenRegressionTrend(db);
  assert.equal(trend.versions.length,2);
  assert.equal(trend.versions[1].comparableWithPrevious,false);
  assert.match(trend.versions[1].comparisonNote,/不可/);
  assert.equal(trend.versions[0].revision,1);
  assert.equal(trend.versions[1].revision,2);
  assert.equal(trend.releaseGate.ready,false); // no newest suite review and old holdout included
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_release'),null);
 }finally{db.close();}
});
