import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {scanHomeOpportunities,homeDiscoveryDashboard,homeOpportunitySnapshot,reviewHomeOpportunity} from '../src/home-opportunities.mjs';
const env={RADAR_LLM_BASE_URL:'https://models.example/v1',RADAR_LLM_API_KEY:'fixture',RADAR_LLM_MODEL:'fixture'};
const mock=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([{id:'signal:s1',verdict:'keep',reason:'具体重复劳动的求助'}])}}]})});
test('scan history distinguishes first observation from repeated source signals',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'s1',title:'Cannot automate repetitive invoice workflow for freelancers',description:'I manually move invoices between tools and need an alternative',url:'https://forum.example/post/1',status:'new',createdAt:'2026-10-12T05:00:00Z'});
  const first=await scanHomeOpportunities(db,{env,fetchImpl:mock});
  assert.equal(first.newCount,1);assert.equal(first.repeatCount,0);
  const second=await scanHomeOpportunities(db,{env,fetchImpl:mock});
  assert.equal(second.newCount,0);assert.equal(second.repeatCount,1);
  const history=homeDiscoveryDashboard(db).history;assert.equal(history.length,2);
  assert.deepEqual(history.map(x=>x.newCount).sort(),[0,1]);
 }finally{db.close()}
});
test('human feedback is revision-fenced and never approves an opportunity',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'s1',title:'Cannot automate repetitive invoice workflow for freelancers',description:'I manually move invoices between tools and need an alternative',url:'https://forum.example/post/1',status:'new',createdAt:'2026-10-12T05:00:00Z'});
  await scanHomeOpportunities(db,{env,fetchImpl:mock});
  assert.throws(()=>reviewHomeOpportunity(db,'signal:s1',{verdict:'false_positive',reason:'too short',expected_revision:0}),{code:'REASON_REQUIRED'});
  const row=reviewHomeOpportunity(db,'signal:s1',{verdict:'false_positive',reason:'This is likely promotional content',expected_revision:0});
  assert.equal(homeOpportunitySnapshot(db).items[0].feedback.verdict,'false_positive');
  assert.throws(()=>reviewHomeOpportunity(db,'signal:s1',{verdict:'useful',reason:'Several independent people reported issues',expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.equal(homeDiscoveryDashboard(db).feedbackSummary.falsePositive,1);
  assert.equal(row.revision,1);assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
