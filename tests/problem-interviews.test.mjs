import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {verificationContext,verifyProblem} from '../src/problem-verification.mjs';
import {interviewBoard,createInterviewPlan,addInterviewObservation,decideInterviewPlan} from '../src/problem-interviews.mjs';
function fixture(){const db=openDatabase();db.put('sources',{id:'a',status:'new',url:'https://forum.example/a',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day, spending hours fixing errors'});return db;}
function authorize(db){const ctx=verificationContext(db,'signal:a');verifyProblem(db,'signal:a',{fingerprint:ctx.fingerprint,firsthandConfirmed:true,impactConfirmed:true,actualWorkaround:'Use spreadsheet and manually copy invoices',alternativeAdequacy:'inadequate',decision:'worth_interviewing',notes:'原帖说明每周需要手工操作且现有方案明显不足',expected_revision:0});}
const planData={audience:'Freelancers manually copying invoices',hypothesis:'Manual invoice copying happens repeatedly and causes mistakes',falsifier:'Interviewees report no repeated problems or existing tools solve it',questions:'Describe the last time this happened and what you did',minInterviews:2};
const obs={participant:'anonymous-01',scenario:'Invoices required three manual imports this week',actualBehavior:'They copied the fields into spreadsheets and checked totals',contradiction:'Existing ERP imports solved some parts but still required copying'};
test('interviews require an owner-verified real problem',()=>{const db=fixture();try{assert.throws(()=>createInterviewPlan(db,'signal:a',planData),{code:'VERIFICATION_REQUIRED'});}finally{db.close()}});
test('plans are falsifiable and decision requires real observations',()=>{const db=fixture();try{
 authorize(db);
 const plan=createInterviewPlan(db,'signal:a',planData);
 assert.equal(interviewBoard(db,'signal:a').plans.length,1);
 assert.throws(()=>createInterviewPlan(db,'signal:a',planData),{code:'ACTIVE_PLAN_EXISTS'});
 assert.throws(()=>decideInterviewPlan(db,'signal:a',plan.id,{decision:'low_cost_test',reason:'用户仍然发生真实的数据复制问题且替代方案不足',expected_revision:plan.revision}),{code:'INSUFFICIENT_INTERVIEWS'});
 addInterviewObservation(db,'signal:a',plan.id,obs);
 addInterviewObservation(db,'signal:a',plan.id,{...obs,participant:'anonymous-02'});
 const done=decideInterviewPlan(db,'signal:a',plan.id,{decision:'low_cost_test',reason:'两位受访者确实仍需人工复制且现有工具并不完全解决',expected_revision:plan.revision});
 assert.equal(done.status,'closed');assert.equal(done.decision,'low_cost_test');
 assert.equal(db.list('opportunities').length,0);
 assert.equal(db.list('projects').length,0);
 }finally{db.close()}});
test('recorded observations are not fabricated and owner can stop early',()=>{const db=fixture();try{
 authorize(db);const plan=createInterviewPlan(db,'signal:a',planData);
 assert.throws(()=>addInterviewObservation(db,'signal:a',plan.id,{...obs,sourceUrl:'http://example.org/foo'}),{code:'BAD_SOURCE'});
 const done=decideInterviewPlan(db,'signal:a',plan.id,{decision:'stop',reason:'已经发现目标客户无需求，现有免费工具完全能够解决',expected_revision:plan.revision});
 assert.equal(done.decision,'stop');
 assert.equal(db.list('problem_interview_observations').length,0);
 }finally{db.close()}});
