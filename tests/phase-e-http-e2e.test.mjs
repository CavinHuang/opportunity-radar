// Phase E end-to-end regression over real HTTP: a complete real business loop
// (signal → opportunity → validation → approved experiment → agent delivery →
// rejection/rework → verified CI → G4 acceptance → owner-recorded feedback),
// plus restart persistence, interrupted-lease recovery, concurrent idempotent
// submissions, and request resource boundaries. GitHub CI answers are mocked at
// the network boundary; everything else is the real server + SQLite.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const folder=mkdtempSync(join(tmpdir(),'radar-phase-e-'));
const dbFile=join(folder,'app.sqlite');
process.env.RADAR_DB=dbFile;
process.env.RADAR_AGENT_TOKEN='phase-e-agent-secret';
process.env.RADAR_OWNER_TOKEN='phase-e-owner-secret';
process.env.RADAR_REQUIRED_CHECKS='test';
const serverModuleUrl=pathToFileURL(join(process.cwd(),'src','server.mjs'));
const modA=await import(serverModuleUrl.href);
let modB=null;

const sha='e'.repeat(40);
function listen(server){return new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));}
function client(base,{owner='phase-e-owner-secret',agentToken='phase-e-agent-secret'}={}){
  const ownerHeaders={'Content-Type':'application/json','X-Radar-Owner-Key':owner};
  const agentHeaders={'Content-Type':'application/json',Authorization:`Bearer ${agentToken}`};
  return {
    owner:async(path,method='GET',body,headers=ownerHeaders)=>{
      const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
      let data=null;try{data=await r.json();}catch{data=null;}
      return {status:r.status,data};
    },
    agent:async(path,body,token=agentToken)=>{
      const r=await fetch(base+path,{method:'POST',headers:{...agentHeaders,Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
      let data=null;try{data=await r.json();}catch{data=null;}
      return {status:r.status,data};
    },
    raw:async(path,{method='GET',headers={},body}={})=>{
      const r=await fetch(base+path,{method,headers,body});
      let data=null;try{data=await r.json();}catch{data=null;}
      return {status:r.status,data};
    }
  };
}

test('real business loop over HTTP: validation-gated approval → agent delivery → rework → verified CI → G4 acceptance, with concurrency and boundary regressions',async()=>{
  const server=modA.createServer();
  await listen(server);
  const base='http://127.0.0.1:'+server.address().port;
  const http=client(base);
  try{
    // ---- Resource boundaries and auth surface ----
    const badJson=await http.raw('/api/opportunities',{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'phase-e-owner-secret'},body:'{"title":'});
    assert.equal(badJson.status,400);
    assert.equal(badJson.data.error,'BAD_JSON');
    const huge='x'.repeat(301*1024);
    const tooLarge=await http.raw('/api/opportunities',{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'phase-e-owner-secret'},body:JSON.stringify({title:huge,problem:'p',market:'m'})});
    assert.equal(tooLarge.status,413);
    assert.equal(tooLarge.data.error,'PAYLOAD_TOO_LARGE');
    const originAttack=await http.raw('/api/opportunities',{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'phase-e-owner-secret',Origin:'https://evil.example'},body:'{}'});
    assert.equal(originAttack.status,403);
    assert.equal(originAttack.data.error,'ORIGIN_DENIED');
    assert.equal((await http.owner('/api/opportunities','GET',undefined,{'Content-Type':'application/json','X-Radar-Owner-Key':'wrong-token'})).status,401);
    assert.equal((await http.agent('/api/agent/tools/project.get_context',{project_id:'x'},'bad-token')).status,401);
    assert.equal((await http.raw('/api/signals/scan',{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'phase-e-owner-secret'},body:JSON.stringify({source_id:123})})).status,400);
    assert.equal((await http.raw('/api/sources/diagnostics?limit=99',{headers:{'X-Radar-Owner-Key':'phase-e-owner-secret'}})).status,400);
    assert.equal((await http.raw('/api/signals?offset=-5',{headers:{'X-Radar-Owner-Key':'phase-e-owner-secret'}})).status,400);

    // ---- Real business chain starts: research before approval ----
    const opp=await http.owner('/api/opportunities','POST',{
      title:'Phase E regression opportunity',problem:'Consumers repeat a manual filing task',
      market:'International',sources:[{url:'https://consumer.example.org/thread/phase-e',quote:'[TEST FIXTURE] recurring manual work'}]});
    assert.equal(opp.status,201);
    const oid=opp.data.item.id;
    const plan=await http.owner('/api/opportunities/'+oid+'/validation','POST',{
      audience:'Adults doing the manual task',hypothesis:'A cheaper flow would be adopted',
      researchQuestion:'Describe the last time the task failed?',channel:'Opt-in community volunteers',
      successCriterion:'Two independent users describe recent failures',stopCondition:'Stop after 6 hours without evidence',
      nextAction:'Interview three volunteers',timeBudgetHours:5,cashBudget:0});
    assert.equal(plan.status,201);
    const planId=plan.data.item.id;
    const noConsent=await http.owner('/api/opportunities/'+oid+'/validation/'+planId+'/observations','POST',
      {participantRef:'u-01',kind:'interview',stance:'supports',note:'[TEST FIXTURE] would use it',consentConfirmed:false});
    assert.equal(noConsent.status,409);
    const observation=await http.owner('/api/opportunities/'+oid+'/validation/'+planId+'/observations','POST',
      {participantRef:'u-01',kind:'interview',stance:'supports',note:'[TEST FIXTURE] described the failure twice with detail',consentConfirmed:true});
    assert.equal(observation.status,201);
    const closed=await http.owner('/api/opportunities/'+oid+'/validation/'+planId+'/close','POST',
      {outcome:'continue',reason:'[TEST FIXTURE] two supporting observations, still owner-recorded',expected_revision:plan.data.item.revision,acknowledgeUncertainty:true});
    assert.equal(closed.status,200);

    // ---- Owner approval links the research decision ----
    const started=await http.owner('/api/experiments','POST',{
      opportunityId:oid,validationPlanId:planId,goal:'Deliver one usable flow',
      hypothesis:'The flow reduces the manual task',criteria:['Core flow finishes without help'],
      stopCondition:'Stop after the 10 hour baseline'});
    assert.equal(started.status,201);
    const pid=started.data.project.id;
    assert.equal(started.data.project.researchBasis.status,'linked_owner_decision');
    const secondApproval=await http.owner('/api/experiments','POST',{opportunityId:oid,goal:'x',hypothesis:'y',criteria:['z'],stopCondition:'s'});
    assert.equal(secondApproval.status,409);

    // ---- Owner kickoff, agent execution with idempotency semantics ----
    const kickoff=await http.owner('/api/projects/'+pid+'/kickoff','POST',{});
    assert.equal(kickoff.status,200);
    const taskId=kickoff.data.task.id;
    const claimArgs={project_id:pid,task_id:taskId,baseline_revision:1,expected_revision:kickoff.data.task.revision,idempotency_key:'phase-e-claim-1'};
    const claim=await http.agent('/api/agent/tools/task.claim',claimArgs);
    assert.equal(claim.status,200);
    const leaseToken=claim.data.result.lease_token;
    const replay=await http.agent('/api/agent/tools/task.claim',claimArgs);
    assert.equal(replay.status,200);
    assert.equal(replay.data.result.lease_token,leaseToken);
    const conflict=await http.agent('/api/agent/tools/task.claim',{...claimArgs,baseline_revision:2});
    assert.equal(conflict.status,409);
    assert.equal(conflict.data.error,'IDEMPOTENCY_CONFLICT');
    const stolen=await http.agent('/api/agent/tools/task.claim',{project_id:pid,task_id:taskId,baseline_revision:1,idempotency_key:'phase-e-claim-2',lease_token:'not-the-holder'});
    assert.equal(stolen.status,409);
    assert.equal(stolen.data.error,'TASK_CLAIMED');
    assert.equal((await http.agent('/api/agent/tools/progress.report',{project_id:pid,summary:'[TEST FIXTURE] working on the core flow',idempotency_key:'phase-e-report-1'})).status,200);
    // The agent formally reports the task as submitted before handing off.
    const claimedState=await http.owner('/api/projects/'+pid);
    const claimedTask=claimedState.data.tasks.find(t=>t.id===taskId);
    const transition=await http.agent('/api/agent/tools/task.transition',{
      task_id:taskId,status:'submitted',expected_revision:claimedTask.revision,lease_token:leaseToken,idempotency_key:'phase-e-transition-1'});
    assert.equal(transition.status,200);

    // ---- Concurrent identical submissions: one write, both succeed ----
    const projectBefore=await http.owner('/api/projects/'+pid);
    const milestoneId=projectBefore.data.milestones[1].id;
    const parallel=await Promise.all([
      http.agent('/api/agent/tools/task.upsert',{project_id:pid,milestone_id:milestoneId,title:'Break down the core flow',idempotency_key:'phase-e-parallel-upsert'}),
      http.agent('/api/agent/tools/task.upsert',{project_id:pid,milestone_id:milestoneId,title:'Break down the core flow',idempotency_key:'phase-e-parallel-upsert'})
    ]);
    assert.deepEqual(parallel.map(r=>r.status),[200,200]);
    assert.equal(parallel[0].data.result.id,parallel[1].data.result.id);
    const afterParallel=await http.owner('/api/projects/'+pid);
    assert.equal(afterParallel.data.tasks.filter(t=>t.title==='Break down the core flow').length,1);

    // ---- Delivery, G1 gate, rejection and rework ----
    const evidence=await http.agent('/api/agent/tools/evidence.attach',{
      project_id:pid,milestone_id:milestoneId,type:'github_pr',
      source_uri:'https://github.com/sample/repo/pull/7',commit_sha:sha,
      criteria_ids:started.data.project.baselines[0].criteria.map(c=>c.id),idempotency_key:'phase-e-evidence-1'});
    assert.equal(evidence.status,200);
    const evidenceId=evidence.data.result.id;
    const submit=await http.agent('/api/agent/tools/handoff.submit',{
      project_id:pid,milestone_id:milestoneId,baseline_revision:1,commit_sha:sha,
      evidence_ids:[evidenceId],idempotency_key:'phase-e-submit-1'});
    assert.equal(submit.status,200);
    const submissionId=submit.data.result.id;
    const prematureAccept=await http.owner('/api/projects/'+pid+'/decide','POST',
      {action:'accept',submissionId,reason:'[TEST FIXTURE] trying to accept unverified CI evidence'});
    assert.equal(prematureAccept.status,409);
    assert.equal(prematureAccept.data.error,'EVIDENCE_NOT_VERIFIED');
    const rejected=await http.owner('/api/projects/'+pid+'/decide','POST',
      {action:'reject',submissionId,reason:'[TEST FIXTURE] prototype misses the second acceptance flow'});
    assert.equal(rejected.status,200);
    let state=await http.owner('/api/projects/'+pid);
    assert.equal(state.data.submissions[0].acceptanceState,'rejected');
    const reworkTask=state.data.tasks.find(t=>t.id===taskId);
    assert.equal(reworkTask.status,'rework');
    assert.equal(reworkTask.lease,null);
    const decideTwice=await http.owner('/api/projects/'+pid+'/decide','POST',
      {action:'reject',submissionId,reason:'[TEST FIXTURE] deciding an already-processed submission'});
    assert.equal(decideTwice.status,409);
    const reclaim=await http.agent('/api/agent/tools/task.claim',{
      project_id:pid,task_id:taskId,baseline_revision:1,expected_revision:reworkTask.revision,idempotency_key:'phase-e-claim-rework'});
    assert.equal(reclaim.status,200);
    assert.notEqual(reclaim.data.result.lease_token,leaseToken);

    // ---- Real GitHub verification through the HTTP verify endpoint ----
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(url,opts)=>{
      if(String(url).startsWith('https://api.github.com/')){
        const json=String(url).includes('/pulls/')?{head:{sha}}
          :String(url).includes('/check-runs')?{total_count:1,check_runs:[{id:1,name:'test',head_sha:sha,status:'completed',conclusion:'success',started_at:'2026-10-11T00:00:00Z',html_url:'https://github.com/sample/repo/actions/run/1'}]}
          :{sha};
        return {ok:true,status:200,json:async()=>json};
      }
      return originalFetch(url,opts);
    };
    let verified;
    try{verified=await http.owner('/api/projects/'+pid+'/evidence/'+evidenceId+'/verify','POST',{});}
    finally{globalThis.fetch=originalFetch;}
    assert.equal(verified.status,200);
    assert.equal(verified.data.item.verificationState,'verified');
    assert.equal(verified.data.item.checks[0].name,'test');

    // Resubmission after rework, then formal acceptance (G4).
    const resubmit=await http.agent('/api/agent/tools/handoff.submit',{
      project_id:pid,milestone_id:milestoneId,baseline_revision:1,commit_sha:sha,
      evidence_ids:[evidenceId],idempotency_key:'phase-e-submit-2'});
    assert.equal(resubmit.status,200);
    // The first submission was already rejected: deciding it again is a bad state,
    // and the newest submission is the only one that can be accepted.
    const superseded=await http.owner('/api/projects/'+pid+'/decide','POST',
      {action:'accept',submissionId,reason:'[TEST FIXTURE] stale first submission'});
    assert.equal(superseded.status,409);
    assert.equal(superseded.data.error,'BAD_STATE');
    const accepted=await http.owner('/api/projects/'+pid+'/decide','POST',
      {action:'accept',submissionId:resubmit.data.result.id,reason:'[TEST FIXTURE] verified CI and manually operated prototype'});
    assert.equal(accepted.status,200);
    state=await http.owner('/api/projects/'+pid);
    assert.equal(state.data.milestones.find(m=>m.order===2).acceptanceState,'accepted');
    assert.equal(state.data.project?state.data.project.status:state.data.status,'promotion');
    // G4 unlocks owner-recorded post-delivery feedback.
    const feedback=await http.owner('/api/projects/'+pid+'/feedback','POST',
      {participantRef:'u-09',kind:'activation',summary:'[TEST FIXTURE] completed the core task once',consentConfirmed:true});
    assert.equal(feedback.status,201);
    // Growth history limit boundary on a real project.
    assert.equal((await http.raw('/api/projects/'+pid+'/growth/history?limit=0',{headers:{'X-Radar-Owner-Key':'phase-e-owner-secret'}})).status,400);
  }finally{
    server.closeAllConnections?.();
    await new Promise(r=>server.close(r));
  }
});

