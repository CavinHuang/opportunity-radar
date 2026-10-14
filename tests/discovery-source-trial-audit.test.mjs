import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {sourceTrialImpactReport,sourceTrialAuditHistory,signSourceTrialAudit,sourceTrialReleaseGate} from '../src/discovery-source-trial-audit.mjs';

const reason='已经核对受影响原始帖子并查验标注，确认没有已知新增误报或漏报';
function seed(db,{hosts=2,reviewChanged=true,affectedLabel='not_problem',withApproval=true}={}){
 for(let i=0;i<25;i++){
  const affected=i===0||i===1;
  const id='trial-'+i;
  const host=hosts>1&&i%2?'site-two.example':'site-one.example';
  const s=db.put('sources',{id,status:'new',url:'https://'+host+'/posts/'+id,
   title:affected?'I cannot reconcile invoice records every week':'News about new AI technology',
   description:affected?'I copy invoice records every day and spend hours fixing errors':'A story about latest software',
   createdAt:'2026-10-10T00:00:00Z'});
  if(!affected||reviewChanged)db.put('discovery_quality_labels',{id,label:affected?affectedLabel:'not_problem',
   sourceRevision:s.revision,reason:'逐条审查完整的原帖来源后记录人工分类'});
 }
 if(withApproval)db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround',history:[]});
}
test('source trial signoff requires sufficient cross-origin current labels, changed cases reviewed and stable evidence',()=>{
 const db=openDatabase();
 try{
  seed(db);
  const before=db.list('sources').map(x=>[x.id,x.revision]);
  const r=sourceTrialImpactReport(db);
  assert.equal(r.readyForOwnerSignoff,true);
  assert.equal(r.window,25);
  assert.equal(r.reviewedHostCount,2);
  assert.equal(r.changedCount,2);
  assert.equal(r.changedReviewed,2);
  assert.equal(r.regression.removedFalsePositives,2);
  assert.equal(sourceTrialReleaseGate(db).cleared,false);
  assert.throws(()=>signSourceTrialAudit(db,{policy_id:'require_workaround',fingerprint:'wrong',reason,expected_revision:0}),{code:'STALE_SOURCE_TRIAL'});
  const accepted=signSourceTrialAudit(db,{policy_id:'require_workaround',fingerprint:r.fingerprint,reason,expected_revision:0});
  assert.equal(accepted.snapshot.status,'source_trial_reviewed_not_released');
  assert.equal(sourceTrialReleaseGate(db).cleared,true);
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_release'),null);
  assert.deepEqual(db.list('sources').map(x=>[x.id,x.revision]),before);
  assert.throws(()=>signSourceTrialAudit(db,{policy_id:'require_workaround',fingerprint:r.fingerprint,reason,expected_revision:0}),{code:'REVISION_CONFLICT'});
  const s=db.get('sources','trial-2');
  db.put('sources',{...s,description:'Updated article content'},s.revision);
  assert.equal(sourceTrialReleaseGate(db).cleared,false);
  assert.equal(sourceTrialReleaseGate(db).reason,'SOURCE_TRIAL_STALE');
  assert.equal(sourceTrialAuditHistory(db).records.length,1);
 }finally{db.close();}
});
test('unreviewed impacted posts and newly missed real problems fail closed',()=>{
 const unreviewed=openDatabase();const missed=openDatabase();
 try{
  seed(unreviewed,{reviewChanged:false});
  const u=sourceTrialImpactReport(unreviewed);
  assert.equal(u.unreviewedChanges,2);
  assert.equal(u.readyForOwnerSignoff,false);
  assert.ok(u.blockers.includes('everyChangedPostReviewed'));
  assert.throws(()=>signSourceTrialAudit(unreviewed,{policy_id:'require_workaround',fingerprint:u.fingerprint,reason,expected_revision:0}),{code:'SOURCE_TRIAL_BLOCKED'});
  seed(missed,{affectedLabel:'real_problem'});
  const r=sourceTrialImpactReport(missed);
  assert.equal(r.regression.newMisses,2);
  assert.equal(r.readyForOwnerSignoff,false);
  assert.ok(r.blockers.includes('noNewMisses'));
  assert.equal(sourceTrialReleaseGate(missed).cleared,false);
 }finally{unreviewed.close();missed.close();}
});
test('lack of labels, single-origin sample and revoked approval prevent signoff',()=>{
 for(const variant of [{hosts:1},{withApproval:false}]){
  const db=openDatabase();try{
   seed(db,variant);const report=sourceTrialImpactReport(db);
   assert.equal(report.readyForOwnerSignoff,false);
   assert.ok(report.blockers.includes(variant.hosts===1?'reviewedAcross2Hosts':'trialApproved'));
  }finally{db.close();}
 }
 const db=openDatabase();try{
  assert.equal(sourceTrialImpactReport(db).readyForOwnerSignoff,false);
  assert.ok(sourceTrialImpactReport(db).blockers.includes('reviewedAtLeast20'));
  assert.equal(sourceTrialAuditHistory(db).latest,null);
  assert.throws(()=>sourceTrialImpactReport(db,{policyId:'not_real'}),{code:'BAD_POLICY'});
 }finally{db.close();}
});
