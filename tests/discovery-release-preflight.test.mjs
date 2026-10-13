import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {releasePreflight,releasePreflightHistory,captureReleasePreflight} from '../src/discovery-release-preflight.mjs';

test('release preflight fails closed without approvals and never changes production rules',()=>{
 const db=openDatabase();try{
  const r=releasePreflight(db);
  assert.equal(r.ready,false);
  assert.ok(r.blockers.includes('approved'));
  assert.equal(r.productionChanged,false);
  assert.throws(()=>captureReleasePreflight(db,{reason:'需要存档一次未经审批的验收',expected_revision:0}),{code:'PREFLIGHT_BLOCKED'});
  assert.equal(releasePreflightHistory(db).records.length,0);
 }finally{db.close();}
});
test('release preflight fingerprints evidence, guards revisions, and never publishes rules',()=>{
 const db=openDatabase();try{
  for(let i=0;i<25;i++){
   const id='negative-'+i;
   const s=db.put('sources',{id,title:'AI news roundup',description:'Generic introduction'});
   db.put('discovery_quality_labels',{id,label:'not_problem',sourceRevision:s.revision});
  }
  db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround',history:[]});
  db.put('discovery_rule_decisions',{id:'real_problem_rule_shadow',active:false,policyId:'require_workaround',percentage:10,
   snapshots:[{policyId:'require_workaround',at:'2026-10-13T00:00:00Z',reviewed:8,deltaFalsePositive:0,deltaFalseNegative:0,autoStopped:false}]});
  const p=releasePreflight(db);
  assert.equal(p.ready,true);
  assert.equal(p.evidenceHash.length,64);
  const saved=captureReleasePreflight(db,{reason:'手动确认影子证据后固定规则验收基线',expected_revision:0});
  assert.equal(saved.revision,1);
  assert.equal(saved.records[0].status,'candidate_only_not_released');
  assert.equal(saved.records[0].evidenceHash,p.evidenceHash);
  assert.throws(()=>captureReleasePreflight(db,{reason:'防止覆盖其他操作产生的最新历史',expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.equal(releasePreflight(db).productionChanged,false);
  assert.equal(db.list('sources').length,25);
  const s=db.get('sources','negative-0');
  db.put('sources',{...s,description:'Changed source text'},s.revision);
  assert.notEqual(releasePreflight(db).evidenceHash,p.evidenceHash);
  assert.equal(releasePreflightHistory(db).records[0].evidenceHash,p.evidenceHash);
 }finally{db.close();}
});
