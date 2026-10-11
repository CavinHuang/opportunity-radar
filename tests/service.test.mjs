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

test('manual publication scheduling fences revisions, validates timezone and preserves approval',()=>{
 const {db,s,o}=setup();try{
  const p=experiment(s,o);
  const c=s.saveContent(p.id,{title:'Launch',body:'True information',objective:'Research',channel:'blog',claims:[]});
  assert.throws(()=>s.scheduleContent(p.id,c.id,{plannedAt:'2028-03-20T12:00:00+08:00',expected_revision:99}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>s.scheduleContent(p.id,c.id,{plannedAt:'2028-03-20T12:00:00',expected_revision:c.revision}),{code:'BAD_REQUEST'});
  const approved=s.reviewContent(p.id,c.id,{action:'approve',factsChecked:true,privacyChecked:true});
  const scheduled=s.scheduleContent(p.id,c.id,{plannedAt:'2028-03-20T12:00:00+08:00',expected_revision:approved.revision});
  assert.equal(scheduled.reviewState,'approved');
  assert.equal(scheduled.plannedAt,'2028-03-20T04:00:00.000Z');
  assert.equal(scheduled.approvedRevision,scheduled.revision);
  const publication=s.reviewContent(p.id,c.id,{action:'publish_record',url:'https://example.com/article'});
  assert.equal(publication.reviewState,'published');
  assert.throws(()=>s.scheduleContent(p.id,c.id,{plannedAt:'2028-04-20T12:00:00+08:00',expected_revision:publication.revision}),{code:'CONTENT_ALREADY_PUBLISHED'});
 }finally{db.close();}
});

test('task-level progress reports need the lease, record risks, and never change status or acceptance',()=>{
 const {db,s,o}=setup();try{
  const p=experiment(s,o);
  const m=s.getFullProject(p.id).milestones[1];
  const task=s.tool('task.upsert',{project_id:p.id,milestone_id:m.id,title:'Prototype work',idempotency_key:'tp-1'});
  const claim=s.tool('task.claim',{project_id:p.id,task_id:task.id,idempotency_key:'tp-claim'});
  // negative: no lease token
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'self service',idempotency_key:'tp-neg1'}),e=>e.code==='LEASE_INVALID');
  // negative: wrong lease token
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'self service',lease_token:'wrong',idempotency_key:'tp-neg2'}),e=>e.code==='LEASE_INVALID');
  // negative: empty summary
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'  ',lease_token:claim.lease_token,idempotency_key:'tp-neg3'}),e=>e.code==='BAD_REQUEST');
  // negative: risks not an array / too many
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'ok',risks:'flat',lease_token:claim.lease_token,idempotency_key:'tp-neg4'}),e=>e.code==='BAD_REQUEST');
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'ok',risks:['1','2','3','4','5','6','7','8','9','10','11'],lease_token:claim.lease_token,idempotency_key:'tp-neg5'}),e=>e.code==='BAD_REQUEST');
  // negative: empty risk entry
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'ok',risks:['   '],lease_token:claim.lease_token,idempotency_key:'tp-neg6'}),e=>e.code==='BAD_REQUEST');
  // negative: task outside project / missing task
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:'missing-task',summary:'ok',lease_token:claim.lease_token,idempotency_key:'tp-neg7'}),e=>e.code==='NOT_FOUND');
  const report=s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'核心流程已能跑通，尚未覆盖导出',risks:['导出功能可能超时','尚未做真实用户验证'],lease_token:claim.lease_token,idempotency_key:'tp-report'});
  assert.equal(report.taskId,task.id);
  assert.equal(report.taskStatus,'in_progress');
  assert.equal(report.note.includes('不能替代人工验收'),true);
  const replay=s.tool('progress.report',{project_id:p.id,task_id:task.id,summary:'核心流程已能跑通，尚未覆盖导出',risks:['导出功能可能超时','尚未做真实用户验证'],lease_token:claim.lease_token,idempotency_key:'tp-report'});
  assert.deepEqual(replay,report);
  const stored=s.getFullProject(p.id).tasks.find(x=>x.id===task.id);
  assert.equal(stored.status,'in_progress');
  assert.equal(stored.latestProgress.summary,'核心流程已能跑通，尚未覆盖导出');
  assert.deepEqual(stored.latestProgress.risks,['导出功能可能超时','尚未做真实用户验证']);
  assert.equal(stored.latestProgress.at,report.recordedAt);
  // project-level summary is not overwritten by a task-level report; sync time is.
  assert.equal(s.getFullProject(p.id).latestAgentReport,null);
  assert.ok(s.getFullProject(p.id).agentLastSync);
  // project-level report still works as before
  const projectReport=s.tool('progress.report',{project_id:p.id,summary:'overall status',idempotency_key:'tp-project'});
  assert.equal(projectReport.lastSync,s.getFullProject(p.id).agentLastSync);
  assert.equal(s.getFullProject(p.id).latestAgentReport,'overall status');
  // reporting on a task that was never claimed is refused
  const openTask=s.tool('task.upsert',{project_id:p.id,milestone_id:m.id,title:'Open only',idempotency_key:'tp-2'});
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,task_id:openTask.id,summary:'no lease held',idempotency_key:'tp-neg8'}),e=>e.code==='LEASE_INVALID');
  // task status transitions still require the explicit transition tool: report ≠ acceptance
  const events=s.store.events(0,p.id);
  assert.ok(events.some(x=>x.kind==='task.progress_reported'));
  assert.ok(!events.some(x=>x.kind.startsWith('acceptance.')&&x.actor==='agent:external'));
 }finally{db.close();}
});

