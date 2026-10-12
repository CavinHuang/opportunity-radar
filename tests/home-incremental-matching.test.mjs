import test from 'node:test';import assert from 'node:assert/strict';
import {compareOpportunityChange,scanHomeOpportunities} from '../src/home-opportunities.mjs';
import {openDatabase} from '../src/db.mjs';
test('same source unchanged; new link is new evidence',()=>{
 const old=[{id:'signal:1',title:'Cannot automate weekly invoice workflow efficiently',sourceUrls:['https://one.example/a']}];
 assert.equal(compareOpportunityChange({...old[0]},old).novelty,'seen_before');
 const newer={id:'signal:2',title:'Cannot automate weekly invoice workflow efficiently',sourceUrls:['https://two.example/b']};
 const result=compareOpportunityChange(newer,old);assert.equal(result.novelty,'new_evidence');assert.equal(result.relatedTo,'signal:1');
});
test('unrelated issue is first seen, without claiming independent demand',()=>{
 const result=compareOpportunityChange({id:'z',title:'Planning a garden with native trees',sourceUrls:['https://example.org/new']},[{id:'x',title:'Automating invoice workflows in accounting',sourceUrls:['https://example.org/old']}]);
 assert.equal(result.novelty,'new_since_previous_scan');assert.match(result.changeReason,/此前成功扫描/);
});
test('only previous successful AI candidates form novelty baseline; feedback is sent as bounded calibration',async()=>{
 const db=openDatabase();try{
 db.put('sources',{id:'s1',title:'Cannot automate repetitive invoice workflow for freelancers',description:'I manually move invoices and need an alternative',url:'https://forum.example/post/1',status:'new'});
 let captured=null;const env={RADAR_LLM_BASE_URL:'https://models.example/v1',RADAR_LLM_API_KEY:'fake',RADAR_LLM_MODEL:'test'};
 const fetchImpl=async(_url,opts)=>{captured=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([{id:'signal:s1',verdict:'keep',reason:'具体重复工作'}])}}]})}};
 const one=await scanHomeOpportunities(db,{env,fetchImpl});assert.equal(one.newCount,1);
 db.put('home_opportunity_feedback',{id:'signal:s1',verdict:'false_positive',reason:'This looked like a promotion',at:'2026-10-12T04:00:00Z'});
 const two=await scanHomeOpportunities(db,{env,fetchImpl});assert.equal(two.repeatCount,1);
 assert.match(captured.messages[1].content,/ownerFeedbackForCalibration/);assert.match(captured.messages[1].content,/This looked like a promotion/);
 assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
