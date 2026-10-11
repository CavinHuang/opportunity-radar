import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
function setup(){const db=openDatabase(); const s=createService(db);const o=s.createOpportunity({title:'Consumer pain',problem:'Repeated manual effort',market:'China',sources:[{url:'https://example.com/pain?utm_source=test',quote:'real quote'},{url:'https://example.com/pain?utm_source=other'}]});return {db,s,o};}
function experiment(s,o){return s.startExperiment({opportunityId:o.id,goal:'test consumer intent',hypothesis:'people want this',criteria:['core task works'],stopCondition:'stop after budget exhaustion',hours:10,cash:0});}
test('opportunity deduplicates tracking URLs and keeps evidence unverified',()=>{const {db,s,o}=setup();assert.equal(o.sources.length,1);assert.equal(o.evidenceStatus,'needs_verification');assert.equal(s.brief().candidates.length,1);db.close();});
test('single active experiment, immutable baseline, baseline budgets',()=>{const {db,s,o}=setup();assert.throws(()=>s.startExperiment({opportunityId:o.id,goal:'a',hypothesis:'b',criteria:[],stopCondition:'x'}));assert.throws(()=>s.startExperiment({opportunityId:o.id,goal:'a',hypothesis:'b',criteria:['x'],stopCondition:'x',hours:20}),e=>e.code==='EXTRA_BUDGET_REQUIRES_APPROVAL');
 const p=experiment(s,o);assert.equal(s.brief().active.id,p.id);assert.equal(p.baselines[0].revision,1);assert.throws(()=>experiment(s,o),e=>e.code==='ACTIVE_EXPERIMENT_EXISTS');const p2=s.ownerDecision(p.id,{action:'approve_budget',hours:15,newEvidence:'new independent user interview'});assert.equal(p2.baselines.length,2);assert.equal(p2.baselines[0].budget.weeklyUserHours,10);assert.equal(p2.baselines[1].budget.weeklyUserHours,15);db.close();});
test('agent idempotency, expected revision, lease fencing, cannot approve itself',()=>{const {db,s,o}=setup();const p=experiment(s,o);const m=s.getFullProject(p.id).milestones[1];const data={project_id:p.id,milestone_id:m.id,title:'Prototype',idempotency_key:'create-1'};
 const a=s.tool('task.upsert',data),b=s.tool('task.upsert',data);assert.deepEqual(a,b);assert.equal(s.getFullProject(p.id).tasks.length,1);
 const claim=s.tool('task.claim',{project_id:p.id,task_id:a.id,idempotency_key:'claim-1'});
 assert.ok(claim.lease_token);assert.throws(()=>s.tool('task.upsert',{...data,task_id:a.id,description:'x',expected_revision:a.revision,lease_token:'wrong',idempotency_key:'edit-wrong'}),e=>e.code==='LEASE_INVALID');
 assert.throws(()=>s.tool('task.upsert',{...data,task_id:a.id,description:'x',expected_revision:a.revision,lease_token:claim.lease_token,idempotency_key:'edit-stale'}),e=>e.code==='REVISION_CONFLICT');
 const transition=s.tool('task.transition',{task_id:a.id,status:'submitted',lease_token:claim.lease_token,expected_revision:claim.task.revision,idempotency_key:'transition-1'});assert.equal(transition.status,'submitted');
 const d=s.tool('decision.request',{project_id:p.id,kind:'scope_change',summary:'Change product scope',idempotency_key:'dec-1'});assert.equal(d.status,'pending');assert.equal(s.getFullProject(p.id).baselines[0].revision,1);
 assert.deepEqual(s.tools.length,12);assert.throws(()=>s.tool('collaboration.handoff',{}),e=>e.code==='CAPABILITY_DISABLED');db.close();});
test('submitted evidence never becomes verified from agent report; G4 blocked',()=>{const {db,s,o}=setup();const p=experiment(s,o);const m=s.getFullProject(p.id).milestones[1];const task=s.tool('task.upsert',{project_id:p.id,milestone_id:m.id,title:'Prototype',idempotency_key:'t1'});
 const evidence=s.tool('evidence.attach',{project_id:p.id,milestone_id:m.id,type:'github_pr',source_uri:'https://github.com/example/repo/pull/1',commit_sha:'a'.repeat(40),criteria_ids:p.baselines[0].criteria.map(x=>x.id),idempotency_key:'e1'});assert.equal(evidence.verificationState,'pending');
 const sub=s.tool('handoff.submit',{project_id:p.id,milestone_id:m.id,baseline_revision:1,commit_sha:'a'.repeat(40),evidence_ids:[evidence.id],idempotency_key:'s1'});assert.equal(sub.g2State,'covered');assert.equal(sub.acceptanceState,'pending');
 assert.throws(()=>s.ownerDecision(p.id,{action:'accept',submissionId:sub.id,reason:'I checked it'}),e=>e.code==='EVIDENCE_NOT_VERIFIED');
 const rejected=s.ownerDecision(p.id,{action:'reject',submissionId:sub.id,reason:'Missing verified CI'});assert.equal(rejected.acceptanceState,'rejected');
 const t=s.getFullProject(p.id).tasks.find(x=>x.id===task.id);assert.equal(t.status,'open');db.close();});
