import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {homeOpportunitySnapshot,scanHomeOpportunities} from '../src/home-opportunities.mjs';
function setup(){const db=openDatabase();db.put('sources',{id:'s1',title:'Cannot automate repetitive invoice workflow for freelancers',description:'Every day I manually move invoices between tools and look for an alternative',url:'https://forum.example/post/1',status:'new',createdAt:'2026-10-12T04:00:00Z'});db.put('sources',{id:'s2',title:'New product announcement and marketing press release',description:'Our startup just launched a product today',url:'https://forum.example/post/2',status:'new',createdAt:'2026-10-12T04:01:00Z'});return db}
const env={RADAR_LLM_BASE_URL:'https://models.example/v1',RADAR_LLM_API_KEY:'fake',RADAR_LLM_MODEL:'test'};
test('without AI config the homepage does not falsely call raw signals AI filtered',async()=>{const db=setup();try{const d=await scanHomeOpportunities(db,{env:{}});assert.equal(d.status,'not_configured');assert.deepEqual(d.items,[]);assert.equal(db.list('opportunities').length,0);}finally{db.close()}});
test('AI only approved keep verdicts appear in persisted homepage without promoting a project',async()=>{const db=setup();try{
 const body=[{id:'signal:s1',verdict:'keep',reason:'报告手动转录账单耗时'},{id:'signal:s2',verdict:'noise',reason:'纯营销发布'}];
 const d=await scanHomeOpportunities(db,{env,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(body)}}]})})});
 assert.equal(d.status,'filtered');assert.equal(d.items.length,1);assert.match(d.items[0].aiReason,/账单/);assert.equal(d.items[0].reviewStatus,'unverified');
 assert.equal(homeOpportunitySnapshot(db).items.length,1);assert.equal(db.list('opportunities').length,0);
 const s=db.get('sources','s1');db.put('sources',{...s,status:'dismissed'},s.revision);
 assert.equal(homeOpportunitySnapshot(db).items.length,0);
 }finally{db.close()}});
test('broken AI output fails visibly without inventing accepted candidates',async()=>{const db=setup();try{const d=await scanHomeOpportunities(db,{env,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})})});assert.equal(d.status,'filter_failed');assert.equal(d.items.length,0);}finally{db.close()}});
