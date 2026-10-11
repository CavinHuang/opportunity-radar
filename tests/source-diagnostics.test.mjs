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
