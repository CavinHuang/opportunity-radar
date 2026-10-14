import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {postReleaseEvidenceReport} from '../src/discovery-post-release.mjs';
import {captureProductionMonitor,productionMonitorHistory} from '../src/discovery-production-monitor.mjs';
import {createProductionGuard} from '../src/discovery-production-guard.mjs';
import {productionRuleStatus,selectProductionProblem} from '../src/discovery-production-release.mjs';

const RELEASE_AT='2026-10-13T12:00:00.000Z';
const BEFORE='2026-10-13T11:59:00.000Z';
const AFTER='2026-10-13T12:01:00.000Z';
const reason='发布后人工检查对照原始帖子，确认回滚风险';
const quiet={warn(){},error(){}};
function setup(db){
 db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround'});
 db.put('discovery_rule_decisions',{id:'real_problem_release_preflight',records:[{
  policyId:'require_workaround',evidenceHash:'preflight-hash',
  frozenRegressionEvidence:{suiteRevision:3,suiteFingerprint:'frozen-sample',holdoutFingerprint:'holdout'},
  sourceTrialFingerprint:'source-reviewed',capturedAt:BEFORE
 }]});
 db.put('discovery_rule_decisions',{id:'real_problem_production_release',policyId:'require_workaround',percentage:5,
  history:[{action:'release',policyId:'require_workaround',percentage:5,evidenceHash:'preflight-hash',at:RELEASE_AT}]});
}
function addExposed(db,{post=true,asProblem=true,sourceId='exposed',stale=false,old=false}={}){
 for(let i=0;i<400;i++){
  const id=sourceId+'-'+i;
  const source=db.put('sources',{id,status:'new',url:'https://'+(i%2?'forum-two.example':'forum-one.example')+'/post/'+id,
   title:'Cannot automate invoice workflow',description:'I copy invoices every day and spend hours fixing errors'});
  if(selectProductionProblem(db,source).productionVariant==='require_workaround_v1'){
   if(post)db.put('discovery_quality_labels',{id,label:asProblem?'real_problem':'not_problem',
     sourceRevision:source.revision,at:old?BEFORE:AFTER,reason:'发布后阅读原文，人工复核流程'});
   if(stale&&post)db.put('sources',{...source,description:source.description+' revised'},source.revision);
   return source;
  }
 }
 throw Error('No deterministic exposed fixture found');
}
test('post-release evidence links exact preflight, ignores old, missing and stale label timestamps',()=>{
 const db=openDatabase();try{
  assert.equal(postReleaseEvidenceReport(db).status,'no_release_record');
  setup(db);
  assert.equal(postReleaseEvidenceReport(db).status,'awaiting_post_release_review');
  const old=addExposed(db,{sourceId:'old',old:true});
  let report=postReleaseEvidenceReport(db);
  assert.equal(report.totals.reviewedSinceRelease,0);
  assert.equal(report.totals.reviewedBeforeOrAtRelease,1);
  assert.equal(report.baselineVerified,true);
  assert.equal(report.baseline.frozenSuiteRevision,3);
  assert.equal(report.baseline.frozenSuiteFingerprint,'frozen-sample');
  assert.equal(report.baseline.frozenHoldoutFingerprint,'holdout');
  assert.equal(report.baseline.sourceTrialFingerprint,'source-reviewed');
  assert.equal(report.autoRollbackRecommended,false);
  const updated=db.get('discovery_quality_labels',old.id);
  db.put('discovery_quality_labels',{...updated,at:AFTER},updated.revision);
  report=postReleaseEvidenceReport(db);
  assert.equal(report.totals.changedReviewedSinceRelease,1);
  assert.equal(report.totals.newMisses,1);
  assert.equal(report.autoRollbackRecommended,true);
  assert.equal(report.status,'confirmed_post_release_regression');
  db.put('sources',{...old,title:'Later edited original text'},old.revision);
  report=postReleaseEvidenceReport(db);
  assert.equal(report.totals.newMisses,0);
  assert.ok(report.totals.staleLabels>=1);
  assert.equal(report.status,'awaiting_post_release_review');
 }finally{db.close();}
});
test('unexposed reviewed sources, old labels and unverified baselines never claim success',()=>{
 const db=openDatabase();try{
  setup(db);
  let unexposed;
  for(let i=0;i<100;i++){
   const s=db.put('sources',{id:'unexposed-'+i,status:'new',url:'https://another.example/'+i,
    title:'Cannot automate invoice workflow',description:'I copy invoices every day and spend hours fixing errors'});
   if(selectProductionProblem(db,s).productionVariant==='real_problem_v1'){unexposed=s;break;}
  }
  assert.ok(unexposed);
  db.put('discovery_quality_labels',{id:unexposed.id,label:'real_problem',sourceRevision:unexposed.revision,at:AFTER});
  const r=postReleaseEvidenceReport(db);
  assert.equal(r.totals.reviewedSinceRelease,1);
  assert.equal(r.totals.exposedReviewedSinceRelease,0);
  assert.equal(r.status,'awaiting_post_release_review');
  assert.equal(r.totals.newMisses,0);
  assert.equal(r.autoRollbackRecommended,false);
  const saved=db.get('discovery_rule_decisions','real_problem_release_preflight');
  db.put('discovery_rule_decisions',{...saved,records:[]},saved.revision);
  const missing=postReleaseEvidenceReport(db);
  assert.equal(missing.status,'unverified_launch_baseline');
  assert.equal(missing.baselineVerified,false);
  assert.equal(missing.autoRollbackRecommended,false);
  assert.throws(()=>postReleaseEvidenceReport(db,{limit:401}),{code:'BAD_LIMIT'});
 }finally{db.close();}
});
test('monitor stores the release-linked post evidence and rolls back from a newly verified miss',()=>{
 const db=openDatabase();try{
  setup(db);
  addExposed(db);
  const before=postReleaseEvidenceReport(db);
  assert.equal(before.regression,true);
  const r=captureProductionMonitor(db,{reason,expected_revision:0,expected_release_revision:1});
  assert.equal(r.snapshot.autoRollback,true);
  assert.equal(r.snapshot.postRelease.status,'confirmed_post_release_regression');
  assert.equal(r.snapshot.postRelease.baseline.preflightEvidenceHash,'preflight-hash');
  assert.equal(r.snapshot.postRelease.evidenceHash,before.evidenceHash);
  assert.equal(productionRuleStatus(db).policyId,null);
  assert.equal(postReleaseEvidenceReport(db).status,'rolled_back');
  assert.equal(productionMonitorHistory(db).snapshots.length,1);
  assert.ok(db.list('sources').length>=1);
 }finally{db.close();}
});
test('fresh gray rollout always gets first immediate monitor snapshot despite previous rollout recent snapshot',()=>{
 const db=openDatabase();try{
  setup(db);
  const now=Date.now();
  db.put('discovery_rule_decisions',{id:'real_problem_production_monitor',
   snapshots:[{releaseRevision:0,at:new Date(now).toISOString(),autoRollback:false}]});
  const guard=createProductionGuard(db,{clock:()=>now,logger:quiet});
  const result=guard.tick();
  assert.equal(result.checked,true);
  assert.equal(result.autoRollback,false);
  assert.equal(productionMonitorHistory(db).latest.releaseRevision,1);
  assert.equal(guard.tick().skipped,'not_due');
 }finally{db.close();}
});

test('new post-release human-confirmed miss bypasses fifteen-minute snapshot throttling',()=>{
 const db=openDatabase();try{
  setup(db);
  const now=Date.now();
  db.put('discovery_rule_decisions',{id:'real_problem_production_monitor',
   snapshots:[{releaseRevision:1,at:new Date(now).toISOString(),autoRollback:false}]});
  const guard=createProductionGuard(db,{clock:()=>now,logger:quiet});
  assert.equal(guard.tick().skipped,'not_due');
  addExposed(db,{sourceId:'fresh-miss'});
  const result=guard.tick();
  assert.equal(result.checked,true);
  assert.equal(result.autoRollback,true);
  assert.equal(productionRuleStatus(db).policyId,null);
  assert.equal(productionMonitorHistory(db).latest.postRelease.status,'confirmed_post_release_regression');
  assert.ok(db.eventsLatest(20).some(e=>e.kind==='discovery.production_guard.alert'));
 }finally{db.close();}
});
