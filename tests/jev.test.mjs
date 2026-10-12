import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'radar-jev-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
process.env.RADAR_OWNER_TOKEN='jev-owner';
process.env.RADAR_AGENT_TOKEN='jev-agent';
process.env.JEV_API_KEY='jv_test_key';

test('jevSystemOne sends model+state+questions and extracts typed answers',async()=>{
 let captured=null;
 const mockFetch=async(url,opts)=>{
  captured={url:String(url),body:JSON.parse(opts.body)};
  const fake={answers:{
   is_consumer_problem:{type:'noul',noul:0.97},
   topic:{type:'choice',choice:'product_friction',confidence:0.92}}};
  const body=JSON.stringify(fake);
  return {ok:true,status:200,json:async()=>fake,text:async()=>body};
 };
 const {jevSystemOne,extractAnswer}=await import('../src/jev.mjs');
 const questions={
  is_consumer_problem:{type:'noul',instructions:'Is this a consumer problem?',criteria:{true:'Yes',false:'No'}},
  topic:{type:'choice',instructions:'Category?',criteria:{product_friction:'Product friction',announcement:'Announcement'}}};
 const result=await jevSystemOne('User complains about app crashing',questions,
  {apiKey:'test-key',apiUrl:'https://openrouter.ai/api/alpha/decisions',model:'~typesafe/jev-latest',fetchImpl:mockFetch});
 assert.ok(captured,'fetch was called');
 assert.equal(captured.url,'https://openrouter.ai/api/alpha/decisions');
 assert.equal(captured.body.model,'~typesafe/jev-latest');
 assert.equal(captured.body.state,'User complains about app crashing');
 assert.ok(captured.body.questions.is_consumer_problem);
 const topic=extractAnswer(result,'topic');
 assert.equal(topic.type,'choice');
 assert.equal(topic.value,'product_friction');
 const noul=extractAnswer(result,'is_consumer_problem');
 assert.equal(noul.value,0.97);
 assert.equal(noul.type,'noul');
});
