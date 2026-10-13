import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {decisionOutcomeLedger,adoptDecision,recordDecisionOutcome} from '../src/opportunity-decision-outcomes.mjs';
function setup(db){db.put('sources',{id:'one',status:'new',url:'https://example.org/problem',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});return opportunityScanCandidates(db).items[0].id;}
test('captures immutable suggested/adopted decision and a single self-reported outcome',()=>{
 const db=openDatabase();try{const id=setup(db),initial=decisionOutcomeLedger(db,id);
 const x=adoptDecision(db,id,{briefFingerprint:initial.briefFingerprint,decision:'continue_verification',reason:'先访谈真正每天处理发票数据的用户',plannedHours:3,plannedBudget:100});
 assert.equal(x.recommended,initial.brief.disposition);assert.equal(x.briefSnapshot.stage,initial.brief.stage);
 const out=recordDecisionOutcome(db,id,x.id,{outcome:'inconclusive',actualHours:2,actualCost:20,notes:'试访谈未找到足够的明确重复需求证据',expected_revision:x.revision});
 assert.equal(out.outcome.selfReported,true);assert.equal(decisionOutcomeLedger(db,id).entries[0].outcome.status,'inconclusive');
 assert.throws(()=>recordDecisionOutcome(db,id,x.id,{outcome:'supported',actualHours:2,actualCost:20,notes:'观察仍需要另一轮验证和核对',expected_revision:out.revision}),{code:'OUTCOME_EXISTS'});
 }finally{db.close();}
});
test('rejects stale brief and invalid budget without changing history',()=>{
 const db=openDatabase();try{const id=setup(db),initial=decisionOutcomeLedger(db,id);
 assert.throws(()=>adoptDecision(db,id,{briefFingerprint:initial.briefFingerprint,decision:'pause_or_stop',reason:'临时不能证明存在可以被重复验证的需求',plannedBudget:-1,plannedHours:3}),{code:'INVALID_PLAN'});
 const s=db.get('sources','one');db.put('sources',{...s,description:s.description+' revised'},s.revision);
 assert.throws(()=>adoptDecision(db,id,{briefFingerprint:initial.briefFingerprint,decision:'continue_verification',reason:'准备进一步联系存在实际工作障碍的使用者',plannedBudget:0,plannedHours:2}),{code:'STALE_BRIEF'});
 assert.equal(decisionOutcomeLedger(db,id).entries.length,0);
 }finally{db.close();}
});