test('archived projects keep history and reopen the opportunity for re-triage (G01 exit path)',()=>{
 const {db,s,o}=setup();try{
  const p=experiment(s,o);
  const archived=s.ownerDecision(p.id,{action:'archive',reason:'结论已复盘，不再继续投入'});
  assert.equal(archived.project.status,'archived');
  assert.equal(archived.opportunity.status,'candidate');
  assert.throws(()=>s.ownerDecision(p.id,{action:'archive',reason:'again'}),e=>e.code==='BAD_STATE');
  // agent write paths are fenced after archiving
  assert.throws(()=>s.tool('progress.report',{project_id:p.id,summary:'late report',idempotency_key:'arch-1'}),e=>e.code==='PROJECT_NOT_ACTIVE');
  // the freed candidate re-enters the weekly brief
  assert.ok(s.brief().candidates.some(x=>x.id===o.id));
  // audit trail records the exit explicitly
  const events=s.store.events(0,p.id);
  assert.ok(events.some(x=>x.kind==='project.archived'));
  assert.ok(events.some(x=>x.kind==='opportunity.reopened'));
 }finally{db.close();}
});

test('opportunity re-triage stays blocked while paused but unlocks after stop or archive (G01)',()=>{
 const {db,s,o}=setup();try{
  const p=experiment(s,o);
  const opp=()=>s.store.get('opportunities',o.id);
  // paused: experiment may resume, so re-triage stays blocked
  s.ownerDecision(p.id,{action:'pause',reason:'budget pause'});
  assert.throws(()=>s.changeOpportunityStatus(o.id,{status:'dismissed',expected_revision:opp().revision}),e=>e.code==='PROJECT_IN_PROGRESS');
  s.ownerDecision(p.id,{action:'resume'});
  // resume keeps status and stage consistent (previously stage drifted behind status)
  const resumed=s.getFullProject(p.id);
  assert.equal(resumed.status,'research');
  assert.equal(resumed.stage,'research');
  // stop: authorization ended, owner may re-triage the opportunity
  s.ownerDecision(p.id,{action:'stop',reason:'stop after review'});
  const triaged=s.changeOpportunityStatus(o.id,{status:'watching',expected_revision:opp().revision});
  assert.equal(triaged.status,'watching');
 }finally{db.close();}
});

test('resume restores a consistent read model when a promotion-stage project is paused',()=>{
 const {db,s,o}=setup();try{
  const p=experiment(s,o);
  const prj=s.store.get('projects',p.id);
  s.store.put('projects',{...prj,status:'paused',stage:'promotion'},prj.revision);
  const resumed=s.ownerDecision(p.id,{action:'resume'});
  assert.equal(resumed.status,'research');
  assert.equal(resumed.stage,'research');
 }finally{db.close();}
});


test('agent blocking requires a reason and stores it on the task',()=>{const {db,s,o}=setup();const p=experiment(s,o);const m=s.getFullProject(p.id).milestones[1];const task=s.tool('task.upsert',{project_id:p.id,milestone_id:m.id,title:'Prototype',idempotency_key:'t1'});
 const claim=s.tool('task.claim',{project_id:p.id,task_id:task.id,idempotency_key:'c1'});
 assert.throws(()=>s.tool('task.transition',{task_id:task.id,status:'blocked',lease_token:claim.lease_token,expected_revision:claim.task.revision,idempotency_key:'b0'}),e=>e.code==='BAD_REQUEST');
 assert.throws(()=>s.tool('task.transition',{task_id:task.id,status:'blocked',blocked_reason:'   ',lease_token:claim.lease_token,expected_revision:claim.task.revision,idempotency_key:'b0b'}),e=>e.code==='BAD_REQUEST');
 const blocked=s.tool('task.transition',{task_id:task.id,status:'blocked',blocked_reason:'waiting for external review feedback',lease_token:claim.lease_token,expected_revision:claim.task.revision,idempotency_key:'b1'});
 assert.equal(blocked.status,'blocked');assert.equal(blocked.blockedReason,'waiting for external review feedback');db.close();});
test('content approval and publication registration freeze on inactive projects; late ledger stays possible',()=>{const {db,s,o}=setup();const p=experiment(s,o);const c=s.saveContent(p.id,{title:'A story',body:'I built a prototype and need feedback',objective:'interviews',channel:'site'});
 const approved=s.reviewContent(p.id,c.id,{action:'approve',privacyChecked:true,factsChecked:true});
 s.ownerDecision(p.id,{action:'pause',reason:'reassess'});
 assert.throws(()=>s.reviewContent(p.id,c.id,{action:'approve',privacyChecked:true,factsChecked:true}),e=>e.code==='PROJECT_NOT_ACTIVE');
 assert.throws(()=>s.reviewContent(p.id,c.id,{action:'publish_record',url:'https://example.com/late-post'}),e=>e.code==='PROJECT_NOT_ACTIVE');
 s.addLedger(p.id,{type:'visits',value:3,actual:true});
 assert.equal(s.getFullProject(p.id).ledger.length,1,'late actual recording stays possible by design');db.close();});
