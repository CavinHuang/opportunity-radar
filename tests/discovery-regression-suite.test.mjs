import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {frozenRegressionSuiteBoard,freezeRegressionSuite,replayFrozenRegressionSuite,
 frozenRegressionReviewHistory,recordFrozenRegressionReview} from '../src/discovery-regression-suite.mjs';

const reason='人工核实原始讨论并冻结用于防止后续筛选规则回归的正反案例';
function seed(db,{badPositive=false,negatives=16}={}){
 for(let i=0;i<8+negatives;i++){
  const positive=i<8,affected=!positive&&i===8;
  const id='example-'+i;
  const s=db.put('sources',{id,status:'new',url:'https://'+(i%2?'forum-two.example':'forum-one.example')+'/'+i,
   title:positive||affected?'Cannot automate invoice workflow':'Product announcement for next year',
   description:positive?(badPositive&&i===0?
    'I copy invoices every day and spend hours fixing errors':
    'I manually copy invoices every day and spend hours fixing errors'):
    affected?'I copy invoices every day and spend hours fixing errors':'Our startup is introducing a news product.'});
  db.put('discovery_quality_labels',{id,label:positive?'real_problem':'not_problem',
   sourceRevision:s.revision,reason:'原帖经过Owner人工核实后记录的正反例'});
 }
}
test('freeze requires balanced and diverse confirmed labels, remains append only',()=>{
 const db=openDatabase();try{
  assert.equal(frozenRegressionSuiteBoard(db).candidate.ready,false);
  assert.throws(()=>freezeRegressionSuite(db,{reason,expected_revision:0}),{code:'INSUFFICIENT_SAMPLES'});
  seed(db);
  const before=db.list('sources').map(x=>[x.id,x.revision]);
  const one=freezeRegressionSuite(db,{reason,expected_revision:0});
  assert.equal(one.snapshot.counts.total,24);
  assert.equal(one.snapshot.counts.positives,8);
  assert.equal(one.snapshot.counts.negatives,16);
  assert.equal(one.snapshot.counts.hosts,2);
  assert.equal(one.snapshot.records,undefined);
  assert.equal(one.revision,1);
  assert.throws(()=>freezeRegressionSuite(db,{reason,expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>freezeRegressionSuite(db,{reason,expected_revision:1}),{code:'SAME_SNAPSHOT'});
  assert.deepEqual(db.list('sources').map(x=>[x.id,x.revision]),before);
  assert.equal(db.list('discovery_rule_decisions').length,1);
 }finally{db.close();}
});
test('frozen snapshots replay deterministically after original source and label edits',()=>{
 const db=openDatabase();try{
  seed(db);
  const snapshot=freezeRegressionSuite(db,{reason,expected_revision:0}).snapshot;
  const first=replayFrozenRegressionSuite(db);
  assert.equal(first.available,true);
  assert.equal(first.changedCount,1);
  assert.equal(first.newMisses,0);
  assert.equal(first.newFalsePositives,0);
  assert.equal(first.removedFalsePositives,1);
  assert.equal(first.verdict,'manual_review_only');
  assert.equal(first.sourceDrift,0);
  const current=db.get('sources','example-8');
  db.put('sources',{...current,title:'Completely changed source content'},current.revision);
  const label=db.get('discovery_quality_labels','example-8');
  db.put('discovery_quality_labels',{...label,label:'real_problem'},label.revision);
  const second=replayFrozenRegressionSuite(db,{suiteRevision:snapshot.revision});
  assert.equal(second.sourceDrift,1);
  assert.equal(second.fingerprint,first.fingerprint);
  assert.equal(second.removedFalsePositives,1);
  assert.equal(second.verdict,'manual_review_only');
  const newSnapshot=freezeRegressionSuite(db,{reason:'标签和原帖已经发生变化，冻结一份新的对照样本集',expected_revision:1});
  assert.notEqual(newSnapshot.snapshot.fingerprint,snapshot.fingerprint);
  assert.equal(replayFrozenRegressionSuite(db,{suiteRevision:1}).fingerprint,first.fingerprint);
  assert.equal(frozenRegressionSuiteBoard(db).snapshots.length,2);
 }finally{db.close();}
});
test('Owner decisions are evidence fenced and never turn on production rules',()=>{
 const db=openDatabase();try{
  seed(db);freezeRegressionSuite(db,{reason,expected_revision:0});
  const report=replayFrozenRegressionSuite(db);
  assert.throws(()=>recordFrozenRegressionReview(db,{policy_id:'require_workaround',
   suite_revision:1,fingerprint:'old',decision:'recommend_shadow_review',reason,expected_revision:0}),{code:'STALE_REGRESSION'});
  const done=recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:1,
   fingerprint:report.fingerprint,decision:'recommend_shadow_review',reason,expected_revision:0});
  assert.equal(done.record.status,'advisory_only_not_rule_approved');
  assert.equal(frozenRegressionReviewHistory(db).records.length,1);
  assert.equal(db.get('discovery_rule_decisions','real_problem_rule_trials'),null);
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_release'),null);
  assert.throws(()=>recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:1,
   fingerprint:report.fingerprint,decision:'recommend_shadow_review',reason,expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:1,
   fingerprint:report.fingerprint,decision:'recommend_shadow_review',reason,expected_revision:1}),{code:'REVIEW_ALREADY_RECORDED'});
  const rejected=recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:1,
   fingerprint:report.fingerprint,decision:'hold_for_more_evidence',reason,expected_revision:1});
  assert.equal(rejected.revision,2);
 }finally{db.close();}
});
test('frozen replay exposes observed increased misses and blocks positive recommendations',()=>{
 const db=openDatabase();try{
  seed(db,{badPositive:true});
  freezeRegressionSuite(db,{reason,expected_revision:0});
  const bad=replayFrozenRegressionSuite(db);
  assert.equal(bad.newMisses,1);
  assert.equal(bad.removedFalsePositives,1);
  assert.equal(bad.delta.falseNegative,1);
  assert.equal(bad.verdict,'observed_regression_do_not_approve');
  assert.throws(()=>recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:1,
   fingerprint:bad.fingerprint,decision:'recommend_shadow_review',reason,expected_revision:0}),{code:'REGRESSION_BLOCKED'});
  assert.equal(recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:1,
   fingerprint:bad.fingerprint,decision:'reject_trial',reason,expected_revision:0}).record.decision,'reject_trial');
 }finally{db.close();}
});
test('not enough representation and unknown policies fail closed',()=>{
 const db=openDatabase();try{
  seed(db,{negatives:3});
  assert.equal(frozenRegressionSuiteBoard(db).candidate.ready,false);
  assert.throws(()=>freezeRegressionSuite(db,{reason,expected_revision:0}),{code:'INSUFFICIENT_SAMPLES'});
  assert.equal(replayFrozenRegressionSuite(db).available,false);
  assert.throws(()=>replayFrozenRegressionSuite(db,{policyId:'unknown'}),{code:'BAD_POLICY'});
  assert.throws(()=>recordFrozenRegressionReview(db,{decision:'approve_production',reason,expected_revision:0}),{code:'BAD_DECISION'});
 }finally{db.close();}
});
