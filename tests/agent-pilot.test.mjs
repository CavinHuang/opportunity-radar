import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {parseArgs,checkEndpoint,agentApi,inspectWorkspace,validateSubmission,sanitizedEnv,
 formatAgentPrompt,getReadyWork,executePilot,submitPilot,commandFor} from '../src/agent-pilot.mjs';
const cmd=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
function fixture(){
 const path=mkdtempSync(join(tmpdir(),'radar-cli-v13-'));
 cmd(path,'init','-b','feat/prototype');
 cmd(path,'config','user.email','ci@example.test');
 cmd(path,'config','user.name','Radar Test');
 writeFileSync(join(path,'README.md'),'isolated test repository\n');
 cmd(path,'add','README.md');cmd(path,'commit','-m','initial fixture');
 cmd(path,'remote','add','origin','https://github.com/sample/repo.git');
 const db=openDatabase(),service=createService(db);
 const opp=service.createOpportunity({title:'Small consumer product',problem:'Time-consuming recurring task',market:'International'});
 const project=service.startExperiment({opportunityId:opp.id,goal:'Implement a working customer journey',
  hypothesis:'A customer may want a faster workflow',criteria:['Core feature is testable'],stopCondition:'Stop if tests fail'});
 const kickoff=service.prepareKickoff(project.id).task;
 const call=async(name,args)=>service.tool(name,args);
 return {path,db,service,project,kickoff,call,
  cleanup(){db.close();rmSync(path,{recursive:true,force:true});}};
}
test('CLI parsing rejects unexpected arguments and remote endpoints',()=>{
 assert.deepEqual(parseArgs(['doctor','--project','P','--workspace','/tmp/x']),{action:'doctor',project:'P',workspace:'/tmp/x'});
 assert.throws(()=>parseArgs(['run','--project','x',';rm -rf']),{code:'BAD_ARGUMENT'});
 assert.throws(()=>parseArgs(['run','--project','x','--project','y']),{code:'BAD_ARGUMENT'});
 assert.equal(checkEndpoint('http://127.0.0.1:4177'),'http://127.0.0.1:4177');
 assert.throws(()=>checkEndpoint('https://fake.example.org'),{code:'BAD_ENDPOINT'});
 assert.throws(()=>checkEndpoint('http://127.0.0.1:4177/?access=abc'),{code:'BAD_ENDPOINT'});
});
test('Agent token is mandatory and child environment excludes Radar secrets',()=>{
 assert.throws(()=>agentApi({baseUrl:'http://localhost:4177',token:''}),{code:'BAD_ARGUMENT'});
 const env=sanitizedEnv({PATH:'/bin',RADAR_OWNER_TOKEN:'owner-secret',RADAR_AGENT_TOKEN:'agent-secret',
  GITHUB_TOKEN:'repo-secret',GH_TOKEN:'gh-secret',OPENAI_API_KEY:'provider-auth'});
 assert.equal(env.PATH,'/bin');assert.equal(env.OPENAI_API_KEY,'provider-auth');
 assert.ok(!Object.hasOwn(env,'RADAR_AGENT_TOKEN'));
 assert.ok(!Object.hasOwn(env,'RADAR_OWNER_TOKEN'));
 assert.ok(!Object.hasOwn(env,'GITHUB_TOKEN'));
});
test('prepare is read only, scopes prompt to approved baseline',async()=>{
 const x=fixture();try{
  const initial=x.db.list('tasks').length;
  const ready=await getReadyWork(x.call,x.project.id,x.kickoff.id);
  assert.equal(x.db.list('tasks').length,initial);
  assert.equal(ready.task.id,x.kickoff.id);
  assert.match(ready.prompt,/Do not publish, push, open a PR/);
  assert.match(ready.prompt,/Core feature is testable/);
  assert.match(ready.prompt,/Approved baseline revision: 1/);
  assert.equal(commandFor('codex',x.path).args.at(-1),'-');
  assert.ok(commandFor('claude',x.path).args.includes('acceptEdits'));
 }finally{x.cleanup();}
});
test('worktree safety rejects main, dirty changes and repository mismatched submissions',()=>{
 const x=fixture();try{
  const info=inspectWorkspace(x.path);
  assert.equal(info.branch,'feat/prototype');
  const sha=info.head;
  assert.equal(validateSubmission({pr:'https://github.com/sample/repo/pull/7',sha,workspaceInfo:info}).repo,'sample/repo');
  assert.throws(()=>validateSubmission({pr:'https://github.com/evil/repo/pull/7',sha,workspaceInfo:info}),{code:'REPO_MISMATCH'});
  assert.throws(()=>validateSubmission({pr:'https://github.com/sample/repo/pull/7',sha:'a'.repeat(40),workspaceInfo:info}),{code:'SHA_MISMATCH'});
  writeFileSync(join(x.path,'DRAFT.txt'),'unsaved');
  assert.throws(()=>inspectWorkspace(x.path),{code:'DIRTY_WORKTREE'});
  rmSync(join(x.path,'DRAFT.txt'));
  cmd(x.path,'branch','-m','main');
  assert.throws(()=>inspectWorkspace(x.path),{code:'UNSAFE_BRANCH'});
 }finally{x.cleanup();}
});
test('external coding subprocess can run without Radar token and never auto-submit',async()=>{
 const x=fixture();try{
  await assert.rejects(()=>executePilot({call:x.call,projectId:x.project.id,workspace:x.path,provider:'codex'}),{code:'CONFIRM_REQUIRED'});
  const marker=join(tmpdir(),'pilot-marker-'+x.project.id+'.json');
  const fakeCode="let prompt='';process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',()=>require('node:fs').writeFileSync(process.argv[1],JSON.stringify({hasPrompt:prompt.includes('Core feature is testable'),bearer:process.env.RADAR_AGENT_TOKEN||null,owner:process.env.RADAR_OWNER_TOKEN||null})));";
  const spawnImpl=(_exe,_args,options)=>spawn(process.execPath,['-e',fakeCode,marker],options);
  const result=await executePilot({call:x.call,projectId:x.project.id,taskId:x.kickoff.id,
   workspace:x.path,provider:'codex',confirmed:true,spawnImpl,renewIntervalMs:1000});
  assert.equal(result.exitCode,0);assert.equal(result.submitted,false);
  const ran=JSON.parse(readFileSync(marker,'utf8'));
  assert.equal(ran.hasPrompt,true);assert.equal(ran.bearer,null);assert.equal(ran.owner,null);
  const current=x.service.getFullProject(x.project.id);
  assert.equal(current.submissions.length,0);
  assert.equal(current.tasks.find(t=>t.id===x.kickoff.id).lease,null);
  assert.equal(current.tasks.find(t=>t.id===x.kickoff.id).status,'open');
  rmSync(marker);
 }finally{x.cleanup();}
});
test('explicit submit records unverified PR and G4 pending, never fake success',async()=>{
 const x=fixture();try{
  writeFileSync(join(x.path,'README.md'),'test prototype code implemented\n');
  cmd(x.path,'add','README.md');cmd(x.path,'commit','-m','feat: prototype core flow');
  const sha=cmd(x.path,'rev-parse','HEAD');
  await assert.rejects(()=>submitPilot({call:x.call,projectId:x.project.id,taskId:x.kickoff.id,
   workspace:x.path,pr:'https://github.com/sample/repo/pull/7',sha}),{code:'CONFIRM_REQUIRED'});
  const result=await submitPilot({call:x.call,projectId:x.project.id,taskId:x.kickoff.id,
   workspace:x.path,pr:'https://github.com/sample/repo/pull/7',sha,confirmed:true});
  assert.equal(result.commitSha,sha);
  assert.equal(result.verificationState,'pending');
  assert.equal(result.acceptanceState,'pending');
  assert.equal(result.ownerMustVerify,true);
  const current=x.service.getFullProject(x.project.id);
  assert.equal(current.submissions.length,1);
  assert.equal(current.tasks.find(t=>t.id===x.kickoff.id).status,'submitted');
  assert.equal(current.evidence[0].verificationState,'pending');
  assert.throws(()=>x.service.ownerDecision(x.project.id,{action:'accept',submissionId:result.submissionId,reason:'I trust the Agent'}),{code:'EVIDENCE_NOT_VERIFIED'});
 }finally{x.cleanup();}
});
test('agent API sends exact bearer without leaking and refuses invalid replies',async()=>{
 let observed=null;
 const call=agentApi({baseUrl:'http://localhost:4177',token:'test-token',fetchImpl:async(url,options)=>{
  observed={url,headers:options.headers,body:JSON.parse(options.body)};
  return {ok:true,status:200,json:async()=>({result:{status:'ok'}})};
 }});
 assert.deepEqual(await call('project.get_context',{project_id:'p'}),{status:'ok'});
 assert.equal(observed.url,'http://localhost:4177/api/agent/tools/project.get_context');
 assert.equal(observed.headers.Authorization,'Bearer test-token');
 assert.deepEqual(observed.body,{project_id:'p'});
});
