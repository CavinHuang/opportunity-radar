import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {addFeed,editFeed,scanSources,sourceDiagnostics} from '../src/source-hub.mjs';

const xml='<rss><channel><item><title>Users need help</title><link>https://example.org/story</link><description>Repeated issue</description></item></channel></rss>';
const dnsLookup=async()=>[{address:'8.8.8.8',family:4}];
const response=(status,body='')=>({status,ok:status>=200&&status<300,headers:new Headers(),body:body?new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(body));c.close();}}):null});

test('diagnostic history is bounded, contains durable events, and handles errors',async()=>{
 const db=openDatabase();try{
  const feed=addFeed(db,{url:'https://example.org/rss'});
  assert.equal(sourceDiagnostics(db).items[0].state,'pending');
  await scanSources(db,{dnsLookup,fetchImpl:async()=>response(200,xml)});
  assert.equal(sourceDiagnostics(db).items[0].state,'healthy');
  await scanSources(db,{dnsLookup,fetchImpl:async()=>response(503)});
  const data=sourceDiagnostics(db,{limit:1}).items[0];
  assert.equal(data.state,'degraded');
  assert.equal(data.recent.length,1);
  assert.equal(data.recent[0].kind,'source.scan_failed');
  assert.ok(data.lastError.includes('503'));
  assert.throws(()=>sourceDiagnostics(db,{limit:31}),{code:'BAD_REQUEST'});
  const updated=editFeed(db,feed.id,{expected_revision:db.get('feeds',feed.id).revision,enabled:false});
  assert.equal(sourceDiagnostics(db).items[0].state,'paused');
  assert.equal(updated.enabled,false);
 }finally{db.close();}
});

test('retry requires failing enabled feed and current revision, and resets health after success',async()=>{
 const db=openDatabase();try{
  const f=addFeed(db,{url:'https://example.org/rss'});
  const {retryFailedFeed}=await import('../src/source-hub.mjs');
  await assert.rejects(retryFailedFeed(db,f.id,{expected_revision:f.revision}),{code:'SOURCE_NOT_FAILING'});
  await scanSources(db,{dnsLookup,fetchImpl:async()=>response(503)});
  const failing=db.get('feeds',f.id);
  await assert.rejects(retryFailedFeed(db,f.id,{expected_revision:f.revision}),{code:'REVISION_CONFLICT'});
  const disabled=editFeed(db,f.id,{expected_revision:failing.revision,enabled:false});
  await assert.rejects(retryFailedFeed(db,f.id,{expected_revision:disabled.revision}),{code:'SOURCE_PAUSED'});
  const enabled=editFeed(db,f.id,{expected_revision:disabled.revision,enabled:true});
  const result=await retryFailedFeed(db,f.id,{expected_revision:enabled.revision},{dnsLookup,fetchImpl:async()=>response(200,xml)});
  assert.equal(result.added,1);
  assert.equal(db.get('feeds',f.id).consecutiveFailures,0);
 }finally{db.close();}
});

test('three consecutive failures create warning and recovery clears it',async()=>{
 const db=openDatabase();try{
  const f=addFeed(db,{url:'https://example.org/rss'});
  for(let i=0;i<3;i++)await scanSources(db,{dnsLookup,fetchImpl:async()=>response(503)});
  const warning=sourceDiagnostics(db).items.find(x=>x.feedId===f.id);
  assert.equal(warning.alert?.code,'REPEATED_FAILURE');
  assert.equal(warning.consecutiveFailures,3);
  await scanSources(db,{dnsLookup,fetchImpl:async()=>response(200,xml)});
  const healthy=sourceDiagnostics(db).items.find(x=>x.feedId===f.id);
  assert.equal(healthy.alert,null);
  assert.ok(healthy.recoveredAt);
  assert.equal(healthy.state,'healthy');
 }finally{db.close();}
});
