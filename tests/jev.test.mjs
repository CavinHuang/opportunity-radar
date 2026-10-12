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
process.env.JEV_API_URL='https://jev.test/api/v1';
const {jevSystemOne,extractAnswer}=await import('../src/jev.mjs');

test('jevSystemOne calls System One API and extracts typed answers',async()=>{
 const calls=[];
 const mockFetch=async(url,opts)=>{
  calls.push({url:String(url),body:JSON.parse(opts.body)});
  return {ok:true,status:200,json:async()=>({results:[{answers:{
   is_consumer_problem:{type:'noul',noul:0.97},
   topic:{type:'choice',choice:'product_friction',confidence:0.92},
   strength:{type:'score',score:1.5,legend:{'0':'Weak','3':'Strong'}},
  }}]}),text:async()=>JSON.stringify({results:[{answers:{
   is_consumer_problem:{type:'noul',noul:0.97}}}]})};
 };
 const result=await jevSystemOne('signal title and description',{
  is_consumer_problem:{type:'noul',instructions:'test',criteria:{true:'yes',false:'no'}},
  topic:{type:'choice',instructions:'test',criteria:{product_friction:'friction',announcement:'news'}},
  strength:{type:'score',instructions:'test',criteria:['Weak','Moderate','Strong']},
 },{apiKey:'test-key',apiUrl:'https://jev.test/api/v1',fetchImpl:mockFetch});
 const topic=extractAnswer(result,'topic');
 assert.equal(topic.type,'choice');
 assert.equal(topic.value,'product_friction');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://jev.test/api/v1/systemone');
 assert.equal(calls[0].body.state,'signal title and description');
 assert.ok(calls[0].body.questions.is_consumer_problem);
});

test('Jev signal pre-filter dismisses noise and keeps consumer problems via scan pipeline',async()=>{
 const {openDatabase}=await import('../src/db.mjs');
 const {addFeed,scanSources}=await import('../src/source-hub.mjs');
 const db=openDatabase(dir+'/db2.sqlite');
 const xml='<rss><channel><item><title>My app keeps crashing on import</title><link>https://example.org/jev/1</link><description>App crashes when importing large files</description></item><item><title>We are hiring engineers</title><link>https://example.org/jev/2</link><description>Join our team</description></item></channel></rss>';
 const feedXml=()=>({ok:true,status:200,headers:new Headers(),
  body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(xml));c.close();}})});
 const dnsPublic=async()=>[{address:'93.184.216.34',family:4}];
 // Jev System One mock：state 含 hiring → noise (P=0.03)；否则 keep (P=0.97)
 const oldFetch=globalThis.fetch;
 let jevCalls=0;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).includes('/systemone')){
   jevCalls++;
   const body=JSON.parse(opts.body);
   const isNoise=String(body.state).includes('hiring');
   return {ok:true,status:200,json:async()=>({results:[{answers:{
    is_consumer_problem:{type:'noul',noul:isNoise?0.03:0.97}}}]})};
  }
  return oldFetch(url,opts);
 };
 try{
  const feed=addFeed(db,{url:'https://example.org/jev-rss',title:'Jev Test Source',market:'Test',keywords:[]});
  const result=await scanSources(db,{fetchImpl:feedXml,dnsLookup:dnsPublic});
  assert.equal(result.added,1,'consumer problem added to queue');
  assert.equal(result.modelFiltered,1,'noise auto-dismissed by Jev');
  const signals=db.list('sources');
  const crashing=signals.find(x=>x.title.includes('crashing'));
  const hiring=signals.find(x=>x.title.includes('hiring'));
  assert.ok(crashing&&hiring,'both signals exist');
  assert.equal(crashing.status,'new','consumer problem stays in queue');
  assert.equal(hiring.status,'dismissed','noise auto-dismissed');
  assert.equal(hiring.triageBy,'model_filter');
  assert.ok(hiring.filterReason.includes('Jev'),'filterReason records model assessment');
 }finally{
  globalThis.fetch=oldFetch;
  db.close();
  rmSync(dir,{recursive:true,force:true});
 }
});
