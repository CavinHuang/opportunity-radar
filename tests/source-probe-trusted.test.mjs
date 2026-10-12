import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {probeFeed,addFeed} from '../src/source-hub.mjs';
import {makeCommunityFeed} from '../src/third-party-feed.mjs';
const xml='<rss><channel><item><title>Automation for receipts</title><link>https://example.org/post/one</link><description>Repeated copying</description></item></channel></rss>';
test('read-only probe parses feed without changing source or scan state',async()=>{
 const db=openDatabase();try{
  const source=addFeed(db,{url:'https://example.org/rss',title:'Fixture'});
  const before=db.get('feeds',source.id);
  const probe=await probeFeed(db,source.id,{dnsLookup:async()=>[{address:'8.8.8.8'}],fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/rss+xml'}),body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(xml));controller.close()}})})});
  assert.equal(probe.status,'reachable');assert.equal(probe.parsedItems,1);assert.deepEqual(db.get('feeds',source.id),before);assert.equal(db.list('sources').length,0);
 }finally{db.close()}
});
test('trusted RSSHub domain can be explicitly configured but defaults deny',()=>{
 const data={provider:'rsshub-x',account:'DIYgod',instance:'https://rss.example.com/'};
 assert.throws(()=>makeCommunityFeed(data),{code:'UNTRUSTED_INSTANCE'});
 assert.equal(makeCommunityFeed({...data,trustedInstances:'rss.example.com'}).url,'https://rss.example.com/twitter/user/DIYgod');
 assert.throws(()=>makeCommunityFeed({...data,instance:'http://rss.example.com/',trustedInstances:'rss.example.com'}),{code:'INVALID_INSTANCE'});
});
