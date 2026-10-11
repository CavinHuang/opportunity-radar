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
