import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const fail=(code,message)=>Object.assign(new Error(message),{code});
const uuid=()=>randomUUID();
export const supportedProviders=['codex','claude'];
const shaRegex=/^[a-f0-9]{40}$/i;
function required(value,key){if(typeof value!=='string'||!value.trim())throw fail('BAD_ARGUMENT',key+' is required');return value.trim();}
export function parseArgs(argv){
 const [action,...rest]=argv;
 if(!['doctor','plan','run','submit'].includes(action))throw fail('BAD_COMMAND','Use doctor, plan, run or submit');
 const config={action};
 const fields=new Set(['project','task','workspace','provider','base-url','pr','sha','confirm','json','help']);
 for(let i=0;i<rest.length;i++){
  const entry=rest[i];if(!entry.startsWith('--'))throw fail('BAD_ARGUMENT','Unexpected argument: '+entry);
  const field=entry.slice(2);if(!fields.has(field)||Object.hasOwn(config,field))throw fail('BAD_ARGUMENT','Unknown or repeated argument: '+field);
  if(['confirm','json','help'].includes(field)){config[field]=true;continue;}
  config[field]=required(rest[++i],field);
 }
 return config;
}
export function checkEndpoint(value){
 const url=new URL(value||'http://127.0.0.1:4177');
 if(url.username||url.password||url.search||url.hash)throw fail('BAD_ENDPOINT','No embedded credentials, query or fragment allowed');
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw fail('BAD_ENDPOINT','Pilot only accepts loopback HTTP; use a local SSH tunnel for remote Radar');
 return url.origin;
}
export function agentApi({baseUrl,token,fetchImpl=fetch}){
 const origin=checkEndpoint(baseUrl);
 required(token,'RADAR_AGENT_TOKEN');
 return async(name,args)=>{
  const response=await fetchImpl(origin+'/api/agent/tools/'+name,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify(args),signal:AbortSignal.timeout(12000)
  });
  const output=await response.json().catch(()=>({}));
  if(!response.ok||output.error)throw fail(output.error||'RADAR_REQUEST_FAILED',output.message||name+' failed (HTTP '+response.status+')');
  return output.result;
 };
}
export function git(workspace,...args){
 return execFileSync('git',args,{cwd:workspace,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();
}
export function inspectWorkspace(dir,{gitImpl=git,requireClean=true}={}){
 const workspace=realpathSync(required(dir,'workspace'));
 if(!existsSync(workspace))throw fail('WORKSPACE_MISSING','Workspace not found');
 try{
  if(gitImpl(workspace,'rev-parse','--is-inside-work-tree')!=='true')throw Error('not a git worktree');
  const branch=gitImpl(workspace,'branch','--show-current');
  if(!branch||['main','master'].includes(branch))throw fail('UNSAFE_BRANCH','Use a dedicated feature branch, not main/master or detached HEAD');
  if(requireClean&&gitImpl(workspace,'status','--porcelain').trim())throw fail('DIRTY_WORKTREE','Commit/stash changes before launching Agent');
  const head=gitImpl(workspace,'rev-parse','HEAD');
  const origin=gitImpl(workspace,'remote','get-url','origin');
  return {workspace,branch,head,origin};
 }catch(error){if(error.code)throw error;throw fail('BAD_WORKSPACE','Workspace must be a Git repository with an origin remote: '+error.message);}
}
function canonicalGithubRepo(value){
 let match=/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(value);
 if(!match)match=/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(value);
 if(!match)match=/^ssh:\/\/git@github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(value);
 if(!match)throw fail('UNSUPPORTED_REMOTE','Only GitHub origin remotes are supported by v1.3');
 return match[1].toLowerCase();
}
export function validateSubmission({pr,sha,workspaceInfo}){
 if(!shaRegex.test(sha||''))throw fail('BAD_SHA','A full 40-character commit SHA is required');
 const match=/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?:\/)?$/.exec(pr||'');
 if(!match)throw fail('BAD_PR','Provide a canonical https://github.com/owner/repo/pull/N URL');
 const repo=match[1].toLowerCase();
 if(canonicalGithubRepo(workspaceInfo.origin)!==repo)throw fail('REPO_MISMATCH','GitHub PR repository does not match local origin');
 if(workspaceInfo.head.toLowerCase()!==sha.toLowerCase())throw fail('SHA_MISMATCH','Local Git HEAD does not match requested delivery SHA');
 return {repo,pr,sha:sha.toLowerCase()};
}
export function sanitizedEnv(source=process.env){
 const env={...source};
 for(const name of Object.keys(env))if(/^(RADAR_|GITHUB_TOKEN$|GH_TOKEN$|GIT_ASKPASS$|GIT_ASKPASS_USERNAME$|GIT_ASKPASS_PASSWORD$)/i.test(name))delete env[name];
 return env;
}
export function formatAgentPrompt({context,task}){
 const baseline=context.baseline;
 if(!baseline?.revision)throw fail('NO_BASELINE','No approved baseline');
 const criteria=(baseline.criteria||[]).map((c,i)=>(i+1)+'. '+c.text).join('\n');
 return [
  'You are working inside an Owner-approved product delivery task. Treat this message as the complete execution boundary.',
  'Project: '+context.project.name,
  'Project ID: '+context.project.id,
  'Task: '+task.title+' ('+task.id+')',
  'Approved baseline revision: '+baseline.revision,
  'Goal: '+baseline.goal,
  'Hypothesis (unverified until independently tested): '+baseline.hypothesis,
  'Allowed scope: '+(baseline.scope||'Only the approved goal and criteria'),
  'Explicit non-goals: '+(baseline.nonGoals||'No additions outside approved scope'),
  'Acceptance criteria:\n'+criteria,
  'Stop condition: '+baseline.stopCondition,
  'Research status: '+(context.researchBasis?.status||'unlinked')+'; '+(context.researchBasis?.warning||'Demand not independently verified'),
  'Execution task details:\n'+(task.description||'(none)'),
  'Implement and test the smallest change that satisfies the accepted requirements.',
  'Do not access Radar secrets, change Radar project approvals, claim interviews, or fabricate tests, metrics, PRs, or customer results.',
  'Do not publish, push, open a PR, or approve a delivery automatically. Leave changes in the current feature branch for human inspection.',
  'Finish with the actual commands run, test results, remaining gaps, and which files changed.'
 ].join('\n\n');
}
export async function getReadyWork(call,projectId,taskId){
 required(projectId,'project');
 const context=await call('project.get_context',{project_id:projectId});
 const next=await call('project.get_next_work',{project_id:projectId});
 const task=taskId?next.tasks.find(x=>x.id===taskId):next.tasks[0];
 if(!task)throw fail('NO_CLAIMABLE_WORK','No claimable task. Resolve dependencies, expired leases or Owner baseline changes first.');
 if(task.baselineRevision&&task.baselineRevision!==context.baseline.revision)throw fail('BASELINE_STALE','Task belongs to an older approved baseline');
 return {context,task,prompt:formatAgentPrompt({context,task})};
}
export function commandFor(provider,workspace){
 if(provider==='codex')return {command:'codex',args:['exec','--sandbox','workspace-write','--cd',workspace,'-'],viaStdin:true};
 if(provider==='claude')return {command:'claude',args:['-p','--permission-mode','acceptEdits'],viaStdin:true};
 throw fail('BAD_PROVIDER','Supported providers: '+supportedProviders.join(', '));
}
function childExit(child,prompt){
 return new Promise((ok,reject)=>{
  let finished=false;
  child.once('error',err=>{if(!finished){finished=true;reject(err);}});
  child.once('close',(code,signal)=>{if(!finished){finished=true;ok({code,signal});}});
  if(child.stdin){
   child.stdin.on('error',()=>{});child.stdin.end(prompt);
  }
 });
}
export async function executePilot({call,projectId,taskId,workspace,provider,confirmed=false,spawnImpl=spawn,gitImpl=git,renewIntervalMs=300000}){
 if(!confirmed)throw fail('CONFIRM_REQUIRED','Execution requires --confirm');
 const info=inspectWorkspace(workspace,{gitImpl});
 const {context,task,prompt}=await getReadyWork(call,projectId,taskId);
 const command=commandFor(provider,info.workspace);
 const claim=await call('task.claim',{project_id:projectId,task_id:task.id,baseline_revision:context.baseline.revision,
  expected_revision:task.revision,idempotency_key:uuid()});
 let latest=claim.task,token=claim.lease_token,renewalFailed=null,busy=false;
 let child,interval,exit,releaseError;
 try{
  child=spawnImpl(command.command,command.args,{cwd:info.workspace,env:sanitizedEnv(),stdio:['pipe','inherit','inherit'],shell:false});
  interval=setInterval(async()=>{
   if(busy)return;busy=true;
   try{
    const result=await call('task.claim',{project_id:projectId,task_id:task.id,baseline_revision:context.baseline.revision,
      expected_revision:latest.revision,lease_token:token,idempotency_key:uuid()});
    latest=result.task;token=result.lease_token;
   }catch(e){renewalFailed=e;child.kill('SIGTERM');}
   finally{busy=false;}
  },renewIntervalMs);
  exit=await childExit(child,prompt);
  if(renewalFailed)throw fail('LEASE_RENEWAL_FAILED','Cannot continue safely after lost lease: '+renewalFailed.message);
  const success=exit.code===0&&exit.signal===null;
  await call('progress.report',{project_id:projectId,summary:success
   ?provider+' local coding command exited 0; awaiting human review, a real PR and independently verified CI.'
   :provider+' local coding command failed/terminated; task not submitted.',
   limitations:['Local exit code does not prove a working product or passing CI.'],idempotency_key:uuid()});
  return {taskId:task.id,workspace:info.workspace,provider,exitCode:exit.code,signal:exit.signal,submitted:false,requiresHumanReview:true};
 }finally{
  if(interval)clearInterval(interval);
  if(child&&!exit)child.kill('SIGTERM');
  try{
   // Leave the task open for a later explicit submit; process success is not a delivery.
   const live=await call('project.get_context',{project_id:projectId});
   const current=live.project.tasks.find(x=>x.id===task.id);
   if(current?.lease?.token===token)await call('task.release',{task_id:task.id,lease_token:token,
     expected_revision:current.revision,idempotency_key:uuid()});
  }catch(e){releaseError=e;process.stderr.write('Lease release requires manual reconciliation: '+e.message+'\n');}
 }
}
export async function submitPilot({call,projectId,taskId,workspace,pr,sha,confirmed=false,gitImpl=git}){
 if(!confirmed)throw fail('CONFIRM_REQUIRED','Submission requires --confirm');
 const info=inspectWorkspace(workspace,{gitImpl,requireClean:true});
 const submission=validateSubmission({pr,sha,workspaceInfo:info});
 const {context,task}=await getReadyWork(call,projectId,taskId);
 const milestone=context.project.milestones.find(m=>m.id===task.milestoneId);
 if(!milestone)throw fail('MILESTONE_MISSING','Task milestone not found');
 if(milestone.order!==2)throw fail('UNSUPPORTED_MILESTONE','GitHub product PR submission only supports code delivery milestone');
 const claim=await call('task.claim',{project_id:projectId,task_id:task.id,
  baseline_revision:context.baseline.revision,expected_revision:task.revision,idempotency_key:uuid()});
 // Capture truthful, pending evidence. Owner must separately run GitHub verification.
 const evidence=await call('evidence.attach',{project_id:projectId,milestone_id:milestone.id,
   type:'github_pr',source_uri:submission.pr,repo:submission.repo,commit_sha:submission.sha,
   criteria_ids:milestone.acceptanceIds,idempotency_key:uuid()});
 const done=await call('task.transition',{task_id:task.id,status:'submitted',lease_token:claim.lease_token,
   expected_revision:claim.task.revision,idempotency_key:uuid()});
 const handoff=await call('handoff.submit',{project_id:projectId,milestone_id:milestone.id,
   baseline_revision:context.baseline.revision,commit_sha:submission.sha,evidence_ids:[evidence.id],
   known_gaps:[],idempotency_key:uuid()});
 return {taskId:task.id,taskRevision:done.revision,submissionId:handoff.id,evidenceId:evidence.id,
   commitSha:submission.sha,pr:submission.pr,verificationState:evidence.verificationState,
   acceptanceState:handoff.acceptanceState,ownerMustVerify:true};
}
export async function main(argv=process.argv.slice(2),env=process.env){
 const opts=parseArgs(argv);
 if(opts.help){process.stdout.write('Usage: node scripts/agent-pilot.mjs doctor|plan|run|submit --project ID --workspace DIR [--provider codex|claude] [--task ID] [--confirm] [--pr URL --sha SHA]\n');return;}
 const projectId=required(opts.project,'--project');
 const call=agentApi({baseUrl:opts['base-url']||env.RADAR_BASE_URL,token:env.RADAR_AGENT_TOKEN});
 let output;
 if(opts.action==='doctor'){
  const info=inspectWorkspace(opts.workspace);
  const data=await getReadyWork(call,projectId,opts.task);
  output={status:'ready',projectId,taskId:data.task.id,baselineRevision:data.context.baseline.revision,
   workspace:info.workspace,branch:info.branch,provider:opts.provider||'codex',
   command:commandFor(opts.provider||'codex',info.workspace).command,willStartProcess:false};
 }else if(opts.action==='plan'){
  if(opts.workspace)inspectWorkspace(opts.workspace);
  const data=await getReadyWork(call,projectId,opts.task);
  output=opts.json?{projectId,taskId:data.task.id,prompt:data.prompt}:data.prompt;
 }else if(opts.action==='run'){
  output=await executePilot({call,projectId,taskId:opts.task,workspace:opts.workspace,
   provider:opts.provider||'codex',confirmed:opts.confirm});
 }else{
  output=await submitPilot({call,projectId,taskId:opts.task,workspace:opts.workspace,
   pr:opts.pr,sha:opts.sha,confirmed:opts.confirm});
 }
 process.stdout.write(typeof output==='string'?output+'\n':JSON.stringify(output,null,2)+'\n');
}
const entry=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(entry)main().catch(e=>{process.stderr.write((e.code||'ERROR')+': '+e.message+'\n');process.exitCode=1;});
