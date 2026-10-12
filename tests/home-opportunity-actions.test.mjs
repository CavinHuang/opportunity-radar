import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {homeOpportunitySnapshot,scanHomeOpportunities,decideHomeOpportunity} from '../src/home-opportunities.mjs';
test('save, dismiss and revision fencing never modify original signals',async()=>{
 const db=openDatabase();try{
  const signal=db.put('sources',{id:'s1',title:'Cannot automate repetitive invoice workflow for freelancers',description:'Every day I manually move invoices between tools and look for an alternative',url:'https://forum.example/post/1',status:'new',createdAt:'2026-10-12T04:00:00Z'});
  const scanned=await scanHomeOpportunities(db,{env:{RADAR_LLM_BASE_URL:'https://models.example/v1',RADAR_LLM_API_KEY:'fake',RADAR_LLM_MODEL:'test'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([{id:'signal:s1',verdict:'keep',reason:'有具体手动整理的问题'}])}}]})})});
  assert.equal(scanned.items.length,1);
  const saved=decideHomeOpportunity(db,'signal:s1',{action:'save',expected_revision:0});
  assert.equal(homeOpportunitySnapshot(db).items[0].decision.action,'save');
  assert.throws(()=>decideHomeOpportunity(db,'signal:s1',{action:'dismiss',expected_revision:0}),{code:'REVISION_CONFLICT'});
  decideHomeOpportunity(db,'signal:s1',{action:'dismiss',expected_revision:saved.revision});
  assert.equal(homeOpportunitySnapshot(db).items.length,0);
  assert.equal(db.get('sources','s1').revision,signal.revision);
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
