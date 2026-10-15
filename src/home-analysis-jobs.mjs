import {randomUUID} from 'node:crypto';
import {scanSources} from './source-hub.mjs';
import {scanHomeOpportunities} from './home-opportunities.mjs';

const active=new WeakMap();
const running=new Set(['queued','collecting','analyzing']);
const fail=(code,message,status)=>Object.assign(new Error(message),{code,status});
/** Read status only. A stale running marker never restarts a paid model request. */
export function currentHomeAnalysisJob(store){
 const row=store.get('home_analysis_jobs','latest');if(!row)return null;
 const live=active.get(store)?.id===row.jobId;
 const interrupted=running.has(row.status)&&!live;
 return {...row,status:interrupted?'interrupted':row.status,inProgress:running.has(row.status)&&live,
  reason:interrupted?'服务已重启或任务已中断；已完成分析可从检查点继续，请主动重试。':row.reason||null,
  notice:'刷新页面只读取任务进度，不启动模型。完成进度不代表需求成立；服务中断后需主动继续。'};
}

export function startHomeAnalysisJob(store,input={},
 {env=process.env,fetchImpl=globalThis.fetch,scanImpl=scanSources,analyzeImpl=scanHomeOpportunities}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('BAD_JOB_MODE','任务参数必须包含 scan 或 retry 模式',400);
 const mode=input.mode===undefined?'retry':input.mode;
 if(!['scan','retry'].includes(mode))throw fail('BAD_JOB_MODE','任务模式只能是 scan 或 retry',400);
 const existing=active.get(store);
 if(existing){
  const job=currentHomeAnalysisJob(store);
  if(job.mode!==mode)throw fail('HOME_ANALYSIS_RUNNING','已有检索任务正在执行，请查看当前进度',409);
  return {job,reused:true};
 }
 const jobId=randomUUID(),startedAt=new Date().toISOString();
 const old=store.get('home_analysis_jobs','latest');
 store.put('home_analysis_jobs',{id:'latest',jobId,mode,status:'queued',startedAt,progress:null,sourceErrors:0},old?.revision||0);
 const update=patch=>{
  const row=store.get('home_analysis_jobs','latest');
  if(row?.jobId!==jobId)return;
  store.put('home_analysis_jobs',{...row,...patch},row.revision);
 };
 const task={id:jobId,promise:null};active.set(store,task);
 task.promise=Promise.resolve().then(async()=>{
  try{
   let scan=null;
   if(mode==='scan'){
    update({status:'collecting'});scan=await scanImpl(store,{});
    update({sourceErrors:scan.errors?.length||0});
   }
   update({status:'analyzing'});
   const discovery=await analyzeImpl(store,{env,fetchImpl,retryIncomplete:mode==='retry',
    scanStats:scan?{feeds:scan.feeds,received:scan.received,added:scan.added,filtered:scan.filtered,duplicates:scan.duplicates,errors:scan.errors?.length||0}:null,
    onProgress:progress=>update({progress})});
   const status=discovery.status==='filtered'?'completed':discovery.status==='filtered_partial'?'partial':'failed';
   const a=discovery.analysis;
   update({status,finishedAt:new Date().toISOString(),reason:discovery.reason||null,
    progress:a?{total:discovery.considered,classified:a.classified,pending:a.unclassified,reused:a.reused||0}:null,
    result:{status:discovery.status,accepted:discovery.accepted,retainedCount:discovery.retainedCount||0}});
  }catch(e){
   // Upstream bodies and raw exceptions can contain credentials or gateway HTML.
   update({status:'failed',finishedAt:new Date().toISOString(),error:e.code==='SCAN_IN_PROGRESS'?'SCAN_IN_PROGRESS':'HOME_JOB_FAILED',
    reason:e.code==='SCAN_IN_PROGRESS'?'来源正在同步，请稍后重试。':'任务未完成，已完成分析仍保留；可查看模型诊断后重试。'});
  }finally{if(active.get(store)===task)active.delete(store);}
 }).catch(()=>{
  // If storage itself is unavailable, the running marker becomes interrupted
  // on the next read; do not leave an unhandled background rejection.
  console.error('[Radar home] Task status could not be saved; completed checkpoints may be resumed.');
 });
 return {job:currentHomeAnalysisJob(store),reused:false};
}

/** Teardown/tests can await a started task without creating another one. */
export function waitForHomeAnalysisJob(store){return active.get(store)?.promise||Promise.resolve();}
