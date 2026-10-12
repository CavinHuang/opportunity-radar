import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.mjs';import {verificationContext,verifyProblem} from '../src/problem-verification.mjs';import {createInterviewPlan,addInterviewObservation,decideInterviewPlan} from '../src/problem-interviews.mjs';import {interviewEvidenceSummary,designProblemExperiment,problemExperimentDesigns} from '../src/problem-experiments.mjs';
test('draft experiment requires verified interviews, explicit conditions and budget; never starts projects',()=>{
 const db=openDatabase();try{
 db.put('sources',{id:'a',status:'new',url:'https://forum.example/a',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day, spending hours fixing errors'});
 const ctx=verificationContext(db,'signal:a');
 verifyProblem(db,'signal:a',{fingerprint:ctx.fingerprint,firsthandConfirmed:true,impactConfirmed:true,actualWorkaround:'Manual spreadsheet copying',alternativeAdequacy:'inadequate',decision:'worth_interviewing',notes:'原帖说明人工复制引发重复劳动和错误',expected_revision:0});
 const p=createInterviewPlan(db,'signal:a',{audience:'Freelancers manually copying invoices',hypothesis:'Manual invoice copying happens repeatedly and causes mistakes',falsifier:'Interviewees confirm existing tools solve all repetition',questions:'Describe the last time the manual work happened',minInterviews:1});
 assert.throws(()=>designProblemExperiment(db,'signal:a',p.id,{}),{code:'DECISION_REQUIRED'});
 addInterviewObservation(db,'signal:a',p.id,{participant:'anonymous-1',scenario:'Weekly invoice imports fail multiple times',actualBehavior:'The user manually recopied rows into a spreadsheet',contradiction:'The existing tool sometimes imports successfully'});
 decideInterviewPlan(db,'signal:a',p.id,{decision:'low_cost_test',reason:'受访记录显示问题重复出现，但已有部分工具可解决',expected_revision:p.revision});
 const sum=interviewEvidenceSummary(db,'signal:a',p.id);assert.equal(sum.supporting.length,1);assert.equal(sum.counterEvidence.length,1);
 const data={targetUser:'Freelancers frequently importing invoices',experimentMethod:'Provide a manual prototype for one repeated workflow',successCondition:'At least one user successfully completes the real task',stopCondition:'The real workflow is already solved or cannot be repeated',acceptanceEvidence:'Keep timestamped walkthrough notes and original task results',budgetLimit:100,currency:'CNY'};
 const d=designProblemExperiment(db,'signal:a',p.id,data);assert.equal(d.status,'draft');assert.equal(problemExperimentDesigns(db,'signal:a',p.id).designs.length,1);
 assert.throws(()=>designProblemExperiment(db,'signal:a',p.id,data),{code:'DESIGN_EXISTS'});
 assert.equal(db.list('projects').length,0);assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});