import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createProductionGuard} from '../src/discovery-production-guard.mjs';
import {productionRuleStatus,selectProductionProblem} from '../src/discovery-production-release.mjs';
import {productionMonitorHistory} from '../src/discovery-production-monitor.mjs';

const silent={warn(){},error(){}};
test('guard skips disabled rollout and performs only one due snapshot',()=>{
 const db=openDatabase();try{
  const guard=createProductionGuard(db,{logger:silent});
  assert.equal(guard.tick().skipped,'no_release');
  db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround'});
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',policyId:'require_workaround',percentage:5});
  const a=guard.tick();
  assert.equal(a.checked,true);
  assert.equal(a.autoRollback,false);
  assert.equal(guard.tick().skipped,'not_due');
  assert.equal(productionMonitorHistory(db).snapshots.length,1);
 }finally{db.close();}
});
test('a confirmed missed real problem triggers rollback without another owner click',()=>{
 const db=openDatabase();try{
  db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround'});
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',policyId:'require_workaround',percentage:5});
  for(let i=0;i<400;i++){
   const s=db.put('sources',{id:'guard-'+i,status:'new',title:'Cannot automate invoice workflow',
    description:'I copy invoices every day and spend hours fixing errors',url:'https://example.org/'+i});
   if(selectProductionProblem(db,s).productionVariant==='require_workaround_v1')
    db.put('discovery_quality_labels',{id:s.id,label:'real_problem',sourceRevision:s.revision});
  }
  const r=createProductionGuard(db,{logger:silent}).tick();
  assert.equal(r.autoRollback,true);
  assert.equal(productionRuleStatus(db).policyId,null);
  assert.equal(productionMonitorHistory(db).latest.autoRollback,true);
  assert.ok(db.eventsLatest(30).some(e=>e.kind==='discovery.production_guard.alert'));
 }finally{db.close();}
});
test('revoked owner approval is rolled back immediately and once',()=>{
 const db=openDatabase();try{
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',policyId:'require_workaround',percentage:5});
  const guard=createProductionGuard(db,{logger:silent});
  assert.deepEqual(guard.tick(),{autoRollback:true,reason:'APPROVAL_REVOKED'});
  assert.equal(guard.tick().skipped,'no_release');
  assert.equal(db.eventsLatest(30).filter(e=>e.kind==='discovery.production_guard.alert').length,1);
 }finally{db.close();}
});
