import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {addFeed,editFeed,scanSources,sourceHealth} from '../src/source-hub.mjs';
import {createSourceScheduler} from '../src/source-scheduler.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const now=Date.parse('2026-10-10T09:00:00Z');
const xml='<rss><channel><item><title>Consumers want better receipts</title><link>https://example.org/topic/1</link><description>Receipts are difficult to find</description></item></channel></rss>';
const response=(status,body,headers={})=>({ok:status>=200&&status<300,status,headers:new Headers(headers),body:body?new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(body));c.close();}}):null});
const publicDNS=async()=>[{address:'8.8.8.8'}];

test('conditional requests avoid downloads and preserve saved triage',async()=>{
 const db=openDatabase();try{
   const f=addFeed(db,{url:'https://example.org/rss',intervalMinutes:120});
   const seen=[];
   const fetched=async(url,options)=>{seen.push(options.headers);return seen.length===1?response(200,xml,{etag:'"stable-1"','last-modified':'Sat, 10 Oct 2026 00:00:00 GMT'}):response(304,null);};
   const first=await scanSources(db,{fetchImpl:fetched,dnsLookup:publicDNS,nowMs:now});
   assert.equal(first.added,1);assert.equal(db.get('feeds',f.id).nextScanAt,'2026-10-10T11:00:00.000Z');
   const signal=db.list('sources')[0];db.put('sources',{...signal,status:'saved'},signal.revision);
   const early=await scanSources(db,{onlyDue:true,fetchImpl:fetched,dnsLookup:publicDNS,nowMs:now+60000});
   assert.equal(early.feeds,0);
   const second=await scanSources(db,{onlyDue:true,fetchImpl:fetched,dnsLookup:publicDNS,nowMs:now+120*60000});
   assert.equal(second.notModified,1);assert.equal(second.added,0);assert.equal(db.list('sources')[0].status,'saved');
   assert.equal(seen[1]['If-None-Match'],'"stable-1"');assert.equal(seen[1]['If-Modified-Since'],'Sat, 10 Oct 2026 00:00:00 GMT');
   assert.equal(db.get('feeds',f.id).consecutiveFailures,0);
 }finally{db.close();}
});

