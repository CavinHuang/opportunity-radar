import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {scanHomeOpportunities,homeOpportunitySnapshot,homeDiscoveryDashboard} from '../src/home-opportunities.mjs';

const env={RADAR_LLM_BASE_URL:'https://api.deepseek.com',RADAR_LLM_MODEL:'deepseek-chat',RADAR_LLM_API_KEY:'synthetic-private-key'};
function setup(count=8,path){
 const db=openDatabase(path);
 for(let i=0;i<count;i++){
  const words=createHash('sha256').update(String(i)).digest('hex').slice(0,32).replace(/\d/g,d=>String.fromCharCode(103+Number(d))).match(/.{8}/g).join(' ');
  db.put('sources',{id:'s'+i,title:words+' upload issue',description:'I manually upload files every day and lose 2 hours because the upload fails.',url:'https://forum.example/'+i,status:'new'});
 }
 return db;
}
const rows=options=>JSON.parse(JSON.parse(options.body).messages[1].content).candidates;
const reply=items=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(items.map(x=>({id:x.id,verdict:'keep',reason:'用户描述了反复发生的工作障碍'})))}}]})});
const good=async(url,options)=>reply(rows(options));
const unavailable=async()=>({ok:false,status:503});

test('a failed fresh scan preserves only exact prior sources, labels retained results and does not count a new discovery',async()=>{
 const db=setup();try{
  const first=await scanHomeOpportunities(db,{env,fetchImpl:good});assert.equal(first.items.length,8);
  const s=db.get('sources','s0');db.put('sources',{...s,description:s.description+' Changed evidence.'},s.revision);
  const failed=await scanHomeOpportunities(db,{env,fetchImpl:unavailable});
  assert.equal(failed.status,'filter_failed');assert.equal(failed.accepted,0);assert.equal(failed.retainedCount,7);
  assert.equal(failed.items.length,7);assert.equal(failed.newCount,0);assert.equal(failed.analysis.unclassified,8);
  assert.ok(failed.items.every(x=>x.retainedFromPrevious&&x.analyzedAt===first.items.find(y=>y.id===x.id).analyzedAt));
  assert.equal(homeDiscoveryDashboard(db).history[0].retainedCount,7);
  const again=await scanHomeOpportunities(db,{env,fetchImpl:unavailable});assert.equal(again.items.length,7);
  assert.equal(db.list('home_opportunity_identity_events').length,8);
  const hidden=db.get('sources','s1');db.put('sources',{...hidden,status:'dismissed'},hidden.revision);
  assert.equal(homeOpportunitySnapshot(db).retainedCount,6);
 }finally{db.close();}
});

test('retries resume partial results across database reopen and do not inflate observations or create opportunities',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-home-resume-')),path=join(directory,'db.sqlite');
 let db=setup(12,path),calls=0,failedIds=[];
 try{
  const partial=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>{
   const batch=rows(options);if(++calls===2){failedIds=batch.map(x=>x.id);return unavailable();}return reply(batch);
  }});
  assert.equal(partial.accepted,8);assert.equal(partial.analysis.unclassified,4);
  assert.ok(!JSON.stringify(db.get('home_analysis_checkpoints','latest')).includes(env.RADAR_LLM_API_KEY));
  db.close();db=openDatabase(path);calls=0;
  const retry=await scanHomeOpportunities(db,{env,retryIncomplete:true,fetchImpl:async(url,options)=>{
   calls++;assert.deepEqual(rows(options).map(x=>x.id),failedIds);return reply(rows(options));
  }});
  assert.equal(calls,1);assert.equal(retry.status,'filtered');assert.equal(retry.items.length,12);
  assert.equal(retry.analysis.reused,8);assert.equal(retry.analysis.attempted,4);
  assert.equal(db.list('home_opportunity_identity_events').length,12);
  assert.ok(db.list('home_opportunity_identities').every(x=>x.observations===1));
  const reused=await scanHomeOpportunities(db,{env,retryIncomplete:true,fetchImpl:()=>assert.fail('all completed; no model request')});
  assert.equal(reused.analysis.reused,12);assert.equal(reused.analysis.attempted,0);
  assert.equal(db.list('home_opportunity_identity_events').length,12);assert.equal(db.list('opportunities').length,0);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('resume invalidates complete source text, model, endpoint, feedback and checkpoint policy',async()=>{
 for(const change of ['source','model','endpoint','feedback','policy']){
  const db=setup();let calls=0;try{
   await scanHomeOpportunities(db,{env,fetchImpl:good});let nextEnv={...env};
   if(change==='source'){const s=db.get('sources','s0');db.put('sources',{...s,description:s.description+' '.repeat(2000)+' New important detail.'},s.revision);}
   if(change==='model')nextEnv.RADAR_LLM_MODEL='another-model';
   if(change==='endpoint')nextEnv.RADAR_LLM_BASE_URL='https://other-model.example/v1';
   if(change==='feedback')db.put('home_opportunity_feedback',{id:'signal:s1',verdict:'false_positive',reason:'当前问题应先核对已有工具是否已经解决'});
   if(change==='policy'){const c=db.get('home_analysis_checkpoints','latest');db.put('home_analysis_checkpoints',{...c,policy:'old'},c.revision);}
   const retry=await scanHomeOpportunities(db,{env:nextEnv,retryIncomplete:true,fetchImpl:async(url,options)=>{calls++;return reply(rows(options));}});
   assert.equal(retry.analysis.reused,change==='source'?7:0,change);assert.equal(calls,change==='source'?1:2,change);
   assert.equal(retry.status,'filtered');
  }finally{db.close();}
 }
});

