import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {productionMonitorReport,productionMonitorHistory,captureProductionMonitor} from '../src/discovery-production-monitor.mjs';
import {productionRuleStatus,selectProductionProblem} from '../src/discovery-production-release.mjs';
const reason='本轮人工检查真实问题原帖与对应变化';
test('production monitoring records unique source evidence and automatically rolls back on a confirmed miss',()=>{
 const db=openDatabase();try{
  db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround'});
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',policyId:'require_workaround',percentage:5,history:[]});
  for(let i=0;i<400;i++){
   const source=db.put('sources',{id:'source-'+i,title:'Cannot automate invoice workflow',description:'I copy invoices every day and spend hours fixing errors',status:'new',url:'https://example.org/'+i});
   if(selectProductionProblem(db,source).productionVariant==='require_workaround_v1'){
    db.put('discovery_quality_labels',{id:source.id,label:'real_problem',reason:'人工审核原帖并确认确实是问题',sourceRevision:source.revision});
   }
  }
  const preview=productionMonitorReport(db);
  assert.ok(preview.exposed>0);
  assert.ok(preview.falseNegativeDelta>0);
  assert.equal(preview.examined,400);
  assert.equal(productionRuleStatus(db).policyId,'require_workaround');
  const saved=captureProductionMonitor(db,{reason,expected_revision:0,expected_release_revision:1});
  assert.equal(saved.snapshot.autoRollback,true);
  assert.equal(saved.snapshot.reviewed,preview.reviewed);
  assert.equal(productionRuleStatus(db).policyId,null);
  assert.equal(productionMonitorHistory(db).snapshots.length,1);
  assert.throws(()=>captureProductionMonitor(db,{reason,expected_revision:0,expected_release_revision:1}),{code:'REVISION_CONFLICT'});
  assert.equal(db.list('sources').length,400);
 }finally{db.close();}
});
test('no active release cannot create a misleading monitoring snapshot',()=>{
 const db=openDatabase();try{
  assert.equal(productionMonitorReport(db).exposed,0);
  assert.throws(()=>captureProductionMonitor(db,{reason,expected_revision:0,expected_release_revision:0}),{code:'NOT_RELEASED'});
  assert.throws(()=>productionMonitorReport(db,{limit:401}),{code:'BAD_LIMIT'});
 }finally{db.close();}
});
