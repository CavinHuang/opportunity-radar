import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {saveRunReceipt} from './pilot-journal.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{code});
export function parseTimeoutMinutes(value){
 const minutes=value===undefined?90:Number(value);
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>240)
  throw fail('BAD_TIMEOUT','--timeout-minutes must be an integer from 1 to 240');
 return minutes;
}
/** Run a child with bounded wall-time and cooperative, then forced, termination. */
export function superviseChild(child,prompt,{signal,timeoutMs=90*60_000,graceMs=3000}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw fail('BAD_TIMEOUT','Positive timeout required');
 return new Promise((resolve,reject)=>{
  let done=false,terminationReason=null,timeout,escalation;
  const cleanup=()=>{
   clearTimeout(timeout);clearTimeout(escalation);
   signal?.removeEventListener('abort',onAbort);
  };
  const stop=(reason)=>{
   if(done||terminationReason)return;
   terminationReason=reason;
   try{child.kill('SIGTERM');}catch{}
   escalation=setTimeout(()=>{if(!done){try{child.kill('SIGKILL');}catch{}}},graceMs);
   escalation.unref?.();
  };
  const onAbort=()=>stop('cancelled');
  child.once('error',e=>{if(done)return;done=true;cleanup();reject(e);});
  child.once('close',(code,sig)=>{if(done)return;done=true;cleanup();
    resolve({code,signal:sig,terminationReason});});
  timeout=setTimeout(()=>stop('timeout'),timeoutMs);
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)onAbort();
  child.stdin?.on('error',()=>{});
  if(!signal?.aborted&&child.stdin)child.stdin.end(prompt);
 });
}
/** A local run's exit code only describes the coding process, never software acceptance. */
export async function runCodingProcess({call,projectId,taskId,workspace,provider,confirmed=false,
 spawnImpl=spawn,renewIntervalMs=300000,timeoutMs=90*60_000,signal,journalDir,graceMs=3000,
 inspectWorkspace,getReadyWork,commandFor,git,sanitizedEnv}){
 if(!confirmed)throw fail('CONFIRM_REQUIRED','Execution requires --confirm');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>240*60_000)
  throw fail('BAD_TIMEOUT','Run timeout must be from 1ms to 240 minutes');
 const info=inspectWorkspace(workspace);
 const {context,task,prompt}=await getReadyWork(call,projectId,taskId);
 const command=commandFor(provider,info.workspace);
 const claim=await call('task.claim',{project_id:projectId,task_id:task.id,
  baseline_revision:context.baseline.revision,expected_revision:task.revision,idempotency_key:randomUUID()});
 const receipt={id:randomUUID(),projectId,taskId:task.id,provider,
   baselineRevision:context.baseline.revision,branch:info.branch,headBefore:info.head,
   startedAt:new Date().toISOString(),status:'starting'};
 let latest=claim.task,leaseToken=claim.lease_token,leaseError=null,busy=false;
 let child,interval,exit,receiptFile,recordedFinal=false;
 const controller=new AbortController();
 const onAbort=()=>controller.abort();
 signal?.addEventListener('abort',onAbort,{once:true});
 const audit=(updates)=>{Object.assign(receipt,updates);receiptFile=saveRunReceipt(receipt,{dir:journalDir});};
 try{
  audit({});
  child=spawnImpl(command.command,command.args,{cwd:info.workspace,env:sanitizedEnv(),stdio:['pipe','inherit','inherit'],shell:false});
  audit({status:'running'});
  interval=setInterval(async()=>{
   if(busy||controller.signal.aborted)return;busy=true;
   try{
    const renewed=await call('task.claim',{project_id:projectId,task_id:task.id,
      baseline_revision:context.baseline.revision,expected_revision:latest.revision,
      lease_token:leaseToken,idempotency_key:randomUUID()});
    latest=renewed.task;leaseToken=renewed.lease_token;
   }catch(e){leaseError=e;controller.abort();}
   finally{busy=false;}
  },renewIntervalMs);
  if(signal?.aborted)controller.abort();
  exit=await superviseChild(child,prompt,{signal:controller.signal,timeoutMs,graceMs});
  const code=exit.terminationReason==='timeout'?124:exit.terminationReason==='cancelled'
    ?leaseError?125:130:exit.code??1;
  const success=code===0&&exit.signal===null;
  let headAfter=null,changedFileCount=null;
  try{
   headAfter=git(info.workspace,'rev-parse','HEAD');
   changedFileCount=git(info.workspace,'status','--porcelain').split('\n').filter(Boolean).length;
  }catch{}
  audit({status:exit.terminationReason==='timeout'?'timed_out':exit.terminationReason==='cancelled'
    ?leaseError?'lease_lost':'cancelled':success?'local_process_exited_zero':'local_process_failed',
   endedAt:new Date().toISOString(),headAfter,changedFileCount,exitCode:code,
   terminationReason:leaseError?'lease_renewal_failed':exit.terminationReason||null});
  recordedFinal=true;
  try{
   await call('progress.report',{project_id:projectId,
    summary:success?provider+' coding command exited 0; requires review and actual CI.'
     :provider+' coding process ended with '+receipt.status+'. No delivery submitted.',
    limitations:['Local process exit and file changes do not establish accepted software or consumer validation.'],
    idempotency_key:randomUUID()});
  }catch(e){process.stderr.write('Progress reporting failed; local receipt available: '+e.message+'\n');}
  return {runId:receipt.id,receiptFile,taskId:task.id,workspace:info.workspace,provider,
    exitCode:code,signal:exit.signal,terminationReason:receipt.terminationReason,
    changedFileCount,submitted:false,requiresHumanReview:true};
 }catch(e){
  if(!recordedFinal){
   try{audit({status:'execution_error',endedAt:new Date().toISOString(),
      terminationReason:e.code||'execution_exception',exitCode:1});}
   catch(err){process.stderr.write('Local run receipt failed: '+err.message+'\n');}
  }
  throw e;
 }finally{
  clearInterval(interval);
  signal?.removeEventListener('abort',onAbort);
  if(child&&!exit){try{child.kill('SIGTERM');}catch{}}
  try{
   const context=await call('project.get_context',{project_id:projectId});
   const current=context.project.tasks.find(x=>x.id===task.id);
   if(current?.lease?.token===leaseToken)
    await call('task.release',{task_id:task.id,lease_token:leaseToken,
      expected_revision:current.revision,idempotency_key:randomUUID()});
  }catch(e){process.stderr.write('Task lease may require manual reconciliation: '+e.message+'\n');}
 }
}