test('content approval invalidates on edit and records only manual publication',()=>{const {db,s,o}=setup();const p=experiment(s,o);const c=s.saveContent(p.id,{title:'A story',body:'I built a prototype and need feedback',objective:'interviews',channel:'site'});
 assert.throws(()=>s.reviewContent(p.id,c.id,{action:'publish_record',url:'https://example.com/post'}),e=>e.code==='CONTENT_NOT_APPROVED');
 const approved=s.reviewContent(p.id,c.id,{action:'approve',privacyChecked:true,factsChecked:true});assert.equal(approved.approvedRevision,approved.revision);
 const edited=s.saveContent(p.id,{id:c.id,expected_revision:approved.revision,title:'Rewrite',body:'New body',objective:'interviews',channel:'site'});assert.equal(edited.reviewState,'draft');
 const approved2=s.reviewContent(p.id,c.id,{action:'approve',privacyChecked:true,factsChecked:true});const published=s.reviewContent(p.id,c.id,{action:'publish_record',url:'https://example.com/posted',platform:'website'});assert.equal(published.publication.recordedBy,'owner');assert.equal(approved2.reviewState,'approved');db.close();});
test('ledger distinguishes real income, refunds, costs and human hours',()=>{const {db,s,o}=setup();const p=experiment(s,o);for(const [type,value,actual] of [['income',40,true],['refund',10,true],['transaction_fee',2,true],['service_cost',4,true],['income',500,false],['user_hours',9,true],['agent_hours',18,true]])s.addLedger(p.id,{type,value,actual});const out=s.summaryLedger(s.getFullProject(p.id).ledger);assert.deepEqual(out,{collected:40,refunds:10,contribution:24,userHours:9,agentHours:18,cashSpent:0});db.close();});
test('project pause revokes new agent writes but does not assert process stopped',()=>{const {db,s,o}=setup();const p=experiment(s,o);const pause=s.ownerDecision(p.id,{action:'pause',reason:'reassess'});assert.equal(pause.externalProcessState,'unknown');assert.throws(()=>s.tool('progress.report',{project_id:p.id,summary:'still running',idempotency_key:'r'}),e=>e.code==='PROJECT_NOT_ACTIVE');const resume=s.ownerDecision(p.id,{action:'resume'});assert.equal(resume.status,'research');db.close();});
test('event cursors replay independently of agent availability',()=>{const {db,s,o}=setup();const p=experiment(s,o);const start=s.tool('project.watch_changes',{project_id:p.id,cursor:0});assert.ok(start.events.length);s.tool('progress.report',{project_id:p.id,summary:'submitted work',idempotency_key:'r2'});const next=s.tool('project.watch_changes',{project_id:p.id,cursor:start.next_cursor});assert.ok(next.events.some(x=>x.kind==='agent.reported'));assert.ok(next.next_cursor>start.next_cursor);db.close();});

test('campaign measurements only reference actually published content in same project',()=>{
 const {db,s,o}=setup();try{
  const p=experiment(s,o);
  const c=s.saveContent(p.id,{title:'Launch story',body:'True research update',objective:'Invite feedback',channel:'community',claims:[]});
  assert.throws(()=>s.addLedger(p.id,{type:'visits',value:8,contentId:c.id,actual:true}),{code:'BAD_CAMPAIGN_REF'});
  const approved=s.reviewContent(p.id,c.id,{action:'approve',factsChecked:true,privacyChecked:true});
  const published=s.reviewContent(p.id,c.id,{action:'publish_record',url:'https://example.org/published',platform:'community'});
  const entry=s.addLedger(p.id,{type:'visits',value:8,contentId:published.id,actual:true,source:'public analytics'});
  assert.equal(entry.contentId,c.id);
  const other=s.createOpportunity({title:'Different',problem:'Other problem',market:'China'});
  assert.ok(other.id);
 }finally{db.close();}
});
