import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';

test('background dispatch returns 202 before model response; owner status reads reattach without duplicate requests',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-job-http-'));
 Object.assign(process.env,{RADAR_DB:join(directory,'db.sqlite'),RADAR_OWNER_TOKEN:'job-owner',RADAR_AGENT_TOKEN:'job-agent'});
 let release,calls=0;
 const model=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;calls++;
  const rows=JSON.parse(JSON.parse(raw).messages[1].content).candidates;
  release=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(rows.map(x=>({id:x.id,verdict:'keep',reason:'重复用户任务待核查'})))}}]}));};
 });
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 Object.assign(process.env,{RADAR_LLM_BASE_URL:'http://127.0.0.1:'+model.address().port,RADAR_LLM_MODEL:'fixture',RADAR_LLM_API_KEY:'job-private-key'});
 const {createServer,closeStore}=await import('../src/server.mjs');const server=createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,db=openDatabase(process.env.RADAR_DB);
 const call=(path,opts={})=>fetch(base+'/api/home/opportunities/jobs'+path,{...opts,headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'job-owner',...opts.headers}});
 try{
  db.put('sources',{id:'a',title:'Cannot import CSV into Excel',description:'I manually import CSV every day and spend 3 hours fixing errors.',url:'https://forum.example/original',status:'new'});
  assert.equal((await call('/current',{'headers':{'X-Radar-Owner-Key':'wrong'}})).status,401);
  assert.equal((await call('',{method:'POST',headers:{'X-Radar-Owner-Key':'',Authorization:'Bearer job-agent'},body:'{"mode":"retry"}'})).status,401);
  assert.equal((await call('',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{"mode":"retry"}'})).status,403);
  for(const body of ['null','[]','{"mode":"unknown"}'])assert.equal((await call('',{method:'POST',body})).status,400);
  assert.equal((await (await call('/current')).json()).job,null);assert.equal(calls,0);
  const start=await call('',{method:'POST',body:'{"mode":"retry"}'});assert.equal(start.status,202);
  const job=(await start.json()).job;assert.equal(job.inProgress,true);
  for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);
  const duplicate=await (await call('',{method:'POST',body:'{"mode":"retry"}'})).json();
  assert.equal(duplicate.reused,true);assert.equal(duplicate.job.jobId,job.jobId);
  assert.equal((await call('',{method:'POST',body:'{"mode":"scan"}'})).status,409);
  const reading=await (await call('/current')).json();assert.equal(reading.job.jobId,job.jobId);assert.equal(reading.job.inProgress,true);
  assert.deepEqual(reading.job.progress,{total:1,classified:0,pending:1,reused:0});assert.equal(calls,1);
  release();release=null;
  let done;for(let i=0;i<100;i++){done=(await (await call('/current')).json()).job;if(!done.inProgress)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(done.status,'completed');assert.equal(done.progress.classified,1);assert.equal(calls,1);
  assert.equal(db.list('opportunities').length,0);assert.equal(db.list('opportunity_evidence_reviews').length,0);
  assert.ok(!JSON.stringify(done).includes('job-private-key'));
 }finally{if(release)release();db.close();await new Promise(r=>server.close(r));closeStore();await new Promise(r=>model.close(r));rmSync(directory,{recursive:true,force:true});}
});
