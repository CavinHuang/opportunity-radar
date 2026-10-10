import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';

function harness(){
 const directory=mkdtempSync(join(tmpdir(),'radar-agent-process-'));
 const path=join(directory,'radar.sqlite');
 const store=openDatabase(path);
 const service=createService(store);
 const opportunity=service.createOpportunity({title:'An evidence-driven prototype',problem:'A repeatable consumer problem',market:'Global'});
 const project=service.startExperiment({opportunityId:opportunity.id,goal:'Implement a usable core flow',
   hypothesis:'Consumer use cases should be observable',criteria:['A real core flow completes'],
   stopCondition:'Stop if actual evidence cannot be obtained'});
 const kickoff=service.prepareKickoff(project.id).task;
 const milestone=service.getFullProject(project.id).milestones[1];
 return {directory,path,store,service,project,kickoff,milestone,
   close(){store.close();rmSync(directory,{recursive:true,force:true})}};
}
function createClient(path){
 const child=spawn(process.execPath,[resolve('src/mcp-stdio.mjs')],{
   cwd:process.cwd(),env:{...process.env,RADAR_DB:path},stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
 const iterator=lines[Symbol.asyncIterator]();
 let sequence=0;
 const errors=[];child.stderr.on('data',b=>errors.push(String(b)));
 return {
  async rpc(method,params={}){
   const id=++sequence;
   child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
   let timeout;
   try{
    const response=await Promise.race([iterator.next(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('MCP stdio timeout: '+method+'; '+errors.join(''))),7000)})]);
    if(response.done)throw new Error('MCP server disconnected: '+errors.join(''));
    const message=JSON.parse(response.value);
    assert.equal(message.id,id);if(message.error)throw new Error(JSON.stringify(message.error));
    return message.result;
   }finally{clearTimeout(timeout);}
  },
  async tool(name,args={}){
   const result=await this.rpc('tools/call',{name,arguments:args});
   const value=result.structuredContent?.result;
   if(result.isError){
     const failure=JSON.parse(result.content[0].text);
     throw Object.assign(new Error(failure.message),{code:failure.error});
   }
   return value;
  },
  async stop(force=false){
   if(force)child.kill('SIGKILL');else child.stdin.end();
   await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1800))]);
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
   lines.close();
  }
 };
}
const shaA='a'.repeat(40),shaB='b'.repeat(40);
const key=(prefix)=>prefix+'-'+Math.random().toString(36).slice(2);
test('separate MCP process performs T1-style evidence handoff and T2 rejection/rework',async()=>{
 const x=harness();
 let external;
 try{
  external=createClient(x.path);
  assert.equal((await external.rpc('initialize',{protocolVersion:'2025-11-25'})).serverInfo.name,'opportunity-radar');
  assert.equal((await external.rpc('tools/list')).tools.length,12);
  const context=await external.tool('project.get_context',{project_id:x.project.id});
  assert.equal(context.baseline.revision,1);
  const tasks=await external.tool('project.get_next_work',{project_id:x.project.id});
  assert.ok(tasks.tasks.some(t=>t.id===x.kickoff.id));
  const claimArg={project_id:x.project.id,task_id:x.kickoff.id,baseline_revision:1,
    expected_revision:x.kickoff.revision,idempotency_key:key('claim')};
  const claim=await external.tool('task.claim',claimArg);
  assert.deepEqual(await external.tool('task.claim',claimArg),claim);
  await assert.rejects(()=>external.tool('task.claim',{...claimArg,idempotency_key:key('stale'),baseline_revision:999}),
    {code:'BASELINE_STALE'});
  const submitted=await external.tool('task.transition',{task_id:x.kickoff.id,status:'submitted',
    lease_token:claim.lease_token,expected_revision:claim.task.revision,idempotency_key:key('submitted')});
  assert.equal(submitted.status,'submitted');
  const evidenceA=await external.tool('evidence.attach',{project_id:x.project.id,milestone_id:x.milestone.id,
    type:'github_pr',source_uri:'https://github.com/example/radar/pull/1',
    commit_sha:shaA,criteria_ids:x.project.baselines[0].criteria.map(c=>c.id),idempotency_key:key('evidenceA')});
  assert.equal(evidenceA.verificationState,'pending');
  const first=await external.tool('handoff.submit',{project_id:x.project.id,milestone_id:x.milestone.id,
    baseline_revision:1,commit_sha:shaA,evidence_ids:[evidenceA.id],idempotency_key:key('firstHandoff')});
  assert.equal(first.g2State,'covered');
  assert.throws(()=>x.service.ownerDecision(x.project.id,{action:'accept',submissionId:first.id,reason:'Agent said tests passed'}),
    {code:'EVIDENCE_NOT_VERIFIED'});
  const rejected=x.service.ownerDecision(x.project.id,{action:'reject',submissionId:first.id,reason:'Core interaction not acceptable, repair the UX'});
  assert.equal(rejected.acceptanceState,'rejected');
  const task=x.store.get('tasks',x.kickoff.id);
  assert.equal(task.status,'rework');assert.equal(task.lease,null);
  assert.match(task.reworkReason,/Core interaction/);
  const followup=await external.tool('project.get_next_work',{project_id:x.project.id});
  assert.ok(followup.tasks.some(t=>t.id===task.id&&t.status==='rework'));
  await assert.rejects(()=>external.tool('task.transition',{task_id:task.id,status:'submitted',
    lease_token:claim.lease_token,expected_revision:task.revision,idempotency_key:key('oldLease')}),{code:'LEASE_INVALID'});
  const repairClaim=await external.tool('task.claim',{project_id:x.project.id,task_id:task.id,baseline_revision:1,
    expected_revision:task.revision,idempotency_key:key('repairClaim')});
  assert.notEqual(repairClaim.lease_token,claim.lease_token);
  await external.tool('task.transition',{task_id:task.id,status:'submitted',lease_token:repairClaim.lease_token,
    expected_revision:repairClaim.task.revision,idempotency_key:key('repairDone')});
  const evidenceB=await external.tool('evidence.attach',{project_id:x.project.id,milestone_id:x.milestone.id,
    type:'github_pr',source_uri:'https://github.com/example/radar/pull/2',commit_sha:shaB,
    criteria_ids:x.project.baselines[0].criteria.map(c=>c.id),idempotency_key:key('evidenceB')});
  const second=await external.tool('handoff.submit',{project_id:x.project.id,milestone_id:x.milestone.id,
    baseline_revision:1,commit_sha:shaB,evidence_ids:[evidenceB.id],idempotency_key:key('secondHandoff')});
  assert.equal(second.commitSha,shaB);
  assert.equal(x.store.get('evidence',evidenceB.id).verificationState,'pending');
  assert.throws(()=>x.service.ownerDecision(x.project.id,{action:'accept',submissionId:second.id,reason:'Not independently verified'}),
    {code:'EVIDENCE_NOT_VERIFIED'});
  assert.throws(()=>x.service.ownerDecision(x.project.id,{action:'reject',submissionId:first.id,reason:'obsolete'}),
    {code:'BAD_STATE'});
 }finally{if(external)await external.stop();x.close();}
});
test('separate MCP client crashes, expires, reconciles and fences old token (T3)',async()=>{
 const x=harness();let first,second;
 try{
  first=createClient(x.path);
  const before=await first.tool('project.watch_changes',{project_id:x.project.id,cursor:0});
  const claim=await first.tool('task.claim',{project_id:x.project.id,task_id:x.kickoff.id,baseline_revision:1,
    expected_revision:x.kickoff.revision,idempotency_key:key('firstClaim')});
  await first.stop(true);first=null;
  const t=x.store.get('tasks',x.kickoff.id);
  x.store.put('tasks',{...t,lease:{...t.lease,expiresAt:new Date(Date.now()-5000).toISOString()}},t.revision);
  second=createClient(x.path);
  const changes=await second.tool('project.watch_changes',{project_id:x.project.id,cursor:before.next_cursor});
  assert.ok(changes.events.some(e=>e.kind==='task.claimed'));
  const now=x.store.get('tasks',x.kickoff.id);
  const base={project_id:x.project.id,task_id:now.id,baseline_revision:1,expected_revision:now.revision};
  await assert.rejects(()=>second.tool('task.claim',{...base,idempotency_key:key('unsafeResume')}),
    {code:'RECONCILIATION_REQUIRED'});
  const recovered=await second.tool('task.claim',{...base,recovery_checked:true,
    recovery_note:'Confirmed no external deployment or side effects before recovery',
    idempotency_key:key('safeResume')});
  assert.equal(recovered.task.lease.generation,2);
  assert.notEqual(recovered.lease_token,claim.lease_token);
  await assert.rejects(()=>second.tool('task.transition',{task_id:now.id,status:'submitted',
    lease_token:claim.lease_token,expected_revision:recovered.task.revision,idempotency_key:key('staleWorker')}),
    {code:'LEASE_INVALID'});
  await second.tool('task.release',{task_id:now.id,lease_token:recovered.lease_token,
    expected_revision:recovered.task.revision,idempotency_key:key('release')});
  const after=x.store.get('tasks',now.id);assert.equal(after.lease,null);
  assert.equal(after.status,'open');
  const cursor=await second.tool('project.watch_changes',{project_id:x.project.id,cursor:changes.next_cursor});
  assert.ok(cursor.events.some(e=>e.kind==='task.released'));
 }finally{if(first)await first.stop(true);if(second)await second.stop();x.close();}
});
test('stale baseline and unmet dependencies block task claims even with an active project',()=>{
 const x=harness();try{
  const dep=x.service.tool('task.upsert',{project_id:x.project.id,milestone_id:x.milestone.id,
    title:'First prerequisite',idempotency_key:key('dep')});
  const candidate=x.service.tool('task.upsert',{project_id:x.project.id,milestone_id:x.milestone.id,
    title:'Requires prior work',dependencies:[dep.id],idempotency_key:key('candidate')});
  assert.throws(()=>x.service.tool('task.claim',{project_id:x.project.id,task_id:candidate.id,
    expected_revision:candidate.revision,idempotency_key:key('invalidDependency')}),{code:'DEPENDENCY_UNMET'});
  x.service.ownerDecision(x.project.id,{action:'revise_baseline',reason:'New user acceptance criteria after review',
    criteria:['Revised core flow passes verification']});
  const old=x.store.get('tasks',x.kickoff.id);
  assert.throws(()=>x.service.tool('task.claim',{project_id:x.project.id,task_id:old.id,
    baseline_revision:1,expected_revision:old.revision,idempotency_key:key('invalidBaseline')}),{code:'BASELINE_STALE'});
 }finally{x.close();}
});
