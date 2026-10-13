import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {shadowStatus,setShadowStatus,evaluateShadow,recordShadowSnapshot,shadowHistory} from '../src/discovery-shadow.mjs';
import {decideRuleTrial} from '../src/discovery-rule-approval.mjs';
test('shadow trial requires approval, caps sample percent and never changes sources',()=>{
 const db=openDatabase();try{
  assert.throws(()=>setShadowStatus(db,{action:'start',policy_id:'require_workaround',percentage:10,reason:'需要开始灰度影子对照验证',expected_revision:0}),{code:'NOT_APPROVED'});
  for(let i=0;i<25;i++){
   const id='case-'+i;
   const s=db.put('sources',{id,url:'https://forum.example/'+id,status:'new',title:'AI news',description:'Generic article'});
   db.put('discovery_quality_labels',{id,label:'not_problem',reason:'原帖经人工复核为普通资讯',sourceRevision:s.revision});
  }
  decideRuleTrial(db,{action:'approve_trial',policy_id:'require_workaround',reason:'已审查本组负样本并批准影子试验',expected_revision:0});
  assert.throws(()=>setShadowStatus(db,{action:'start',policy_id:'require_workaround',percentage:26,reason:'测试超出安全比例的配置上限',expected_revision:0}),{code:'BAD_PERCENTAGE'});
  const started=setShadowStatus(db,{action:'start',policy_id:'require_workaround',percentage:25,reason:'先对稳定小样本进行影子评估',expected_revision:0});
  assert.equal(started.active,true);
  assert.equal(started.revision,1);
  const sources=db.list('sources');
  const preview=evaluateShadow(db);
  assert.equal(preview.productionChanged,false);
  assert.equal(preview.examined,25);
  assert.deepEqual(evaluateShadow(db),preview);
  assert.deepEqual(db.list('sources'),sources);
  const snapshot=recordShadowSnapshot(db,{expected_revision:1});
  assert.equal(snapshot.revision,2);
  assert.equal(snapshot.lastRun.selected,preview.selected);
  assert.throws(()=>recordShadowSnapshot(db,{expected_revision:1}),{code:'REVISION_CONFLICT'});
  const stopped=setShadowStatus(db,{action:'stop',reason:'暂停当前候选规则的影子测试',expected_revision:2});
  assert.equal(stopped.active,false);
  assert.equal(evaluateShadow(db).active,false);
  assert.deepEqual(db.list('sources'),sources);
 }finally{db.close();}
});
test('revoked approval fails closed for shadow evaluation',()=>{
 const db=openDatabase();try{
  for(let i=0;i<20;i++){
   const s=db.put('sources',{id:'s'+i,title:'AI news',description:'Some article'});
   db.put('discovery_quality_labels',{id:s.id,label:'not_problem',sourceRevision:s.revision});
  }
  decideRuleTrial(db,{action:'approve_trial',policy_id:'require_workaround',reason:'人工审核通过只读影子实验流程',expected_revision:0});
  setShadowStatus(db,{action:'start',policy_id:'require_workaround',percentage:10,reason:'开始执行只读影子对照流程',expected_revision:0});
  decideRuleTrial(db,{action:'rollback_trial',policy_id:'require_workaround',reason:'人工撤回之前批准的规则试验',expected_revision:1});
  assert.equal(evaluateShadow(db).active,false);
  assert.equal(evaluateShadow(db).staleApproval,true);
  assert.throws(()=>recordShadowSnapshot(db,{expected_revision:1}),{code:'NOT_ACTIVE'});
 }finally{db.close();}
});

test('snapshot history retains comparisons and automatically stops on verified worsening',()=>{
 const db=openDatabase();try{
  // Approval uses unrelated reviewed negatives, while the shadow bucket gets
  // a separately selected group of current human-reviewed positives.
  for(let i=0;i<120;i++){
   const id='item-'+i;
   const description=i<20?'Generic article':'I copy invoices every day and spend hours fixing errors';
   const title=i<20?'AI news':'Cannot automate repetitive invoice workflow';
   const s=db.put('sources',{id,title,description,url:'https://example.org/'+id});
   db.put('discovery_quality_labels',{id,label:i<20?'not_problem':'real_problem',reason:'Actual human review',sourceRevision:s.revision});
  }
  // The rule is unsafe globally, so simulate an approval that preceded new evidence.
  db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround',history:[]});
  setShadowStatus(db,{action:'start',policy_id:'require_workaround',percentage:25,reason:'已获批准的候选现在进行影子观察',expected_revision:0});
  const preview=evaluateShadow(db);
  assert.ok(preview.reviewed>=5);
  assert.ok(preview.deltaFalseNegative>0);
  const saved=recordShadowSnapshot(db,{expected_revision:1});
  assert.equal(saved.active,false);
  assert.equal(saved.lastRun.autoStopped,true);
  assert.equal(shadowHistory(db).entries.length,1);
  assert.equal(shadowHistory(db).entries[0].autoStopped,true);
  assert.equal(db.list('sources').length,120);
 }finally{db.close();}
});
