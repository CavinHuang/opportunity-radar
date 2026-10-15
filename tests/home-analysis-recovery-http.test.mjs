import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';

test('owner-only home retry resumes model work without fetching feeds, changing reviews or promoting opportunities',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-home-retry-http-'));
 Object.assign(process.env,{RADAR_DB:join(directory,'db.sqlite'),RADAR_OWNER_TOKEN:'owner-fixture',RADAR_AGENT_TOKEN:'agent-fixture'});
 let modelCalls=0,feedCalls=0;
 const model=http.createServer(async(req,res)=>{
  if(req.url==='/feed'){feedCalls++;res.end('<rss/>');return;}
  let text='';for await(const chunk of req)text+=chunk;
  const candidates=JSON.parse(JSON.parse(text).messages[1].content).candidates;
  modelCalls++;if(modelCalls===2){res.writeHead(503);res.end('{}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(candidates.map(x=>({id:x.id,verdict:'keep',reason:'具体重复任务待核查'})))}}]}));
 });
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 const modelBase='http://127.0.0.1:'+model.address().port;
 Object.assign(process.env,{RADAR_LLM_BASE_URL:modelBase,RADAR_LLM_MODEL:'fixture',RADAR_LLM_API_KEY:'fixture-secret'});
 const {createServer,closeStore}=await import('../src/server.mjs');const server=createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,db=openDatabase(process.env.RADAR_DB);
 const call=(headers={})=>fetch(base+'/api/home/opportunities/retry',{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Owner-Key':'owner-fixture',...headers},body:'{}'});
 try{
  for(let i=0;i<8;i++){
   const title=createHash('sha256').update(String(i)).digest('hex').slice(0,32).replace(/\d/g,d=>String.fromCharCode(103+Number(d))).match(/.{8}/g).join(' ');
   db.put('sources',{id:'s'+i,title:title+' upload issue',description:'I manually upload files every day and lose 2 hours because the upload fails.',url:'https://forum.example/'+i,status:'new'});
  }
  const feed=db.put('feeds',{id:'test-feed',url:modelBase+'/feed',enabled:true,keywords:[],title:'must not scan',intervalMinutes:60});
  assert.equal((await call({'X-Radar-Owner-Key':'wrong'})).status,401);
  assert.equal((await call({'X-Radar-Owner-Key':'',Authorization:'Bearer agent-fixture'})).status,401);
  assert.equal((await call({Origin:'https://untrusted.example'})).status,403);assert.equal(modelCalls,0);
  const first=await call();assert.equal(first.status,200);const partial=(await first.json()).discovery;
  assert.equal(partial.status,'filtered_partial');assert.equal(partial.analysis.classified,4);assert.equal(partial.analysis.unclassified,4);
  const second=await call();assert.equal(second.status,200);const completed=(await second.json()).discovery;
  assert.equal(completed.status,'filtered');assert.equal(completed.analysis.reused,4);assert.equal(modelCalls,3);
  assert.equal((await (await call()).json()).discovery.analysis.attempted,0);assert.equal(modelCalls,3);
  assert.equal(feedCalls,0);assert.deepEqual(db.get('feeds',feed.id),feed);
  assert.equal(db.list('opportunities').length,0);assert.equal(db.list('opportunity_evidence_reviews').length,0);
  assert.equal(db.list('home_opportunity_identity_events').length,8);
 }finally{db.close();await new Promise(r=>server.close(r));closeStore();await new Promise(r=>model.close(r));rmSync(directory,{recursive:true,force:true});}
});
