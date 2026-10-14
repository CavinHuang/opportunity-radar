import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {saveWeeklyResearchPlan,reviewWeeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
import {weeklyHypothesisBoard,saveWeeklyHypothesis} from '../src/opportunity-weekly-hypotheses.mjs';

test('weekly hypothesis requires evidence and reason for supported verdict, keeps unknown honest',()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'a',status:'new',url:'https://example.org/problem',
   title:'I cannot reconcile invoice records manually',
   description:'I manually reconcile invoices every day and spend hours fixing errors'});
  const id=opportunityScanCandidates(db).items[0].id;
  const now=new Date(),options={now};
  saveWeeklyResearchPlan(db,{expected_revision:0,items:[{candidateId:id,task:'访谈使用发票工具的人是否持续有成本障碍',hours:3,budget:0}]},options);
  const board=weeklyHypothesisBoard(db,options);
  const data={candidateId:id,planRevision:board.planRevision,expected_revision:board.revision,
   hypothesis:'用户每周都会人工处理难以自动核对的发票数据',
   expectedEvidence:'来自真实用户的工作步骤和任务发生频率描述',
   falsifier:'若不同受访者都没有持续性重复工作则停止',
   finding:'supported',rationale:'本次有可核实的工作行为记录',eventSeqs:[]};
  assert.throws(()=>saveWeeklyHypothesis(db,data,options),{code:'INSUFFICIENT_REASON'});
  const saved=saveWeeklyHypothesis(db,{...data,finding:'unknown',rationale:''},options);
  assert.equal(saved.items[0].finding,'unknown');
  assert.throws(()=>saveWeeklyHypothesis(db,{...data,expected_revision:0,finding:'unknown'},options),{code:'REVISION_CONFLICT'});
  db.event('problem.interview.observed',id,'owner',{observationId:'observation-1'});
  db.event('problem.interview.observed','other-candidate','owner',{observationId:'unrelated'});
  const next=weeklyHypothesisBoard(db,options);
  const evidence=next.items[0].eligibleEvidence.find(e=>e.kind==='problem.interview.observed');
  assert.ok(evidence);
  assert.throws(()=>saveWeeklyHypothesis(db,{...data,expected_revision:1,eventSeqs:[evidence.seq+1]},options),{code:'FOREIGN_EVIDENCE'});
  const reviewed=saveWeeklyHypothesis(db,{...data,expected_revision:1,eventSeqs:[evidence.seq]},options);
  assert.equal(reviewed.items[0].finding,'supported');
  assert.equal(weeklyHypothesisBoard(db,options).items[0].linkedEvidence.length,1);
  reviewWeeklyResearchPlan(db,{expected_revision:1,notes:'本周访谈仍需要核查受访者独立性和支付行为',
   results:[{candidateId:id,status:'inconclusive',actualHours:2,actualCost:0,observation:'尚未得到能够独立证实商业需求的结论'}]},options);
  assert.throws(()=>saveWeeklyHypothesis(db,{...data,expected_revision:2,planRevision:2},options),{code:'WEEK_CLOSED'});
 }finally{db.close();}
});
test('hypothesis board does not create phantom evidence',()=>{
 const db=openDatabase();try{
  const r=weeklyHypothesisBoard(db);
  assert.deepEqual(r.items,[]);
 }finally{db.close();}
});
