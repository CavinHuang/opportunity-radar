import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {researchDecisionGuidance} from '../src/opportunity-research-guidance.mjs';
const putWeek=(db,id,week,finding,status='reviewed',eventSeqs=[])=>{
 const key='week:'+week;
 db.put('opportunity_weekly_plans',{id:key,weekStart:week,status,items:[{candidateId:id,title:'Invoice work',task:'Interview buyers',hours:2,budget:0}]});
 db.put('opportunity_weekly_hypotheses',{id:key,items:[{candidateId:id,hypothesis:'Invoice work takes hours',finding,eventSeqs}]});
 for(const seq of eventSeqs)db.put('opportunity_weekly_provenance',{id:key,reviews:[{candidateId:id,seq,classification:'independent_firsthand',origin:'https://example.org/'+seq}]});
};
test('no research produces a planning suggestion, never an automated decision',()=>{
 const db=openDatabase();try{
  const r=researchDecisionGuidance(db,'missing');
  assert.equal(r.action,'plan_research');
  assert.equal(r.automaticDecision,false);
  assert.equal(r.ownerDecisionRequired,true);
  assert.equal(r.marketValidated,false);
 }finally{db.close();}
});
test('contradicted research precedes positive advice, no records mutate',()=>{
 const db=openDatabase();try{
  putWeek(db,'a','2026-10-05','supported');
  putWeek(db,'a','2026-10-12','contradicted');
  const r=researchDecisionGuidance(db,'a');
  assert.equal(r.action,'review_direction');
  assert.ok(r.reasons.some(x=>x.code==='COUNTEREVIDENCE_RECORDED'));
  assert.equal(db.get('opportunity_weekly_hypotheses','week:2026-10-12').items[0].finding,'contradicted');
 }finally{db.close();}
});
test('reviewed event can still only generate human review advice',()=>{
 const db=openDatabase();try{
  putWeek(db,'a','2026-10-12','supported','reviewed',[42]);
  const r=researchDecisionGuidance(db,'a');
  assert.equal(r.action,'human_decision');
  assert.ok(r.reviewFlags.some(x=>x.code==='UNREVIEWED_PROVENANCE')===false);
  // The event is provenance-reviewed, so the only remaining reason is lack of direct observation.
  assert.equal(r.ownerDecisionRequired,true);
 }finally{db.close();}
});
test('unreviewed week requests human review before positive consideration',()=>{
 const db=openDatabase();try{
  putWeek(db,'a','2026-10-12','supported','planned',[43]);
  assert.equal(researchDecisionGuidance(db,'a').action,'complete_review');
 }finally{db.close();}
});
