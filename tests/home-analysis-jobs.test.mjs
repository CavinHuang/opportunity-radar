import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {startHomeAnalysisJob,currentHomeAnalysisJob,waitForHomeAnalysisJob} from '../src/home-analysis-jobs.mjs';

const env={RADAR_LLM_BASE_URL:'https://model.example/v1',RADAR_LLM_MODEL:'fixture',RADAR_LLM_API_KEY:'private-test-key'};
function setup(path){
 const db=openDatabase(path);
 for(let i=0;i<8;i++){
  const title=createHash('sha256').update(String(i)).digest('hex').slice(0,32).replace(/\d/g,d=>String.fromCharCode(103+Number(d))).match(/.{8}/g).join(' ');
  db.put('sources',{id:'s'+i,title:title+' upload issue',description:'I manually upload files every day and lose 2 hours because the upload fails.',url:'https://forum.example/'+i,status:'new'});
 }
 return db;
}
const rows=options=>JSON.parse(JSON.parse(options.body).messages[1].content).candidates;
const response=items=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(items.map(x=>({id:x.id,verdict:'keep',reason:'重复用户任务待核查'})))}}]})});
const good=async(url,options)=>response(rows(options));
const turn=()=>new Promise(r=>setImmediate(r));

test('job dispatch returns before collection finishes, shows real intermediate progress and shares duplicate work',async()=>{
 const db=setup();let collect,secondBatch,calls=0,scans=0;try{
  const options={env,scanImpl:async()=>{scans++;return new Promise(r=>{collect=r;});},fetchImpl:async(url,options)=>{
   if(++calls===2)await new Promise(r=>{secondBatch=r;});return response(rows(options));
  }};
  const first=startHomeAnalysisJob(db,{mode:'scan'},options);
  assert.equal(first.job.status,'queued');assert.equal(first.job.progress,null);assert.equal(scans,0);
  const duplicate=startHomeAnalysisJob(db,{mode:'scan'},options);assert.equal(duplicate.reused,true);assert.equal(duplicate.job.jobId,first.job.jobId);
  assert.throws(()=>startHomeAnalysisJob(db,{mode:'retry'},options),{code:'HOME_ANALYSIS_RUNNING'});
  await turn();assert.equal(scans,1);assert.equal(currentHomeAnalysisJob(db).status,'collecting');assert.equal(currentHomeAnalysisJob(db).progress,null);
  collect({feeds:2,errors:[{code:'unreachable'}],added:0});await turn();
  const halfway=currentHomeAnalysisJob(db);assert.equal(halfway.status,'analyzing');assert.equal(halfway.inProgress,true);
  assert.deepEqual(halfway.progress,{total:8,classified:4,pending:4,reused:0});assert.equal(halfway.sourceErrors,1);
  assert.equal(calls,2);for(let i=0;i<3;i++)assert.equal(currentHomeAnalysisJob(db).jobId,first.job.jobId);
  assert.equal(calls,2);secondBatch();await waitForHomeAnalysisJob(db);
  const done=currentHomeAnalysisJob(db);assert.equal(done.status,'completed');assert.equal(done.inProgress,false);assert.equal(done.progress.classified,8);
  assert.equal(db.list('opportunities').length,0);assert.equal(db.list('opportunity_evidence_reviews').length,0);
 }finally{db.close();}
});

test('partial jobs resume only missing model work and do not collect feeds or inflate observations',async()=>{
 const db=setup();let calls=0;try{
  startHomeAnalysisJob(db,{mode:'retry'},{env,scanImpl:()=>assert.fail('retry must not collect'),fetchImpl:async(url,options)=>++calls===2?{ok:false,status:503}:response(rows(options))});
  await waitForHomeAnalysisJob(db);assert.equal(currentHomeAnalysisJob(db).status,'partial');assert.equal(currentHomeAnalysisJob(db).progress.pending,4);
  calls=0;startHomeAnalysisJob(db,{mode:'retry'},{env,scanImpl:()=>assert.fail('retry must not collect'),fetchImpl:async(url,options)=>{calls++;return response(rows(options));}});
  await waitForHomeAnalysisJob(db);const done=currentHomeAnalysisJob(db);
  assert.equal(calls,1);assert.equal(done.status,'completed');assert.equal(done.progress.reused,4);
  assert.equal(db.list('home_opportunity_identity_events').length,8);
 }finally{db.close();}
});

test('a persisted running marker is interrupted after database reopen; reading it never restarts model calls',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-jobs-restart-')),path=join(directory,'db.sqlite');let db=setup(path);
 try{
  startHomeAnalysisJob(db,{mode:'retry'},{env,fetchImpl:good});await waitForHomeAnalysisJob(db);
  const done=db.get('home_analysis_jobs','latest');db.put('home_analysis_jobs',{...done,status:'analyzing'},done.revision);
  db.close();db=openDatabase(path);
  for(let i=0;i<3;i++){const read=currentHomeAnalysisJob(db);assert.equal(read.status,'interrupted');assert.equal(read.inProgress,false);}
  assert.equal(db.get('home_analysis_jobs','latest').status,'analyzing','status reads must be read-only');
  startHomeAnalysisJob(db,{mode:'retry'},{env,fetchImpl:()=>assert.fail('completed checkpoints suffice')});
  await waitForHomeAnalysisJob(db);assert.equal(currentHomeAnalysisJob(db).status,'completed');assert.equal(currentHomeAnalysisJob(db).progress.reused,8);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('unexpected background errors are safe, terminal, and allow another explicit attempt',async()=>{
 const db=setup();try{
  assert.equal(currentHomeAnalysisJob(db),null);
  for(const input of [null,[],{mode:'unknown'}])assert.throws(()=>startHomeAnalysisJob(db,input),{code:'BAD_JOB_MODE'});
  startHomeAnalysisJob(db,{mode:'scan'},{scanImpl:async()=>{throw new Error('private-test-key internal gateway body');}});
  await waitForHomeAnalysisJob(db);const failed=currentHomeAnalysisJob(db);
  assert.equal(failed.status,'failed');assert.equal(failed.error,'HOME_JOB_FAILED');assert.ok(!JSON.stringify(failed).includes('private-test-key'));
  startHomeAnalysisJob(db,{mode:'retry'},{env,fetchImpl:good});await waitForHomeAnalysisJob(db);assert.equal(currentHomeAnalysisJob(db).status,'completed');
 }finally{db.close();}
});

test('a calibration change during analysis cannot leave old completed counts presented as current progress',async()=>{
 const db=setup();let calls=0;try{
  startHomeAnalysisJob(db,{mode:'retry'},{env,fetchImpl:async(url,options)=>{
   if(++calls===2)db.put('home_opportunity_feedback',{id:'signal:s0',verdict:'false_positive',reason:'当前判断需要重新核对具体问题和用户任务'});
   return response(rows(options));
  }});
  await waitForHomeAnalysisJob(db);const failed=currentHomeAnalysisJob(db);
  assert.equal(failed.status,'failed');assert.equal(failed.progress,null);assert.equal(failed.result.accepted,0);
 }finally{db.close();}
});
