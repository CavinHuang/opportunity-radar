import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {decisionEffectivenessReport} from '../src/opportunity-decision-effectiveness.mjs';
function create(db,id,problemId,plannedHours,plannedBudget,outcome=null){
 return db.put('opportunity_decision_history',{id,problemId,plannedHours,plannedBudget,recommended:'continue_verification',
  adopted:id==='stop'?'pause_or_stop':'continue_verification',createdAt:'2026-10-13T00:00:00Z',
  briefSnapshot:{title:id},outcome});
}
test('only closed owner outcomes contribute actual cost and time comparisons',()=>{
 const db=openDatabase();try{
  create(db,'one','alpha',5,100,{status:'supported',actualHours:7,actualCost:130,selfReported:true});
  create(db,'two','alpha',4,80,{status:'inconclusive',actualHours:2,actualCost:20,selfReported:true});
  create(db,'pending','alpha',100,5000);
  create(db,'stop','beta',1,0,{status:'unknown',actualHours:1,actualCost:0,selfReported:true});
  const r=decisionEffectivenessReport(db);
  assert.equal(r.sample.all,4);assert.equal(r.sample.closed,3);assert.equal(r.sample.pending,1);
  assert.equal(r.plan.hoursAll,110);assert.equal(r.plan.hoursClosed,10);
  assert.equal(r.actual.hoursClosed,10);assert.equal(r.actual.costClosed,150);
  assert.equal(r.delta.costClosed,-30);assert.equal(r.inconclusive.records,2);
  assert.equal(r.stopped.records,1);assert.equal(r.sample.uniqueProblems,2);
  assert.equal(r.completionRate,0.75);
  const scoped=decisionEffectivenessReport(db,{problemId:'alpha'});
  assert.equal(scoped.sample.all,3);assert.equal(scoped.sample.closed,2);assert.equal(scoped.actual.hoursClosed,9);
  assert.ok(r.notice.includes('不能推断'));
 }finally{db.close();}
});
test('zero records has null completion rate, no invented improvement or savings',()=>{
 const db=openDatabase();try{
  const r=decisionEffectivenessReport(db);
  assert.equal(r.completionRate,null);assert.equal(r.actual.costClosed,0);
  assert.equal(r.stopped.records,0);assert.equal(r.records.length,0);
 }finally{db.close();}
});
