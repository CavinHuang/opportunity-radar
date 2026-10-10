import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const folder=mkdtempSync(join(tmpdir(),'radar-pilot-http-'));
process.env.RADAR_DB=join(folder,'app.sqlite');
process.env.RADAR_AGENT_TOKEN='pilot-transport-secret';
process.env.RADAR_OWNER_TOKEN='pilot-owner-secret';
const {createServer}=await import('../src/server.mjs');
const {agentApi,submitPilot,statusPilot}=await import('../src/agent-pilot.mjs');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();

test('real HTTP Agent transport: owner approval → kickoff → exact PR handoff → pending G4',async()=>{
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const ownerHeaders={'Content-Type':'application/json','X-Radar-Owner-Key':'pilot-owner-secret'};
 const owner=async(url,method='GET',data,headers=ownerHeaders)=>{
   const response=await fetch(base+url,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
   return {status:response.status,data:await response.json()};
 };
 const workspace=join(folder,'target');
 const {mkdirSync}=await import('node:fs');mkdirSync(workspace);
 try{
   const opp=await owner('/api/opportunities','POST',{
     title:'Practical user prototype',problem:'Consumers repeatedly perform manual work',market:'International'});
   assert.equal(opp.status,201);
   const project=await owner('/api/experiments','POST',{
     opportunityId:opp.data.item.id,goal:'Deliver minimum useful flow',
     hypothesis:'A simpler flow could reduce manual work',criteria:['Core flow is usable'],
     stopCondition:'Stop when objective product test fails'});
   assert.equal(project.status,201);
   const id=project.data.project.id;
   const kickoff=await owner('/api/projects/'+id+'/kickoff','POST',{});
   assert.equal(kickoff.status,200);
   const task=kickoff.data.task;
   assert.equal((await owner('/api/projects/'+id+'/kickoff','POST',{},{})).status,401);
   git(workspace,'init','-b','feat/test-http');
   git(workspace,'config','user.email','pilot@example.test');
   git(workspace,'config','user.name','Radar Pilot');
   git(workspace,'remote','add','origin','https://github.com/sample/repo.git');
   writeFileSync(join(workspace,'README.md'),'Isolated HTTP integration test code only\n');
   git(workspace,'add','README.md');
   git(workspace,'commit','-m','test: isolated transport delivery');
   const sha=git(workspace,'rev-parse','HEAD');
   const call=agentApi({baseUrl:base,token:'pilot-transport-secret'});
   const readOnly=await statusPilot({call,projectId:id});
   assert.equal(readOnly.tasks[0].id,task.id);
   const unauthorized=agentApi({baseUrl:base,token:'invalid'});
   await assert.rejects(()=>unauthorized('project.get_context',{project_id:id}),{code:'UNAUTHORIZED'});
   const params={call,projectId:id,taskId:task.id,workspace,
     pr:'https://github.com/sample/repo/pull/9',sha,confirmed:true,
     fetchImpl:async()=>({ok:true,status:200,json:async()=>({
       base:{repo:{full_name:'sample/repo'}},head:{sha}
     })})};
   const first=await submitPilot(params);
   assert.equal(first.verificationState,'pending');
   assert.equal(first.acceptanceState,'pending');
   const again=await submitPilot(params);
   assert.equal(again.alreadySubmitted,true);
   assert.equal(again.submissionId,first.submissionId);
   const full=await owner('/api/projects/'+id);
   assert.equal(full.data.submissions.length,1);
   assert.equal(full.data.evidence.length,1);
   assert.equal(full.data.tasks.find(t=>t.id===task.id).lease,null);
   const denied=await owner('/api/projects/'+id+'/decide','POST',{
     action:'accept',submissionId:first.submissionId,reason:'Agent output alone is not enough'});
   assert.equal(denied.status,409);
   assert.ok(['EVIDENCE_NOT_VERIFIED','GITHUB_G1_REQUIRED'].includes(denied.data.error));
 }finally{
   await new Promise(resolve=>server.close(resolve));
   rmSync(folder,{recursive:true,force:true});
 }
});
