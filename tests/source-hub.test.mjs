import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {addFeed,editFeed,scanSources,seedConfiguredSources,querySignals,triageSignal,addManualSignal,validateFeedUrl,isPrivateAddress} from '../src/source-hub.mjs';

const base='https://community.example.org/rss';
const xml='<rss><channel><item><title><![CDATA[Cleaning family photos takes hours]]></title><link>https://forum.example.org/complaint/1?utm_source=newsletter</link><description><![CDATA[I spend hours clearing duplicate photos]]></description><pubDate>Sat, 10 Oct 2026 04:00:00 GMT</pubDate></item><item><title>Unrelated market story</title><link>https://forum.example.org/other</link><description>Just a report</description></item></channel></rss>';
const net=(body=xml)=>({fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/rss+xml'}),body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(body));controller.close();}})}),dnsLookup:async()=>[{address:'8.8.8.8'}]});
test('source subscriptions persist, validate URL, and use optimistic revisions',()=>{
 const s=openDatabase();try{
  const a=addFeed(s,{url:base,title:'Customer discussion',market:'International',keywords:'photos, cleanup'});
  assert.equal(a.enabled,true);assert.deepEqual(a.keywords,['photos','cleanup']);
  assert.throws(()=>addFeed(s,{url:base}),{code:'FEED_EXISTS'});
  assert.throws(()=>addFeed(s,{url:'https://localhost/secret'}),{code:'BAD_FEED_URL'});
  assert.throws(()=>addFeed(s,{url:'http://example.org/rss'}),{code:'BAD_FEED_URL'});
  assert.throws(()=>editFeed(s,a.id,{expected_revision:0,enabled:false}),{code:'REVISION_CONFLICT'});
  const b=editFeed(s,a.id,{expected_revision:a.revision,enabled:false,keywords:[]});assert.equal(b.enabled,false);
  seedConfiguredSources(s,base);assert.equal(s.list('feeds').length,1);assert.equal(s.get('feeds',a.id).enabled,false);
 }finally{s.close();}
});
test('scan retains original evidence, filters and de-duplicates across source feeds',async()=>{
 const s=openDatabase();try{
  const a=addFeed(s,{url:base,keywords:'photos'}),b=addFeed(s,{url:'https://www.example.net/feed',keywords:'photos'});
  const r=await scanSources(s,net());assert.equal(r.feeds,2);assert.equal(r.received,4);assert.equal(r.added,1);assert.equal(r.filtered,2);assert.equal(r.duplicates,1);
  const signal=querySignals(s,{status:'new'}).items[0];assert.equal(signal.feedIds.length,2);assert.equal(signal.status,'new');assert.ok(signal.url.endsWith('/complaint/1'));
  assert.equal(signal.publishedAt,'2026-10-10T04:00:00.000Z');
  assert.equal(s.list('feeds').length,2);
  const t=triageSignal(s,signal.id,{status:'saved',expected_revision:signal.revision});assert.equal(querySignals(s,{status:'saved'}).total,1);
  assert.throws(()=>triageSignal(s,signal.id,{status:'dismissed',expected_revision:signal.revision}),{code:'REVISION_CONFLICT'});
  assert.equal(triageSignal(s,signal.id,{status:'dismissed',expected_revision:t.revision}).status,'dismissed');
  const c=await scanSources(s,net());assert.equal(c.added,0);assert.equal(querySignals(s,{status:'dismissed'}).total,1);
  assert.equal(querySignals(s,{status:'all',keyword:'photos'}).total,1);
 }finally{s.close();}
});
test('host and redirect safety rules prevent private-network access',async()=>{
 assert.equal(isPrivateAddress('127.0.0.1'),true);assert.equal(isPrivateAddress('192.168.2.3'),true);assert.equal(isPrivateAddress('169.254.169.254'),true);assert.equal(isPrivateAddress('8.8.8.8'),false);
 assert.throws(()=>validateFeedUrl('https://192.168.1.15/rss'),{code:'BAD_FEED_URL'});
 const s=openDatabase();try{
  const f=addFeed(s,{url:base});let count=0;
  const result=await scanSources(s,{dnsLookup:async()=>[{address:'10.0.0.2'}],fetchImpl:async()=>{count++;throw Error('must not fetch')}});
  assert.equal(count,0);assert.equal(result.errors.length,1);assert.ok(s.get('feeds',f.id).lastError);
  const net2={fetchImpl:async()=>({status:302,headers:new Headers({location:'https://localhost/admin'}),body:null}),dnsLookup:async()=>[{address:'8.8.8.8'}]};
  const redirect=await scanSources(s,net2);assert.equal(redirect.errors.length,1);assert.match(redirect.errors[0].error,/内部网络|HTTPS/);
 }finally{s.close();}
});
test('source scan rejects non-RSS payload and caps download size',async()=>{
 const s=openDatabase();try{addFeed(s,{url:base});
  const r=await scanSources(s,net('<html><title>Login required</title></html>'));assert.equal(r.added,0);assert.match(r.errors[0].error,/RSS/);
  const large=await scanSources(s,net('x'.repeat(1024*1024+10)));assert.equal(large.added,0);assert.match(large.errors[0].error,/1MB/);
 }finally{s.close();}
});

test('manual website signals preserve original evidence without network access or false verification',()=>{
 const s=openDatabase();try{
  const one=addManualSignal(s,{url:'https://consumer.example.org/post/1?utm_medium=feed',title:'User complaint',description:'Manual transcription of public article',market:'CN'});
  assert.equal(one.status,'new');assert.equal(one.origin,'user_manual_unverified');assert.equal(one.url,'https://consumer.example.org/post/1');
  assert.throws(()=>addManualSignal(s,{url:'https://consumer.example.org/post/1?utm_medium=ad',title:'Duplicate',description:'same URL'}),{code:'SIGNAL_EXISTS'});
  assert.throws(()=>addManualSignal(s,{url:'javascript:alert(1)',title:'Invalid',description:'Unsafe URL'}),{code:'BAD_SIGNAL_URL'});
 }finally{s.close();}
});
