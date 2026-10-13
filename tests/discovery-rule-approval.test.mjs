import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {decideRuleTrial,ruleTrialLedger} from '../src/discovery-rule-approval.mjs';

test('owner trial approvals require reviewed evidence and never change production config',()=>{
 const db=openDatabase();try{
  assert.equal(ruleTrialLedger(db).revision,0);
  assert.throws(()=>decideRuleTrial(db,{action:'approve_trial',policy_id:'require_workaround',reason:'人工确认之后计划小范围试验',expected_revision:0}),{code:'INSUFFICIENT_EVIDENCE'});
  for(let i=0;i<20;i++){
   const id='case-'+i;
   const s=db.put('sources',{id,url:'https://forum.example/'+id,title:'Problem report',description:'A general list of ideas'});
   db.put('discovery_quality_labels',{id,label:'not_problem',reason:'人工确认不是消费者痛点',sourceRevision:s.revision});
  }
  const approved=decideRuleTrial(db,{action:'approve_trial',policy_id:'require_workaround',reason:'样本回放未变差，批准离线试验记录',expected_revision:0});
  assert.equal(approved.selectedTrial,'require_workaround');
  assert.equal(approved.revision,1);
  assert.equal(approved.liveRuleChanged,false);
  assert.throws(()=>decideRuleTrial(db,{action:'reject',policy_id:'require_workaround',reason:'并发修订应该被安全拒绝',expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>decideRuleTrial(db,{action:'rollback_trial',policy_id:'review_promotion_block',reason:'试图撤销非当前试验需要拒绝',expected_revision:1}),{code:'TRIAL_NOT_ACTIVE'});
  const rollback=decideRuleTrial(db,{action:'rollback_trial',policy_id:'require_workaround',reason:'人工撤销试验，回退选择到无',expected_revision:1});
  assert.equal(rollback.selectedTrial,null);
  assert.equal(rollback.revision,2);
  assert.deepEqual(rollback.history.map(x=>x.action),['approve_trial','rollback_trial']);
  assert.equal(db.list('sources').length,20);
 }finally{db.close();}
});
test('refuses unknown variant, weak rationale and bypassing adverse deltas',()=>{
 const db=openDatabase();try{
  assert.throws(()=>decideRuleTrial(db,{action:'approve_trial',policy_id:'unknown',reason:'足够长度理由文本至少十二字',expected_revision:0}),{code:'BAD_POLICY'});
  assert.throws(()=>decideRuleTrial(db,{action:'reject',policy_id:'require_workaround',reason:'short',expected_revision:0}),{code:'REASON_REQUIRED'});
  for(let i=0;i<20;i++){
   const id='pain-'+i;
   const s=db.put('sources',{id,url:'https://forum.example/'+id,title:'Cannot automate repetitive invoice workflow',description:'I copy invoices every day and spend hours fixing errors'});
   db.put('discovery_quality_labels',{id,label:'real_problem',reason:'人工确认是未解决的实际困难',sourceRevision:s.revision});
  }
  assert.throws(()=>decideRuleTrial(db,{action:'approve_trial',policy_id:'require_workaround',reason:'试图批准已知会增加漏报的规则',expected_revision:0}),{code:'REGRESSION_DETECTED'});
  assert.equal(ruleTrialLedger(db).revision,0);
 }finally{db.close();}
});