test('evidence edited while a model is running cannot be checkpointed or shown as a current result',async()=>{
 const db=setup(4);let changed;try{
  const partial=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>{
   const batch=rows(options);changed=batch[0].originals[0].sourceId;const s=db.get('sources',changed);
   db.put('sources',{...s,description:s.description+' Updated during model call.'},s.revision);return reply(batch);
  }});
  assert.equal(partial.status,'filtered_partial');assert.equal(partial.items.length,3);assert.equal(partial.analysis.unclassified,1);
  assert.ok(!db.get('home_analysis_checkpoints','latest').entries.some(x=>x.id==='signal:'+changed));
  let count=0;const retry=await scanHomeOpportunities(db,{env,retryIncomplete:true,fetchImpl:async(url,options)=>{count+=rows(options).length;return reply(rows(options));}});
  assert.equal(count,1);assert.equal(retry.items.length,4);
 }finally{db.close();}
});

test('concurrent retries share one model invocation and release their lock after completion',async()=>{
 const db=setup(4);let release,calls=0;try{
  const options={env,retryIncomplete:true,fetchImpl:async(url,options)=>{calls++;await new Promise(r=>{release=r;});return reply(rows(options));}};
  const first=scanHomeOpportunities(db,options),second=scanHomeOpportunities(db,options);
  assert.equal(first,second);release();await Promise.all([first,second]);assert.equal(calls,1);
  await scanHomeOpportunities(db,{...options,fetchImpl:()=>assert.fail('completed checkpoint must be reused')});
 }finally{db.close();}
});

test('Jev partial failures checkpoint valid judgments while malformed answers remain retryable',async()=>{
 const db=setup(4),jev={OPENROUTER_API_KEY:'fake-router-key'};let calls=0;try{
  const partial=await scanHomeOpportunities(db,{env:jev,fetchImpl:async()=>({ok:true,json:async()=>++calls===2?{answers:{}}:{answers:{is_product_friction:{noul:0.9}}}})});
  assert.equal(partial.status,'filtered_partial');assert.equal(partial.analysis.classified,3);assert.equal(partial.analysis.unclassified,1);
  calls=0;const retry=await scanHomeOpportunities(db,{env:jev,retryIncomplete:true,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({answers:{is_product_friction:{noul:0.9}}})};}});
  assert.equal(calls,1);assert.equal(retry.analysis.reused,3);assert.equal(retry.items.length,4);
 }finally{db.close();}
});

test('completed noise and uncertain judgments are reused and cannot resurrect a previous keep result',async()=>{
 const db=setup(4);try{
  await scanHomeOpportunities(db,{env,fetchImpl:good});
  const noKeeps=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(rows(options).map((x,i)=>({id:x.id,verdict:i%2?'noise':'uncertain',reason:'需要更多证据，不应推荐投入'})))}}]})})});
  assert.equal(noKeeps.status,'filtered');assert.equal(noKeeps.items.length,0);assert.equal(noKeeps.retainedCount,0);
  const retry=await scanHomeOpportunities(db,{env,retryIncomplete:true,fetchImpl:()=>assert.fail('all four judgments are complete')});
  assert.equal(retry.analysis.reused,4);assert.equal(retry.items.length,0);
 }finally{db.close();}
});
