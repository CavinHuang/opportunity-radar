import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';

test('real HTTP comparison authenticates, fences search versions and persists only a model draft and reuses it even with an idempotency header',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-comparison-http-'));
 process.env.RADAR_DB=join(directory,'radar.sqlite');process.env.RADAR_OWNER_TOKEN='comparison-test-owner';
 let modelCalls=0;
 const model=http.createServer(async(req,res)=>{
  modelCalls++;let data='';for await(const part of req)data+=part;
  const prompt=JSON.parse(JSON.parse(data).messages[1].content);
  assert.equal(prompt.external.url,'https://forum.example/related');
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({taskRelation:'uncertain',relationReason:'短片段不足以确认同一任务。',
   solutionCoverage:'unknown',coverageReason:'不能确认现有方案覆盖哪些步骤。',nextCheck:'检查原网页的具体输入、操作步骤和失败条件。'})}}]}));
 });
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 process.env.RADAR_LLM_BASE_URL='http://127.0.0.1:'+model.address().port;process.env.RADAR_LLM_API_KEY='test';process.env.RADAR_LLM_MODEL='fixture';
 const {createServer,closeStore}=await import('../src/server.mjs');const server=createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const db=openDatabase(process.env.RADAR_DB),base='http://127.0.0.1:'+server.address().port;
 try{
  db.put('sources',{id:'a',status:'new',url:'https://forum.example/original',title:'Cannot import CSV into Excel',description:'I manually import CSV every day and spend 3 hours fixing errors.'});
  const ctx=candidateContext(db,'signal:a');const ext=db.put('opportunity_external_research',{id:'signal:a',candidateFingerprint:ctx.fingerprint,results:[{url:'https://forum.example/related',title:'CSV Excel issue',excerpt:'Cannot parse rows.'}]});
  const payload={url:ext.results[0].url,candidateFingerprint:ctx.fingerprint,searchRevision:ext.revision};
  const path='/api/opportunity-scan/signal%3Aa/evidence-comparison';
  const request=async(body,extra={})=>{
   const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'comparison-test-owner',...extra},body:JSON.stringify(body)});
   return {status:r.status,data:await r.json()};
  };
  assert.equal((await request(payload,{'X-Radar-Owner-Key':'wrong'})).status,401);
  assert.equal((await request(payload,{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request({...payload,searchRevision:0})).status,409);
  assert.equal((await request({...payload,url:'https://untrusted.example'})).status,409);assert.equal(modelCalls,0);
  const before=db.eventsLatest(400).length;
  const result=await request(payload,{'Idempotency-Key':'read-only-draft'});
  assert.equal(result.status,200);assert.equal(result.data.draft.comparison.taskRelation,'uncertain');
  assert.equal(result.data.draft.ownerReviewed,false);assert.equal(result.data.draft.readOnly,false);
  assert.equal(db.eventsLatest(400).length,before);assert.equal(db.list('opportunity_evidence_reviews').length,0);
  assert.equal(db.list('opportunities').length,0);assert.equal(modelCalls,1);
  assert.equal(db.list('opportunity_evidence_comparisons').length,1);
  const replay=await request(payload,{'Idempotency-Key':'read-only-draft'});
  assert.equal(replay.data.draft.cached,true);assert.equal(replay.data.draft.readOnly,true);assert.equal(modelCalls,1);
  assert.equal(replay.data.draft.generatedAt,result.data.draft.generatedAt);
  const nextPath=base+'/api/opportunity-scan/signal%3Aa/evidence-comparison-next';
  const nextRequest=async(payload,key='comparison-test-owner')=>fetch(nextPath,{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Owner-Key':key},body:JSON.stringify(payload)});
  assert.equal((await nextRequest(payload,'wrong')).status,401);
  assert.equal((await nextRequest({...payload,searchRevision:0})).status,409);
  const continued=await nextRequest(payload);assert.equal(continued.status,200);
  const batch=(await continued.json()).batch;assert.equal(batch.status,'complete');assert.equal(batch.results.length,0);
  assert.equal(modelCalls,1);assert.equal(db.list('opportunity_evidence_reviews').length,0);
 }finally{
  db.close();await new Promise(r=>server.close(r));closeStore();await new Promise(r=>model.close(r));rmSync(directory,{recursive:true,force:true});
 }
});
