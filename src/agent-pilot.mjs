import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCodingProcess,parseTimeoutMinutes} from './pilot-supervisor.mjs';
import {listRunReceipts} from './pilot-journal.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{code});
const uuid=()=>randomUUID();
export const supportedProviders=['codex','claude'];
const shaRegex=/^[a-f0-9]{40}$/i;
function required(value,key){if(typeof value!=='string'||!value.trim())throw fail('BAD_ARGUMENT',key+' is required');return value.trim();}
export function parseArgs(argv){
 const [action,...rest]=argv;
 if(!['doctor','plan','run','submit','status','recover'].includes(action))throw fail('BAD_COMMAND','Use doctor, plan, run, status, recover or submit');
 const config={action};
 const fields=new Set(['project','task','workspace','provider','base-url','pr','sha','confirm','json','help','recovery-note','timeout-minutes','journal-dir']);
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
export async function verifyPullHead({pr,sha,repo,githubToken=process.env.GITHUB_TOKEN,fetchImpl=fetch}){
 const match=/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/([1-9]\d*)\/?$/.exec(pr||'');
 if(!match||!shaRegex.test(sha||''))throw fail('BAD_PR','A canonical GitHub PR and complete SHA are required');
 let response;
 try{
  response=await fetchImpl('https://api.github.com/repos/'+repo+'/pulls/'+match[1],{
   headers:{Accept:'application/vnd.github+json','User-Agent':'opportunity-radar-pilot/1.3',
    ...(githubToken?{Authorization:'Bearer '+githubToken}:{})},
   signal:AbortSignal.timeout(10000)
  });
 }catch(e){throw fail('GITHUB_UNAVAILABLE','Could not query GitHub PR. Retry after verifying connectivity: '+e.message);}
 if(!response.ok)throw fail('PR_NOT_ACCESSIBLE','GitHub PR cannot be verified (HTTP '+response.status+'). Do not submit evidence yet.');
 const data=await response.json();
 if(data.base?.repo?.full_name?.toLowerCase()!==repo.toLowerCase())throw fail('PR_REPO_MISMATCH','PR base repository differs from the selected workspace');
 if(data.head?.sha?.toLowerCase()!==sha.toLowerCase())throw fail('PR_HEAD_MISMATCH','GitHub PR latest head is different from the local commit. Fetch/update the feature branch.');
 return {number:Number(match[1]),url:pr,headSha:sha.toLowerCase(),verifiedAt:new Date().toISOString()};
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
export function installedCoderVersion(provider){
 const bin=commandFor(provider,'.').command;
 try{return execFileSync(bin,['--version'],{encoding:'utf8',timeout:8000,stdio:['ignore','pipe','pipe']}).trim().slice(0,160);}
 catch{throw fail('CODING_TOOL_MISSING',bin+' CLI is not installed or is not available on PATH; install/login before using run');}
}
export function commandFor(provider,workspace){
 if(provider==='codex')return {command:'codex',args:['exec','--sandbox','workspace-write','--cd',workspace,'-'],viaStdin:true};
 if(provider==='claude')return {command:'claude',args:['-p','--permission-mode','acceptEdits'],viaStdin:true};
 throw fail('BAD_PROVIDER','Supported providers: '+supportedProviders.join(', '));
}
export {parseTimeoutMinutes};
export async function executePilot(options){
 const {gitImpl=git,spawnImpl=spawn,...rest}=options;
 return runCodingProcess({...rest,spawnImpl,inspectWorkspace:(workspace)=>inspectWorkspace(workspace,{gitImpl}),
  getReadyWork,commandFor,git:gitImpl,sanitizedEnv});
}
export function deliveryKey(step,{projectId,taskId,sha,pr}){
 return 'pilot-v1.4-'+step+'-'+createHash('sha256').update([projectId,taskId,sha,pr].join('|')).digest('hex').slice(0,36);
}
export async function getDeliveryWork(call,projectId,taskId){
 const context=await call('project.get_context',{project_id:required(projectId,'project')});
 const baselineRevision=context.baseline?.revision;
 const codeMilestones=context.project.milestones.filter(x=>x.order===2);
 if(codeMilestones.length!==1)throw fail('MILESTONE_MISSING','One approved product milestone is required');
 const milestone=codeMilestones[0];
 const candidates=context.project.tasks.filter(x=>x.milestoneId===milestone.id &&
   ['open','rework','submitted'].includes(x.status) &&
   (!x.baselineRevision||x.baselineRevision===baselineRevision));
 const task=taskId?candidates.find(x=>x.id===taskId):candidates.length===1?candidates[0]:null;
 if(!task)throw fail(taskId?'TASK_NOT_DELIVERABLE':'TASK_SELECTION_REQUIRED',
   taskId?'The selected task is not part of the current approved deliverable':'Specify --task to avoid submitting the wrong product task');
 return {context,task,milestone};
}
export async function statusPilot({call,projectId,journalDir}){
 const context=await call('project.get_context',{project_id:required(projectId,'project')});
 const tasks=context.project.tasks.map(t=>({
  id:t.id,title:t.title,status:t.status,baselineRevision:t.baselineRevision||null,
  leaseExpiresAt:t.lease?.expiresAt||null,reworkReason:t.reworkReason||null
 }));
 return {projectId,status:context.project.status,baselineRevision:context.baseline.revision,
   tasks,submissions:context.project.submissions.map(s=>({id:s.id,milestoneId:s.milestoneId,
     commitSha:s.commitSha,baselineRevision:s.baselineRevision,state:s.acceptanceState,
     coverage:s.g2State,evidenceIds:s.evidenceIds})),
   localRuns:listRunReceipts({projectId,dir:journalDir,limit:10}),
   warning:'Local receipts do not prove current process health. A lease expiry does not prove the external process stopped; no tokens are printed.'};
}
export async function recoverPilot({call,projectId,taskId,recoveryNote,confirmed=false}){
 if(!confirmed)throw fail('CONFIRM_REQUIRED','Recovery requires --confirm after checking external processes and side effects');
 if(!recoveryNote||recoveryNote.trim().length<12)throw fail('RECONCILIATION_NOTE_REQUIRED',
   'Write a specific --recovery-note (at least 12 characters) after checking process, Git changes and side effects');
 const context=await call('project.get_context',{project_id:required(projectId,'project')});
 const t=context.project.tasks.find(x=>x.id===required(taskId,'task'));
 if(!t)throw fail('TASK_NOT_FOUND','Task does not belong to this project');
 if(t.baselineRevision&&t.baselineRevision!==context.baseline.revision)throw fail('BASELINE_STALE','Owner must reapprove work for the current baseline');
 if(t.status==='submitted')throw fail('TASK_ALREADY_SUBMITTED','Use submit with the original task ID to recover a partial handoff');
 if(!['open','rework','in_progress'].includes(t.status))throw fail('TASK_NOT_RECOVERABLE','Task is not recoverable');
 if(!t.lease)return {taskId:t.id,recovered:false,status:t.status,reason:'No outstanding lease; use run or submit'};
 if(Date.parse(t.lease.expiresAt)>Date.now())throw fail('TASK_LEASE_ACTIVE','A lease is still active. Check and stop the old external process; wait for expiry before takeover');
 const claim=await call('task.claim',{project_id:projectId,task_id:t.id,baseline_revision:context.baseline.revision,
   expected_revision:t.revision,recovery_checked:true,recovery_note:recoveryNote,idempotency_key:uuid()});
 const released=await call('task.release',{task_id:t.id,lease_token:claim.lease_token,
   expected_revision:claim.task.revision,idempotency_key:uuid()});
 return {taskId:t.id,recovered:true,status:released.status,baselineRevision:context.baseline.revision,
   requiresHumanReconciliation:true,externalProcessStopped:false};
}
export async function submitPilot({call,projectId,taskId,workspace,pr,sha,confirmed=false,gitImpl=git,fetchImpl=fetch,githubToken=process.env.GITHUB_TOKEN}){
 if(!confirmed)throw fail('CONFIRM_REQUIRED','Submission requires --confirm');
 const info=inspectWorkspace(workspace,{gitImpl,requireClean:true});
 const submission=validateSubmission({pr,sha,workspaceInfo:info});
 // Verify the real PR head BEFORE changing the Radar task, even for retries.
 const remote=await verifyPullHead({...submission,githubToken,fetchImpl});
 const {context,task,milestone}=await getDeliveryWork(call,projectId,taskId);
 const identity={projectId,taskId:task.id,sha:submission.sha,pr:submission.pr};
 const sameEvidence=()=>context.project.evidence.find(e=>
    e.milestoneId===milestone.id && e.commitSha?.toLowerCase()===submission.sha &&
    e.sourceUri===submission.pr && (!e.taskId||e.taskId===task.id) &&
    milestone.acceptanceIds.every(id=>e.criteriaIds?.includes(id)));
 const previously=context.project.submissions.find(s=>s.milestoneId===milestone.id &&
    s.baselineRevision===context.baseline.revision && s.commitSha?.toLowerCase()===submission.sha &&
    s.evidenceIds?.some(id=>context.project.evidence.some(e=>e.id===id&&e.sourceUri===submission.pr)));
 if(previously){
   if(previously.acceptanceState==='rejected')throw fail('REJECTED_SHA','Owner rejected this commit. Supply a new commit and PR head for rework');
   const evidence=context.project.evidence.find(e=>previously.evidenceIds.includes(e.id));
   return {taskId:task.id,submissionId:previously.id,evidenceId:evidence?.id||null,
      commitSha:submission.sha,pr:submission.pr,verifiedRemotePrHead:remote.headSha,
      verificationState:evidence?.verificationState||'pending',acceptanceState:previously.acceptanceState,
      alreadySubmitted:true,ownerMustVerify:previously.acceptanceState==='pending'};
 }
 let claim,taskRevision=task.revision;
 try{
   if(task.status!=='submitted'){
     claim=await call('task.claim',{project_id:projectId,task_id:task.id,
       baseline_revision:context.baseline.revision,expected_revision:task.revision,idempotency_key:uuid()});
   }
   // Stable keys let the backend replay steps after network loss without new evidence/submissions.
   const evidence=sameEvidence()||await call('evidence.attach',{
     project_id:projectId,milestone_id:milestone.id,task_id:task.id,
     type:'github_pr',source_uri:submission.pr,repo:submission.repo,commit_sha:submission.sha,
     criteria_ids:milestone.acceptanceIds,idempotency_key:deliveryKey('evidence',identity)});
   if(claim){
     const done=await call('task.transition',{task_id:task.id,status:'submitted',lease_token:claim.lease_token,
       expected_revision:claim.task.revision,idempotency_key:deliveryKey('task-submit',identity)});
     taskRevision=done.revision;
   }
   const handoff=await call('handoff.submit',{project_id:projectId,milestone_id:milestone.id,
      baseline_revision:context.baseline.revision,commit_sha:submission.sha,evidence_ids:[evidence.id],
      known_gaps:[],idempotency_key:deliveryKey('handoff',identity)});
   return {taskId:task.id,taskRevision,submissionId:handoff.id,evidenceId:evidence.id,
      commitSha:submission.sha,pr:submission.pr,verifiedRemotePrHead:remote.headSha,
      verificationState:evidence.verificationState,acceptanceState:handoff.acceptanceState,
      alreadySubmitted:false,ownerMustVerify:true};
 }finally{
   if(claim){
     // A failure after task.claim should not block the next attempt for 15 minutes.
     try{
       const fresh=await call('project.get_context',{project_id:projectId});
       const current=fresh.project.tasks.find(t=>t.id===task.id);
       if(current?.lease?.token===claim.lease_token)await call('task.release',{
         task_id:task.id,lease_token:claim.lease_token,
         expected_revision:current.revision,idempotency_key:uuid()});
     }catch(e){process.stderr.write('Handoff task lease may require explicit recovery: '+e.message+'\n');}
   }
 }
}
export async function main(argv=process.argv.slice(2),env=process.env){
 const opts=parseArgs(argv);
 if(opts.help){process.stdout.write('Usage: node scripts/agent-pilot.mjs doctor|plan|run|status|recover|submit --project ID --workspace DIR [--provider codex|claude] [--task ID] [--confirm] [--pr URL --sha SHA] [--recovery-note TEXT] [--timeout-minutes 90] [--journal-dir PATH]\n');return;}
 const projectId=required(opts.project,'--project');
 const call=agentApi({baseUrl:opts['base-url']||env.RADAR_BASE_URL,token:env.RADAR_AGENT_TOKEN});
 let output;
 if(opts.action==='status'){
  output=await statusPilot({call,projectId,journalDir:opts['journal-dir']});
 }else if(opts.action==='recover'){
  output=await recoverPilot({call,projectId,taskId:opts.task,recoveryNote:opts['recovery-note'],confirmed:opts.confirm});
 }else if(opts.action==='doctor'){
  const info=inspectWorkspace(opts.workspace);
  const data=await getReadyWork(call,projectId,opts.task);
  output={status:'ready',projectId,taskId:data.task.id,baselineRevision:data.context.baseline.revision,
   workspace:info.workspace,branch:info.branch,provider:opts.provider||'codex',
   command:commandFor(opts.provider||'codex',info.workspace).command,installedVersion:installedCoderVersion(opts.provider||'codex'),willStartProcess:false};
 }else if(opts.action==='plan'){
  if(opts.workspace)inspectWorkspace(opts.workspace);
  const data=await getReadyWork(call,projectId,opts.task);
  output=opts.json?{projectId,taskId:data.task.id,prompt:data.prompt}:data.prompt;
 }else if(opts.action==='run'){
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{output=await executePilot({call,projectId,taskId:opts.task,workspace:opts.workspace,
   provider:opts.provider||'codex',confirmed:opts.confirm,
   timeoutMs:parseTimeoutMinutes(opts['timeout-minutes'])*60000,
   journalDir:opts['journal-dir'],signal:controller.signal});}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
 }else{
  output=await submitPilot({call,projectId,taskId:opts.task,workspace:opts.workspace,
   pr:opts.pr,sha:opts.sha,confirmed:opts.confirm});
 }
 process.stdout.write(typeof output==='string'?output+'\n':JSON.stringify(output,null,2)+'\n');
 if(opts.action==='run'&&output.exitCode!==0)process.exitCode=output.exitCode||1;
}
const entry=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(entry)main().catch(e=>{process.stderr.write((e.code||'ERROR')+': '+e.message+'\n');process.exitCode=1;});
