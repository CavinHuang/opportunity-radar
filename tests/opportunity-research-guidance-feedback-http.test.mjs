import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';

test('real HTTP owner guidance feedback: auth, idempotency, follow-up fencing and SQLite persistence',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-guidance-http-'));
 const file=join(directory,'radar.sqlite');
 process.env.RADAR_DB=file;
 process.env.RADAR_OWNER_TOKEN='guidance-http-owner-test';
 const {createServer,closeStore}=await import('../src/server.mjs');
 const server=createServer();
 const started=await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const id='fixture:guidance-http';
 const path='/api/opportunity-scan/'+encodeURIComponent(id)+'/research-guidance/feedback';
 const headers={'Content-Type':'application/json','X-Radar-Owner-Key':'guidance-http-owner-test'};
 const request=async(url,method='GET',body,extra={})=>{
  const r=await fetch(base+url,{method,headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 };
 const db=openDatabase(file);
 try{
  db.put('opportunity_weekly_plans',{id:'week:2026-10-12',weekStart:'2026-10-12',status:'planned',
   items:[{candidateId:id,title:'真实研究问题',task:'安排观察访谈并记录具体行为',hours:2,budget:0}]});
  assert.equal((await request(path,'GET',undefined,{'X-Radar-Owner-Key':'wrong'})).status,401);
  assert.equal((await request(path,'POST',{}, {'X-Radar-Owner-Key':'wrong'})).status,401);
  assert.equal((await request(path,'POST',{}, {Origin:'https://untrusted.example'})).status,403);
  const board=await request(path);
  assert.equal(board.status,200);
  assert.equal(board.data.summary.total,0);
  const payload={fingerprint:board.data.fingerprint,response:'accepted',
   reason:'先采纳寻找真实用户行为记录的建议并进行核实'};
  const first=await request(path,'POST',payload,{'Idempotency-Key':'http-guidance-1'});
  assert.equal(first.status,201);
  const replay=await request(path,'POST',payload,{'Idempotency-Key':'http-guidance-1'});
  assert.equal(replay.status,201);
  assert.equal(replay.data.item.id,first.data.item.id);
  assert.equal((await request(path,'POST',payload)).status,409);
  assert.equal((await request(path)).data.summary.total,1);
  const followupPath=path+'/'+encodeURIComponent(first.data.item.id)+'/followup';
  const followup={assessment:'uncertain',notes:'观察已发生，但尚未形成足够可靠的独立行为证据',
   actualHours:2,evidenceUrl:'https://example.org/study',expected_revision:first.data.item.revision};
  assert.equal((await request(followupPath,'POST',{...followup,expected_revision:0})).status,409);
  const result=await request(followupPath,'POST',followup);
  assert.equal(result.status,200);
  assert.equal(result.data.item.followup.selfReported,true);
  assert.equal((await request(followupPath,'POST',{...followup,expected_revision:result.data.item.revision})).status,409);
  assert.equal((await request(path)).data.summary.followedUp,1);
  assert.equal(db.list('opportunity_research_guidance_feedback').length,1);
 }finally{
  db.close();
  await new Promise(resolve=>server.close(resolve));
  closeStore();
  rmSync(directory,{recursive:true,force:true});
 }
});
