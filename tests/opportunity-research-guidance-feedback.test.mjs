import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {researchGuidanceFeedbackBoard,recordResearchGuidanceFeedback,recordResearchGuidanceFollowup} from '../src/opportunity-research-guidance-feedback.mjs';

function savePlan(store,id,task='真正联系使用者并核对手工发票流程'){
 store.put('opportunity_weekly_plans',{id:'week:2026-10-12',weekStart:'2026-10-12',status:'planned',
  items:[{candidateId:id,title:'Invoice problem',task,hours:2,budget:0}],progress:[]});
}
function respond(store,id,overrides={}){
 const board=researchGuidanceFeedbackBoard(store,id);
 return recordResearchGuidanceFeedback(store,id,{fingerprint:board.fingerprint,response:'accepted',
  reason:'需要优先核对真实使用者的原始经验，避免错误投入',...overrides});
}
test('advisory response is immutable, no duplicate per evidence version and no formal decision is created',()=>{
 const db=openDatabase();try{
  savePlan(db,'a');
  const original=researchGuidanceFeedbackBoard(db,'a');
  const record=respond(db,'a');
  assert.equal(record.recommendation.action,original.guidance.action);
  assert.equal(record.followup,null);
  assert.equal(db.list('opportunity_decision_history').length,0);
  assert.throws(()=>respond(db,'a'),{code:'ALREADY_RECORDED'});
  assert.equal(researchGuidanceFeedbackBoard(db,'a').summary.accepted,1);
  assert.equal(researchGuidanceFeedbackBoard(db,'b').summary.total,0);
 }finally{db.close();}
});
test('review writes reject stale research snapshots and invalid decisions',()=>{
 const db=openDatabase();try{
  savePlan(db,'a');
  const previous=researchGuidanceFeedbackBoard(db,'a');
  const row=db.get('opportunity_weekly_plans','week:2026-10-12');
  db.put('opportunity_weekly_plans',{...row,items:[{...row.items[0],task:'新研究任务：观察用户实际完成发票核对过程'}]},row.revision);
  assert.throws(()=>recordResearchGuidanceFeedback(db,'a',{
   fingerprint:previous.fingerprint,response:'declined',reason:'已有更新后的原始观察需要重新审阅'}),{code:'STALE_GUIDANCE'});
  assert.throws(()=>respond(db,'a',{response:'adapted'}),{code:'ACTION_REQUIRED'});
  db.put('opportunity_decision_history',{id:'other-decision',problemId:'b',adopted:'continue_verification'});
  assert.throws(()=>respond(db,'a',{linkedDecisionId:'other-decision'}),{code:'INVALID_DECISION_LINK'});
  assert.equal(db.list('opportunity_research_guidance_feedback').length,0);
 }finally{db.close();}
});
test('followup is owner-reported once with revision fencing, proper scope and evidence URL validation',()=>{
 const db=openDatabase();try{
  savePlan(db,'a');
  const feedback=respond(db,'a',{response:'adapted',chosenAction:'改为观察两个用户的真实操作过程'});
  const args={assessment:'uncertain',actualHours:2,notes:'已经进行了访谈但目前还没有独立用户行为证据',evidenceUrl:'https://example.com/a',
   expected_revision:feedback.revision};
  assert.throws(()=>recordResearchGuidanceFollowup(db,'b',feedback.id,args),{code:'FEEDBACK_NOT_FOUND'});
  assert.throws(()=>recordResearchGuidanceFollowup(db,'a',feedback.id,{...args,evidenceUrl:'http://localhost/private'}),{code:'INVALID_EVIDENCE_URL'});
  assert.throws(()=>recordResearchGuidanceFollowup(db,'a',feedback.id,{...args,expected_revision:0}),{code:'REVISION_CONFLICT'});
  const followup=recordResearchGuidanceFollowup(db,'a',feedback.id,args);
  assert.equal(followup.followup.selfReported,true);
  assert.equal(followup.followup.evidenceUrl,'https://example.com/a');
  assert.equal(researchGuidanceFeedbackBoard(db,'a').summary.followedUp,1);
  assert.equal(researchGuidanceFeedbackBoard(db,'a').summary.uncertain,1);
  assert.throws(()=>recordResearchGuidanceFollowup(db,'a',feedback.id,{...args,expected_revision:followup.revision}),{code:'FOLLOWUP_EXISTS'});
 }finally{db.close();}
});
test('changed research facts produce a new feedback version while preserving the previous snapshot',()=>{
 const db=openDatabase();try{
  savePlan(db,'a');
  const first=respond(db,'a');
  const week=db.get('opportunity_weekly_plans','week:2026-10-12');
  db.put('opportunity_weekly_plans',{...week,progress:[{candidateId:'a',status:'in_progress',note:'真人研究进行中'}]},week.revision);
  const board=researchGuidanceFeedbackBoard(db,'a');
  assert.notEqual(board.fingerprint,first.fingerprint);
  const second=respond(db,'a',{response:'declined'});
  assert.notEqual(first.id,second.id);
  assert.equal(board.entries.length,1);
  assert.equal(researchGuidanceFeedbackBoard(db,'a').summary.total,2);
  assert.equal(db.get('opportunity_research_guidance_feedback',first.id).response,'accepted');
 }finally{db.close();}
});
