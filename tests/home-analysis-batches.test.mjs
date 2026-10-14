import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {scanHomeOpportunities,homeDiscoveryDashboard} from '../src/home-opportunities.mjs';
import {problemWorkQueue} from '../src/problem-work-queue.mjs';

const env={RADAR_LLM_BASE_URL:'https://model.example/v1',RADAR_LLM_API_KEY:'synthetic-batch-secret',RADAR_LLM_MODEL:'test'};
function setup(count=12){
 const db=openDatabase();
 for(let i=0;i<count;i++){
  const words=createHash('sha256').update(String(i)).digest('hex').slice(0,32).replace(/\d/g,d=>String.fromCharCode(103+Number(d))).match(/.{8}/g).join(' ');
  db.put('sources',{id:'s'+i,title:words+' upload issue',description:'I manually upload files every day and lose 2 hours because the upload fails.',url:'https://forum.example/'+i,status:'new'});
 }
 return db;
}
const input=options=>JSON.parse(JSON.parse(options.body).messages[1].content).candidates;
const reply=(rows,finish_reason='stop')=>({ok:true,json:async()=>({choices:[{finish_reason,message:{content:JSON.stringify(rows.map(x=>({id:x.id,verdict:'keep',reason:'Repeated task needs investigation'})))}}]})});

test('a failed middle batch keeps completed candidates visible and records incomplete analysis without exposing secrets',async()=>{
 const db=setup();let calls=0;try{
  const scan=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>{
   const rows=input(options);assert.ok(rows.length<=4);
   if(++calls===2)throw new Error('synthetic-batch-secret upstream request failure');
   return reply(rows);
  }});
  assert.equal(calls,3);assert.equal(scan.status,'filtered_partial');assert.equal(scan.accepted,8);
  assert.equal(scan.analysis.classified,8);assert.equal(scan.analysis.unclassified,4);
  assert.deepEqual(scan.analysis.failedBatchIndexes,[1]);
  assert.equal(problemWorkQueue(db).discover.count,8);
  assert.equal(homeDiscoveryDashboard(db).history[0].analysis.complete,false);
  assert.ok(!JSON.stringify(scan).includes(env.RADAR_LLM_API_KEY));
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close();}
});
test('a missing model verdict is unclassified, not a noise judgment or successful complete scan',async()=>{
 const db=setup(4);try{
  const scan=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>reply(input(options).slice(0,3))});
  assert.equal(scan.status,'filtered_partial');assert.equal(scan.analysis.unclassified,1);
  assert.equal(scan.items.length,3);assert.deepEqual(scan.analysis.failedBatchIndexes,[]);
 }finally{db.close();}
});
test('token-truncated model output cannot count as a completed batch even if its JSON parses',async()=>{
 const db=setup(8);let calls=0;try{
  const scan=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>reply(input(options),++calls===1?'length':'stop')});
  assert.equal(scan.status,'filtered_partial');assert.equal(scan.analysis.classified,4);
  assert.deepEqual(scan.analysis.failedBatchIndexes,[0]);
 }finally{db.close();}
});
test('all failed batches produce an explicit failure; all successful batches produce a complete scan',async()=>{
 const db=setup(8);try{
  const failed=await scanHomeOpportunities(db,{env,fetchImpl:async()=>({ok:false,status:503})});
  assert.equal(failed.status,'filter_failed');assert.equal(failed.items.length,0);
  const good=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>reply(input(options))});
  assert.equal(good.status,'filtered');assert.equal(good.analysis.complete,true);
  assert.equal(good.analysis.batchCount,2);assert.equal(good.items.length,8);
 }finally{db.close();}
});
