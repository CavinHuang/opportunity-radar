import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {changeProductionRule,productionRuleStatus,selectProductionProblem} from '../src/discovery-production-release.mjs';
import {releasePreflight} from '../src/discovery-release-preflight.mjs';

const reason='已经人工检查证据，批准小流量严格规则试验';
test('production gate defaults to baseline, rejects unverified and unsafe release',()=>{
 const db=openDatabase();try{
  const source={id:'source-42',title:'Cannot automate invoice workflow',description:'I copy invoices every day and spend hours fixing errors'};
  assert.equal(selectProductionProblem(db,source).productionVariant,'real_problem_v1');
  assert.throws(()=>changeProductionRule(db,{action:'release',policy_id:'review_promotion_block',percentage:5,reason,expected_revision:0}),{code:'UNSAFE_VARIANT'});
  assert.throws(()=>changeProductionRule(db,{action:'release',policy_id:'require_workaround',percentage:6,reason,expected_revision:0}),{code:'BAD_PERCENTAGE'});
  assert.throws(()=>changeProductionRule(db,{action:'release',policy_id:'require_workaround',percentage:5,reason,expected_revision:0}),{code:'STALE_PREFLIGHT'});
  assert.equal(productionRuleStatus(db).revision,0);
 }finally{db.close();}
});
test('evidence-pinned production release supports versioned atomic rollback',()=>{
 const db=openDatabase();try{
  for(let i=0;i<25;i++){
   const id='negative-'+i;
   const s=db.put('sources',{id,title:'AI news roundup',description:'Generic introduction'});
   db.put('discovery_quality_labels',{id,label:'not_problem',sourceRevision:s.revision});
  }
  db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround',history:[]});
  db.put('discovery_rule_decisions',{id:'real_problem_rule_shadow',active:false,policyId:'require_workaround',percentage:5,
   snapshots:[{policyId:'require_workaround',at:'2026-10-13T00:00:00Z',reviewed:8,deltaFalsePositive:0,deltaFalseNegative:0,autoStopped:false}]});
  const evidence=releasePreflight(db);assert.equal(evidence.ready,true);
  db.put('discovery_rule_decisions',{id:'real_problem_release_preflight',records:[{policyId:'require_workaround',evidenceHash:evidence.evidenceHash}]});
  const started=changeProductionRule(db,{action:'release',policy_id:'require_workaround',percentage:5,evidence_hash:evidence.evidenceHash,reason,expected_revision:0});
  assert.equal(started.policyId,'require_workaround');
  assert.equal(started.percentage,5);
  assert.equal(started.revision,1);
  assert.throws(()=>changeProductionRule(db,{action:'rollback',reason,expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>changeProductionRule(db,{action:'release',policy_id:'require_workaround',percentage:5,evidence_hash:evidence.evidenceHash,reason,expected_revision:1}),{code:'ALREADY_RELEASED'});
  const rolled=changeProductionRule(db,{action:'rollback',reason,expected_revision:1});
  assert.equal(rolled.policyId,null);
  assert.equal(rolled.percentage,0);
  assert.equal(rolled.history[1].action,'rollback');
  assert.equal(db.list('sources').length,25);
  assert.equal(db.list('discovery_quality_labels').length,25);
 }finally{db.close();}
});
