import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.mjs';import {verificationContext,verifyProblem} from '../src/problem-verification.mjs';import {createInterviewPlan,addInterviewObservation,decideInterviewPlan} from '../src/problem-interviews.mjs';import {designProblemExperiment} from '../src/problem-experiments.mjs';import {experimentExecutionBoard,recordExperimentResult,closeExperiment} from '../src/problem-execution.mjs';
function setup(){const db=openDatabase();db.put('sources',{id:'a',status:'new',url:'https://forum.example/a',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day, spending hours fixing errors'});const id='signal:a',v=verificationContext(db,id);verifyProblem(db,id,{fingerprint:v.fingerprint,firsthandConfirmed:true,impactConfirmed:true,actualWorkaround:'Manual spreadsheet copying',alternativeAdequacy:'inadequate',decision:'worth_interviewing',notes:'原帖说明长期重复手工处理并且造成实际错误',expected_revision:0});
 const p=createInterviewPlan(db,id,{audience:'Freelancers manually copying invoices',hypothesis:'Repeated copying causes costly errors for freelancers',falsifier:'Existing free tools solve repetitive invoice imports',questions:'Describe a recent failed invoice import',minInterviews:1});
 addInterviewObservation(db,id,p.id,{participant:'anonymous-1',scenario:'Invoice workflow failed on two work days',actualBehavior:'They repeatedly recopied invoices and verified every line',contradiction:'A free existing importer fixed most invoices'});
 decideInterviewPlan(db,id,p.id,{decision:'low_cost_test',reason:'实际访谈说明重复处理仍有成本，免费工具存在缺口',expected_revision:p.revision});
 const d=designProblemExperiment(db,id,p.id,{targetUser:'Freelancers copying invoices between business applications',experimentMethod:'Run a guided manual prototype with consent for one user',successCondition:'One user completes real repeated invoice workflow faster',stopCondition:'If no time saved or available tools solve the problem stop',acceptanceEvidence:'Keep anonymized original workflow and final result evidence',budgetLimit:10,currency:'USD'});
 return {db,id,planId:p.id,designId:d.id};
}
test('records real execution and prevents over-budget or fabricated continuation',()=>{const {db,id,planId,designId}=setup();try{
 const args={step:'Guided workflow trial',participant:'anonymous-1',behavior:'Person manually copied three invoice rows in prototype',outcome:'One duplicate was detected but import still required a manual correction',cost:4,evidenceUrl:'https://evidence.example/run-1'};
 assert.throws(()=>recordExperimentResult(db,id,planId,designId,{...args,cost:11}),{code:'BUDGET_EXCEEDED'});
 assert.throws(()=>recordExperimentResult(db,id,planId,designId,{...args,evidenceUrl:'http://bad.example'}),{code:'INVALID_EVIDENCE_URL'});
 const record=recordExperimentResult(db,id,planId,designId,args);
 assert.equal(record.cost,4);
 const board=experimentExecutionBoard(db,id,planId,designId);assert.equal(board.actualCost,4);assert.equal(board.remainingBudget,6);
 const result=closeExperiment(db,id,planId,designId,{decision:'iterate',reason:'原型减少重复，但依然有人工错误需要进一步完善',expected_revision:board.design.revision});
 assert.equal(result.status,'closed');assert.equal(result.actualCost,4);
 assert.throws(()=>recordExperimentResult(db,id,planId,designId,args),{code:'EXPERIMENT_CLOSED'});
 assert.equal(db.list('projects').length,0);
 }finally{db.close()}});
test('continuing without recorded user behavior is prohibited but early stopping works',()=>{const {db,id,planId,designId}=setup();try{
 const rev=experimentExecutionBoard(db,id,planId,designId).design.revision;
 assert.throws(()=>closeExperiment(db,id,planId,designId,{decision:'continue',reason:'尚未拿到足够行为证据所以不能继续投入',expected_revision:rev}),{code:'NO_RESULTS'});
 assert.equal(closeExperiment(db,id,planId,designId,{decision:'stop',reason:'现有替代方式能够完成任务，继续开发价值不高',expected_revision:rev}).decision,'stop');
 }finally{db.close()}});
