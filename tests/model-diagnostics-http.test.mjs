import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';

test('model diagnostics are owner-only; probes use fixed inputs and preserve research and review records',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-model-http-'));
 process.env.RADAR_DB=join(directory,'radar.sqlite');process.env.RADAR_OWNER_TOKEN='test-owner';process.env.RADAR_AGENT_TOKEN='test-agent';
 const captured=[];let providerStatus=200;
 const model=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;captured.push(JSON.parse(body));
  if(providerStatus!==200){res.writeHead(providerStatus,{'Content-Type':'application/json','x-request-id':'fixture-request-503'});res.end(JSON.stringify({error:{code:'service_unavailable',message:'fixture-chat-secret private prompt'}}));return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url==='/decisions'?{answers:{is_problem:{noul:0.8}}}:{choices:[{message:{content:'OK'}}]}));
 });
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const modelBase='http://127.0.0.1:'+model.address().port;
 Object.assign(process.env,{RADAR_LLM_BASE_URL:modelBase,RADAR_LLM_MODEL:'fixture-chat',RADAR_LLM_API_KEY:'fixture-chat-secret',JEV_API_URL:modelBase+'/decisions',JEV_API_KEY:'fixture-jev-secret'});
 const {createServer,closeStore}=await import('../src/server.mjs');const server=createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,db=openDatabase(process.env.RADAR_DB);
 const call=(path,opts={})=>fetch(base+'/api/operations/models'+path,{...opts,headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner',...opts.headers}});
 try{
  const before=db.eventsLatest(400);
  assert.equal((await call('',{headers:{'X-Radar-Owner-Key':'wrong'}})).status,401);
  assert.equal((await call('/probe',{method:'POST',headers:{'X-Radar-Owner-Key':'',Authorization:'Bearer test-agent'},body:'{"kind":"llm"}'})).status,401);
  assert.equal((await call('/probe',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{"kind":"llm"}'})).status,403);
  assert.equal((await call('/probe',{method:'POST',body:'{"kind":"other"}'})).status,400);assert.equal(captured.length,0);
  const read=await (await call('')).json();assert.equal(read.models.length,2);assert.equal(captured.length,0);
  for(const kind of ['llm','jev']){
   const response=await call('/probe',{method:'POST',body:JSON.stringify({kind,prompt:'should not be transmitted',url:'https://attacker.example'})});
   assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.modelCall.kind,kind);
  }
  assert.equal(captured.length,2);assert.ok(!JSON.stringify(captured).includes('should not be transmitted'));
  const diagnostics=await (await call('')).text();assert.ok(!diagnostics.includes('fixture-chat-secret'));assert.ok(!diagnostics.includes('fixture-jev-secret'));
  for(const table of ['opportunities','opportunity_external_research','opportunity_evidence_reviews','opportunity_evidence_comparisons'])assert.equal(db.list(table).length,0);
  providerStatus=503;
  const failed=await call('/probe',{method:'POST',body:'{"kind":"llm"}'});assert.equal(failed.status,502);
  const failure=await failed.json();assert.equal(failure.error,'LLM_HTTP_ERROR');assert.equal(failure.modelCall.upstreamStatus,503);
  assert.equal(failure.modelCall.upstreamRequestId,'fixture-request-503');assert.equal(failure.modelCall.upstreamCode,'service_unavailable');
  assert.ok(!JSON.stringify(failure).includes('fixture-chat-secret'));assert.ok(!JSON.stringify(failure).includes('private prompt'));
  assert.deepEqual(db.eventsLatest(400),before);
 }finally{db.close();await new Promise(r=>server.close(r));closeStore();await new Promise(r=>model.close(r));rmSync(directory,{recursive:true,force:true});}
});
