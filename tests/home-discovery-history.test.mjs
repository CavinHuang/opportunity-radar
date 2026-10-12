import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {homeDiscoveryDashboard,decideHomeOpportunity,scanHomeOpportunities} from '../src/home-opportunities.mjs';
test('real scan history and funnel counts, save/dismiss/restore never promote opportunities',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'s1',title:'Cannot automate repetitive invoice workflow for freelancers',description:'I manually move invoices between tools and need an alternative',url:'https://forum.example/post/1',status:'new',createdAt:'2026-10-12T05:00:00Z'});
  const env={RADAR_LLM_BASE_URL:'https://models.example/v1',RADAR_LLM_API_KEY:'test',RADAR_LLM_MODEL:'fixture'};
  await scanHomeOpportunities(db,{env,scanStats:{feeds:1,received:2,added:1},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([{id:'signal:s1',verdict:'keep',reason:'明确的重复劳动'}])}}]})})});
  let view=homeDiscoveryDashboard(db);assert.equal(view.history.length,1);assert.equal(view.history[0].scanStats.added,1);assert.equal(view.funnel.aiAccepted,1);
  const saved=decideHomeOpportunity(db,'signal:s1',{action:'save',expected_revision:0});assert.equal(homeDiscoveryDashboard(db).saved.length,1);
  const dismissed=decideHomeOpportunity(db,'signal:s1',{action:'dismiss',expected_revision:saved.revision});view=homeDiscoveryDashboard(db);assert.equal(view.dismissed.length,1);assert.equal(view.funnel.visible,0);
  decideHomeOpportunity(db,'signal:s1',{action:'restore',expected_revision:dismissed.revision});view=homeDiscoveryDashboard(db);assert.equal(view.dismissed.length,0);assert.equal(view.funnel.visible,1);
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
test('empty history remains empty rather than synthetic',()=>{const db=openDatabase();try{assert.deepEqual(homeDiscoveryDashboard(db).history,[]);}finally{db.close()}});
