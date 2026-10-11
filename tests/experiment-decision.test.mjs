import test from 'node:test';import assert from 'node:assert/strict';
import {experimentDecisionReview} from '../src/experiment-decision.mjs';
const project=()=>({milestones:[{acceptanceState:'accepted'}],submissions:[],ledger:[]});
test('missing outcome records remain unknown rather than false zero',()=>{
 const r=experimentDecisionReview(project());
 assert.equal(r.status,'evidence_incomplete');assert.equal(r.outcomes.visits,null);
 assert.equal(r.outcomes.trialRate,null);
});
test('actual-only results yield bounded trial ratio and known net cash',()=>{
 const p=project();p.ledger=[{type:'visits',value:20,actual:true},{type:'trials',value:5,actual:true},{type:'income',value:100,actual:true},{type:'cash_cost',value:30,actual:true},{type:'income',value:999,actual:false}];
 const r=experimentDecisionReview(p);
 assert.equal(r.status,'ready_for_owner_review');assert.equal(r.outcomes.netKnownCash,70);assert.equal(r.outcomes.trialRate,.25);
});
test('no owner-facing readiness until milestones are formally accepted',()=>{
 const p=project();p.milestones[0].acceptanceState='pending';p.ledger=[{type:'visits',value:10,actual:true},{type:'trials',value:2,actual:true},{type:'income',value:0,actual:true},{type:'cash_cost',value:0,actual:true}];
 assert.equal(experimentDecisionReview(p).status,'delivery_unverified');
});
test('phase D: budget legs without actual entries stay unknown and never become zero',()=>{
 const r=experimentDecisionReview(project());
 assert.equal(r.baselineRevision,null);
 assert.equal(r.budget.weeklyUserHours,null);
 assert.equal(r.budget.recordedUserHours,null);assert.equal(r.budget.paceExceeded,null);
 assert.equal(r.stopCondition.text,null);assert.equal(r.stopCondition.assessment,'unassessed');
 assert.ok(r.caveats.some(c=>c.includes('绝不按零处理')));
});
test('phase D: recorded hours and cash are compared against the approved baseline budget',()=>{
 const p=project();p.baselines=[{revision:2,approvedAt:new Date(Date.now()-98*86400000).toISOString(),
  stopCondition:'stop when idle',budget:{weeklyUserHours:2,cash:100}}];
 p.ledger=[{type:'user_hours',value:1.5,actual:true},{type:'cash_cost',value:30,actual:true},{type:'user_hours',value:9,actual:true}];
 const r=experimentDecisionReview(p);
 assert.equal(r.baselineRevision,2);
 assert.equal(r.budget.weeksElapsed,14);
 assert.equal(r.budget.approvedHoursToNow,28);
 assert.equal(r.budget.recordedUserHours,10.5);
 assert.equal(r.budget.recordedCashCost,30);
 assert.equal(r.budget.paceExceeded,false);   // 10.5h ≤ 28h approved pace
 assert.equal(r.budget.cashExceeded,false);  // ¥30 ≤ ¥100 approved
 // estimated ledger rows must not inflate consumption
 p.ledger.push({type:'user_hours',value:99,actual:false});
 assert.equal(experimentDecisionReview(p).budget.recordedUserHours,10.5);
 assert.equal(experimentDecisionReview(p).budget.paceExceeded,false);
});
test('phase D: hours spent under a previous baseline are not re-judged after a revision',()=>{
 const p=project();p.baselines=[
  {revision:1,approvedAt:new Date(Date.now()-28*86400000).toISOString(),stopCondition:'stop when idle',budget:{weeklyUserHours:2,cash:0}},
  {revision:2,approvedAt:new Date().toISOString(),stopCondition:'stop on no paid order',budget:{weeklyUserHours:2,cash:0}}];
 p.ledger=[{type:'user_hours',value:2,actual:true}];
 const r=experimentDecisionReview(p);
 assert.equal(r.baselineRevision,2);
 assert.equal(r.budget.startedAt,p.baselines[0].approvedAt);
 assert.equal(r.budget.weeksElapsed,4);          // since the FIRST baseline, not the revision
 assert.equal(r.budget.approvedHoursToNow,8);    // baseline r1 allowance (4 weeks × 2h) survives the revision
 assert.equal(r.budget.paceExceeded,false);      // without this caliber fix: 2h > 0h → false overrun
 // a genuinely larger consumption still exceeds the accumulated allowance
 p.ledger=[{type:'user_hours',value:30,actual:true}];
 assert.equal(experimentDecisionReview(p).budget.paceExceeded,true);
});