// Must run last: it closes the first module store and re-opens the database
// through a second module instance, simulating a full process restart.
test('unexpected restart keeps committed data, leases and recovery obligations; backup→restore reopens as a fresh process',async()=>{
  const serverA=modA.createServer();
  await listen(serverA);
  const baseA='http://127.0.0.1:'+serverA.address().port;
  const httpA=client(baseA);
  // Only one main experiment may run at a time: formally stop the previous test's
  // project first, the way a real owner closes a cycle before starting another.
  const dashboard=await httpA.owner('/api/dashboard');
  const previous=dashboard.data.active;
  if(previous)assert.equal((await httpA.owner('/api/projects/'+previous.id+'/decide','POST',{action:'stop',reason:'[TEST FIXTURE] cycle closed before the restart regression'})).status,200);
  const opp=await httpA.owner('/api/opportunities','POST',{title:'Restart persistence check',problem:' survives process restarts',market:'中国大陆'});
  assert.equal(opp.status,201);
  const started=await httpA.owner('/api/experiments','POST',{opportunityId:opp.data.item.id,goal:'restart-safe delivery',hypothesis:'state survives restarts',criteria:['state survives restarts'],stopCondition:'stop when restart loses state'});
  assert.equal(started.status,201);
  const pid=started.data.project.id;
  const kickoff=await httpA.owner('/api/projects/'+pid+'/kickoff','POST',{});
  const taskId=kickoff.data.task.id;
  const claim=await httpA.agent('/api/agent/tools/task.claim',{project_id:pid,task_id:taskId,baseline_revision:1,expected_revision:kickoff.data.task.revision,idempotency_key:'phase-e-restart-claim'});
  assert.equal(claim.status,200);
  const leaseToken=claim.data.result.lease_token;
  // Stop the "process": server closed and the module-level SQLite handle released.
  serverA.closeAllConnections?.();
  await new Promise(r=>serverA.close(r));
  modA.closeStore();

  // A fresh OS process (the data CLI) can open the same file and see everything.
  const doctor=spawnSync(process.execPath,['src/data-cli.mjs','doctor','--db',dbFile],{cwd:process.cwd(),encoding:'utf8',timeout:20000});
  assert.equal(doctor.status,0,doctor.stderr);
  const report=JSON.parse(doctor.stdout);
  assert.ok(report.totalRecords>=3);
  assert.equal(report.schemaVersion,1);
  assert.ok(report.sqliteVersion);

  // The application restarts against the same database file.
  modB=await import(serverModuleUrl.href+'?phase-e-restart');
  const serverB=modB.createServer();
  await listen(serverB);
  const baseB='http://127.0.0.1:'+serverB.address().port;
  const httpB=client(baseB);
  try{
    const reloaded=await httpB.owner('/api/projects/'+pid);
    assert.equal(reloaded.status,200);
    assert.equal(reloaded.data.name,'Restart persistence check');
    const task=reloaded.data.tasks.find(t=>t.id===taskId);
    assert.equal(task.status,'in_progress');
    assert.equal(task.lease.token,leaseToken);
    // The lease issued before the restart still renews without a recovery note.
    const renew=await httpB.agent('/api/agent/tools/task.claim',{project_id:pid,task_id:taskId,baseline_revision:1,expected_revision:task.revision,lease_token:leaseToken,idempotency_key:'phase-e-restart-renew'});
    assert.equal(renew.status,200);
    assert.equal(renew.data.result.renewed,true);
    assert.equal(renew.data.result.lease_token,leaseToken);
    // An interrupted (expired) lease becomes a recovery obligation, not silent takeover.
    const expiredAt=new Date(Date.now()-60_000).toISOString();
    const fresh=await httpB.owner('/api/projects/'+pid);
    const leasedTask=fresh.data.tasks.find(t=>t.id===taskId);
    // Expire the lease through a second SQLite connection, the way an external
    // process or time itself would leave it after an interruption.
    const {openDatabase:openForExpiry}=await import('../src/db.mjs');
    const expiryStore=openForExpiry(dbFile);
    try{
      expiryStore.put('tasks',{...expiryStore.get('tasks',taskId),lease:{...leasedTask.lease,expiresAt:expiredAt}},leasedTask.revision);
    }finally{expiryStore.close();}
    const unreconciled=await httpB.agent('/api/agent/tools/task.claim',{project_id:pid,task_id:taskId,baseline_revision:1,expected_revision:leasedTask.revision+1,idempotency_key:'phase-e-restart-takeover'});
    assert.equal(unreconciled.status,409);
    assert.equal(unreconciled.data.error,'RECONCILIATION_REQUIRED');
    const afterExpiry=await httpB.owner('/api/projects/'+pid);
    const expiredTask=afterExpiry.data.tasks.find(t=>t.id===taskId);
    const takeover=await httpB.agent('/api/agent/tools/task.claim',{project_id:pid,task_id:taskId,baseline_revision:1,expected_revision:expiredTask.revision,recovery_checked:true,recovery_note:'[TEST FIXTURE] checked the external process is gone',idempotency_key:'phase-e-restart-takeover-2'});
    assert.equal(takeover.status,200);
    assert.notEqual(takeover.data.result.lease_token,leaseToken);
  }finally{
    serverB.closeAllConnections?.();
    await new Promise(r=>serverB.close(r));
    modB.closeStore();
  }

  // Offline recovery: verified backup restores to a NEW path and reopens cleanly.
  const {backupDatabase,restoreDatabase}=await import('../src/data-safety.mjs');
  const {openDatabase}=await import('../src/db.mjs');
  const backup=join(folder,'recovery.sqlite'),restored=join(folder,'recovered.sqlite');
  backupDatabase({database:dbFile,output:backup});
  restoreDatabase({input:backup,destination:restored,confirmed:true});
  const store=openDatabase(restored);
  try{
    assert.equal(store.schema.applied.length,0);
    const opportunity=store.list('opportunities').find(x=>x.id===opp.data.item.id);
    assert.equal(opportunity.title,'Restart persistence check');
    const task=store.get('tasks',taskId);
    assert.equal(task.status,'in_progress');
    assert.ok(task.lease);
  }finally{store.close();}
});

after(()=>{modA.closeStore();modB?.closeStore();rmSync(folder,{recursive:true,force:true});});