test('repeated failures back off, persist, and successful polling resets health',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-feed-'));const path=join(dir,'data.sqlite');
 let db=openDatabase(path);let id;
 try{
   const feed=addFeed(db,{url:'https://example.org/rss',intervalMinutes:30});id=feed.id;
   const fail=async()=>response(503,null,{'retry-after':'7200'});
   const one=await scanSources(db,{fetchImpl:fail,dnsLookup:publicDNS,nowMs:now});
   assert.equal(one.errors.length,1);
   assert.equal(db.get('feeds',id).consecutiveFailures,1);
   assert.equal(db.get('feeds',id).nextScanAt,'2026-10-10T11:00:00.000Z');
   db.close();db=openDatabase(path);
   assert.equal(sourceHealth(db,now+60000).due,0);
   const two=await scanSources(db,{onlyDue:true,fetchImpl:fail,dnsLookup:publicDNS,nowMs:now+7200000});
   assert.equal(two.errors.length,1);assert.equal(db.get('feeds',id).consecutiveFailures,2);
   const ok=await scanSources(db,{fetchImpl:async()=>response(200,xml),dnsLookup:publicDNS,nowMs:now+7500000});
   assert.equal(ok.added,1);assert.equal(db.get('feeds',id).consecutiveFailures,0);
   assert.equal(db.get('feeds',id).lastError,null);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('concurrent scans are explicitly rejected, preserving one writer',async()=>{
 const db=openDatabase();try{
  addFeed(db,{url:'https://example.org/rss'});
  let unblock;
  const started=new Promise(resolve=>{unblock=resolve;});let entered;
  const hasEntered=new Promise(resolve=>{entered=resolve;});
  const pending=scanSources(db,{dnsLookup:publicDNS,fetchImpl:async()=>{entered();await started;return response(200,xml)}});
  await hasEntered;
  await assert.rejects(scanSources(db,{dnsLookup:publicDNS,fetchImpl:async()=>response(200,xml)}),{code:'SCAN_IN_PROGRESS'});
  unblock();const result=await pending;assert.equal(result.added,1);
 }finally{db.close();}
});

test('source schedule is validated and re-enabling a paused feed makes it due',()=>{
 const db=openDatabase();try{
   assert.throws(()=>addFeed(db,{url:'https://example.org/rss',intervalMinutes:1}),{code:'BAD_SCAN_INTERVAL'});
   let f=addFeed(db,{url:'https://example.org/rss',intervalMinutes:45});
   assert.equal(f.intervalMinutes,45);
   f=editFeed(db,f.id,{expected_revision:f.revision,enabled:false});
   f=editFeed(db,f.id,{expected_revision:f.revision,enabled:true,intervalMinutes:15});
   assert.equal(f.nextScanAt,null);assert.equal(sourceHealth(db).due,1);
 }finally{db.close();}
});

test('scheduler resumes persisted due feeds without requiring full-time Agent sessions',async()=>{
 const db=openDatabase();try{
  addFeed(db,{url:'https://example.org/rss',intervalMinutes:360});
  let calls=0;
  const scheduler=createSourceScheduler(db,{clock:()=>now,scan:async(store,{onlyDue})=>{
    calls++;assert.equal(onlyDue,true);
    return scanSources(store,{onlyDue:true,nowMs:now,dnsLookup:publicDNS,fetchImpl:async()=>response(200,xml)});
  },logger:{info(){},error(){}},intervalMs:1000});
  const one=await scheduler.tick();assert.equal(one.added,1);
  const two=await scheduler.tick();assert.equal(two.skipped,true);assert.equal(calls,1);
  scheduler.start();scheduler.stop();
 }finally{db.close();}
});


test('changing keyword filters invalidates conditional cache to evaluate previously skipped articles',async()=>{
 const db=openDatabase();try{
  let f=addFeed(db,{url:'https://example.org/rss',keywords:'not-matched'});
  await scanSources(db,{fetchImpl:async()=>response(200,xml,{etag:'\"v1\"'}),dnsLookup:publicDNS,nowMs:now});
  assert.equal(db.list('sources').length,0);
  f=db.get('feeds',f.id);assert.equal(f.etag,'\"v1\"');
  f=editFeed(db,f.id,{expected_revision:f.revision,keywords:'receipts'});
  assert.equal(f.etag,null);assert.equal(f.nextScanAt,null);
  await scanSources(db,{onlyDue:true,fetchImpl:async(url,opts)=>{assert.equal(opts.headers['If-None-Match'],undefined);return response(200,xml)},dnsLookup:publicDNS,nowMs:now+1000});
  assert.equal(db.list('sources').length,1);
 }finally{db.close();}
});

test('cache validators are not forwarded across redirect to another domain',async()=>{
 const db=openDatabase();try{
  let f=addFeed(db,{url:'https://example.org/rss'});
  let calls=0;
  await scanSources(db,{fetchImpl:async()=>response(200,xml,{etag:'\"private-origin\"'}),dnsLookup:publicDNS,nowMs:now});
  const mock=async(url,opts)=>{calls++;if(calls===1){assert.equal(opts.headers['If-None-Match'],'\"private-origin\"');return {status:302,headers:new Headers({location:'https://other.example.net/feed'}),body:null}};assert.equal(opts.headers['If-None-Match'],undefined);return response(200,xml)};
  const result=await scanSources(db,{fetchImpl:mock,dnsLookup:publicDNS,nowMs:now+1});
  assert.equal(result.errors.length,0);assert.equal(calls,2);
 }finally{db.close();}
});

test('scan audit emits durable success, failure, and skip events with no stale signal imports',async()=>{
 const db=openDatabase();try{
  const feed=addFeed(db,{url:'https://example.org/rss'});
  await scanSources(db,{fetchImpl:async()=>response(200,xml),dnsLookup:publicDNS,nowMs:now});
  let audit=db.events().filter(x=>x.kind.startsWith('source.scan_'));
  assert.equal(audit.length,1);
  assert.equal(audit[0].kind,'source.scan_succeeded');
  assert.equal(audit[0].entity_id,feed.id);
  assert.equal(audit[0].detail.added,1);
  await scanSources(db,{fetchImpl:async()=>response(503,null),dnsLookup:publicDNS,nowMs:now+1000});
  audit=db.events().filter(x=>x.kind.startsWith('source.scan_'));
  assert.equal(audit[1].kind,'source.scan_failed');
  assert.equal(audit[1].detail.consecutiveFailures,1);
  assert.ok(audit[1].detail.nextScanAt);
  assert.equal(db.list('sources').length,1);
 }finally{db.close();}
});
test('stale scan audit distinguishes dropped network response from scan failure',async()=>{
 const db=openDatabase();try{
  const feed=addFeed(db,{url:'https://example.org/rss'});
  let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const pending=scanSources(db,{dnsLookup:publicDNS,fetchImpl:async()=>{entered();await gate;return response(200,xml);}});
  await started;
  const current=db.get('feeds',feed.id);
  editFeed(db,feed.id,{expected_revision:current.revision,keywords:'other'});
  release();
  const result=await pending;
  assert.equal(result.skipped,1);
  const audit=db.events().filter(x=>x.kind.startsWith('source.scan_'));
  assert.equal(audit.length,1);
  assert.equal(audit[0].kind,'source.scan_skipped');
  assert.equal(audit[0].detail.reason,'source_changed');
  assert.equal(db.list('sources').length,0);
 }finally{db.close();}
});
