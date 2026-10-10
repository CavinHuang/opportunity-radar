import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'radar-http-test-'));
process.env.RADAR_DB=join(directory,'test.sqlite');
process.env.RADAR_AGENT_TOKEN='test-agent-token';
process.env.RADAR_OWNER_TOKEN='test-owner-token';
const {createServer}=await import('../src/server.mjs');
test('HTTP contract enforces role separation and end-to-end workflow',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'},agent={'Content-Type':'application/json','Authorization':'Bearer test-agent-token'};
 const call=async(path,method='GET',body,headers=owner)=>{const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await call('/api/dashboard','GET',undefined,{})).status,401);
  assert.equal((await call('/api/agent/tools','GET',undefined,owner)).status,401);
  let toolListing=await call('/api/agent/tools','GET',undefined,agent);assert.equal(toolListing.data.tools.length,12);
  let opp=await call('/api/opportunities','POST',{title:'Household photo frustration',problem:'manual cleanup for consumers',market:'China',sources:[{url:'https://example.com/discussion'}]});assert.equal(opp.status,201);const oid=opp.data.item.id;
  let start=await call('/api/experiments','POST',{opportunityId:oid,goal:'validate real need',hypothesis:'consumers want sorting',criteria:['prototype processes user-selected photos'],stopCondition:'stop after 10 hours'});assert.equal(start.status,201);const pid=start.data.project.id;
  const p=(await call('/api/projects/'+pid)).data;assert.equal(p.milestones.length,3);assert.equal(p.baselines[0].revision,1);
  const context=await call('/api/agent/tools/project.get_context','POST',{project_id:pid},agent);assert.equal(context.status,200);assert.equal(context.data.result.baseline.goal,'validate real need');assert.equal(context.data.result.project.ledger,undefined);
  const task=await call('/api/agent/tools/task.upsert','POST',{project_id:pid,milestone_id:p.milestones[1].id,title:'Implement usable prototype',idempotency_key:'int-task-1'},agent);assert.equal(task.status,200);
  const claim=await call('/api/agent/tools/task.claim','POST',{project_id:pid,task_id:task.data.result.id,idempotency_key:'int-claim-1'},agent);assert.equal(claim.status,200);
  const report=await call('/api/agent/tools/progress.report','POST',{project_id:pid,summary:'Working on prototype',idempotency_key:'int-report-1'},agent);assert.equal(report.status,200);
  const githubEvidence=await call('/api/agent/tools/evidence.attach','POST',{project_id:pid,milestone_id:p.milestones[1].id,type:'github_pr',source_uri:'https://github.com/a/b/pull/1',commit_sha:'a'.repeat(40),criteria_ids:p.baselines[0].criteria.map(c=>c.id),idempotency_key:'http-gh-evidence'},agent);
  assert.equal(githubEvidence.status,200);
  const bypass=await call('/api/projects/'+pid+'/evidence/'+githubEvidence.data.result.id+'/attest','POST',{reason:'Manually approved without GitHub CI'});
  assert.equal(bypass.status,409);assert.equal(bypass.data.error,'GITHUB_AUTOMATED_CHECK_REQUIRED');
  const decision=await call('/api/agent/tools/decision.request','POST',{project_id:pid,kind:'scope_change',summary:'Need a larger scope',idempotency_key:'int-request-1'},agent);assert.equal(decision.data.result.status,'pending');
  assert.equal((await call('/api/projects/'+pid)).data.baselines.length,1);
  const pause=await call('/api/projects/'+pid+'/decide','POST',{action:'pause',reason:'budget check'});assert.equal(pause.status,200);
  const blocked=await call('/api/agent/tools/task.upsert','POST',{project_id:pid,milestone_id:p.milestones[1].id,title:'Should fail',idempotency_key:'paused-task'},agent);assert.equal(blocked.status,409);
  const home=await fetch(base+'/');assert.equal(home.status,200);assert.ok((await home.text()).includes('northstar')===false); // title is Northstar; UI mount root is static
  const staticJs=await fetch(base+'/app.js');assert.equal(staticJs.status,200);assert.ok((await staticJs.text()).includes('机会简报'));
 }finally{await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
});
