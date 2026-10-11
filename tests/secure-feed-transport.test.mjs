import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {openDatabase} from '../src/db.mjs';
import {addFeed,scanSources} from '../src/source-hub.mjs';
import {pinnedLookup,pinnedHttpsFetch} from '../src/pinned-https.mjs';

const xml='<rss><channel>'+
  '<item><title>First real consumer problem</title><link>https://example.org/post/1</link><description>People lose their receipts</description></item>'+
  '<item><title>Another consumer problem</title><link>https://example.org/post/2</link><description>People need to scan receipts</description></item>'+
  '</channel></rss>';
const okResponse=()=>({ok:true,status:200,headers:new Headers(),body:new ReadableStream({
 start(controller){controller.enqueue(new TextEncoder().encode(xml));controller.close();}
})});
const dnsPublic=async()=>[{address:'8.8.8.8',family:4}];

function lookupResult(lookup,host,options){
 return new Promise((resolve,reject)=>{
  lookup(host,options,(err,address,family)=>err?reject(err):resolve({address,family}));
 });
}
test('pinned HTTPS lookup uses only previously checked addresses and rejects different names or IP families',async()=>{
 const pin=pinnedLookup('feed.example',[{address:'8.8.8.8',family:4},{address:'2606:4700:4700::1111',family:6}]);
 assert.deepEqual(await lookupResult(pin,'feed.example',{family:4}),{address:'8.8.8.8',family:4});
 assert.deepEqual(await lookupResult(pin,'feed.example',{family:6}),{address:'2606:4700:4700::1111',family:6});
 await assert.rejects(lookupResult(pin,'attacker.example',{}),{code:'SOURCE_HOST_MISMATCH'});
 await assert.rejects(lookupResult(pinnedLookup('feed.example',[{address:'8.8.8.8',family:4}]),'feed.example',{family:6}),{code:'SOURCE_IP_FAMILY'});
 assert.throws(()=>pinnedLookup('feed.example',[]),/validated address/);
});
test('actual native HTTPS request options bind validated IP while preserving TLS hostname and HTTP path',async()=>{
 let captured,requestCount=0;
 const fakeRequest=(url,options,onResponse)=>{
  requestCount++;captured={url:url.href,options};
  const req=new EventEmitter();
  req.destroy=e=>req.emit('error',e);
  req.end=()=>queueMicrotask(()=>{
   const res=new PassThrough();res.statusCode=200;res.headers={'content-type':'application/rss+xml','etag':'"v1"'};
   onResponse(res);res.end(xml);
  });
  return req;
 };
 const result=await pinnedHttpsFetch('https://feed.example/atom.xml?limit=4',{
  addresses:[{address:'8.8.8.8',family:4}],headers:{Accept:'application/xml'},requestImpl:fakeRequest
 });
 assert.equal(result.status,200);assert.equal(requestCount,1);
 assert.equal(captured.url,'https://feed.example/atom.xml?limit=4');
 assert.equal(captured.options.servername,'feed.example');
 assert.equal(captured.options.redirect,'manual');
 assert.equal(captured.options.method,'GET');
 assert.equal((await lookupResult(captured.options.lookup,'feed.example',{family:4})).address,'8.8.8.8');
 await assert.rejects(lookupResult(captured.options.lookup,'localhost',{}),{code:'SOURCE_HOST_MISMATCH'});
 assert.equal(await new Response(result.body).text(),xml);
});
test('real feed scanner hands only public validated address records to transport',async()=>{
 const db=openDatabase();try{
  addFeed(db,{url:'https://feed.example/rss'});
  const calls=[];
  const scanned=await scanSources(db,{dnsLookup:dnsPublic,fetchImpl:async(url,opts)=>{
   calls.push({url,addresses:opts.addresses,redirect:opts.redirect});return okResponse();
  }});
  assert.equal(scanned.added,2);
  assert.deepEqual(calls,[{url:'https://feed.example/rss',addresses:[{address:'8.8.8.8',family:4}],redirect:'manual'}]);
 }finally{db.close();}
});
test('DNS private or malformed answers block network requests and preserve source failure state',async()=>{
 const db=openDatabase();try{
  const f=addFeed(db,{url:'https://feed.example/rss'});
  for(const answer of [
   [{address:'127.0.0.1',family:4}],
   [{address:'8.8.8.8',family:4},{address:'192.168.1.7',family:4}],
   [{address:'not-an-ip',family:4}],
   [{address:'8.8.8.8',family:6}]
  ]){
   let attempted=false;
   const result=await scanSources(db,{dnsLookup:async()=>answer,fetchImpl:async()=>{
    attempted=true;return okResponse();
   }});
   assert.equal(attempted,false);
   assert.equal(result.added,0);
   assert.equal(result.errors.length,1);
   assert.equal(db.get('feeds',f.id).lastSuccessAt,null);
  }
 }finally{db.close();}
});
test('per-feed scan import rolls back every signal and watermark when a late SQLite insert fails',async()=>{
 const db=openDatabase();try{
  const f=addFeed(db,{url:'https://feed.example/rss'});
  const originalPut=db.put;let writes=0;
  db.put=(kind,...params)=>{
   if(kind==='sources'&&++writes===2)throw new Error('simulated SQLite disk error during second article');
   return originalPut(kind,...params);
  };
  const result=await scanSources(db,{fetchImpl:async()=>okResponse(),dnsLookup:dnsPublic});
  db.put=originalPut;
  assert.equal(result.errors.length,1);
  assert.equal(result.added,0,'Rolled-back rows must not be counted');
  assert.equal(db.list('sources').length,0,'First successful write must also roll back');
  assert.equal(db.get('feeds',f.id).lastSuccessAt,null);
  assert.equal(db.get('feeds',f.id).addedTotal,0);
  assert.equal(db.get('feeds',f.id).consecutiveFailures,1);
  const retry=await scanSources(db,{fetchImpl:async()=>okResponse(),dnsLookup:dnsPublic});
  assert.equal(retry.errors.length,0);
  assert.equal(retry.added,2);
  assert.equal(db.list('sources').length,2);
  assert.equal(db.get('feeds',f.id).addedTotal,2);
 }finally{db.close();}
});
test('one malformed feed failure does not block a healthy feed from committing',async()=>{
 const db=openDatabase();try{
  addFeed(db,{url:'https://broken.example/rss'});
  addFeed(db,{url:'https://healthy.example/rss'});
  const result=await scanSources(db,{dnsLookup:dnsPublic,fetchImpl:async(url)=>{
   if(url.includes('broken.example'))throw new Error('simulated connection failure');
   return okResponse();
  }});
  assert.equal(result.feeds,2);assert.equal(result.errors.length,1);
  assert.equal(result.added,2);
  assert.equal(db.list('sources').length,2);
  assert.equal(db.list('feeds').filter(f=>f.lastSuccessAt!==null).length,1);
 }finally{db.close();}
});

test('cross-origin redirect never stores or replays the other host ETag',async()=>{
 const db=openDatabase();try{
  const feed=addFeed(db,{url:'https://primary.example/rss'});
  let requests=[];
  const fetchImpl=async(url,opts)=>{
   requests.push({url,etag:opts.headers['If-None-Match']});
   if(url==='https://primary.example/rss')
    return {status:302,headers:new Headers({location:'https://secondary.example/rss'}),body:null};
   const ok=okResponse();ok.headers.set('etag','"secondary-secret"');return ok;
  };
  await scanSources(db,{dnsLookup:dnsPublic,fetchImpl});
  assert.equal(db.get('feeds',feed.id).etag,null);
  assert.equal(requests[1].etag,undefined);
  requests=[];
  await scanSources(db,{dnsLookup:dnsPublic,fetchImpl});
  assert.equal(requests[0].etag,undefined);
  assert.equal(requests[1].etag,undefined);
  assert.equal(db.get('feeds',feed.id).consecutiveFailures,0);
 }finally{db.close();}
});
test('unexpected 304 after a cross-site redirect never counts as a successful scan',async()=>{
 const db=openDatabase();try{
  const feed=addFeed(db,{url:'https://primary.example/rss'});
  const first=await scanSources(db,{dnsLookup:dnsPublic,fetchImpl:async()=>okResponse()});
  assert.equal(first.errors.length,0);
  // Populate a validator that belongs strictly to the initial origin.
  const current=db.get('feeds',feed.id);
  db.put('feeds',{...current,etag:'"primary-etag"'},current.revision);
  const redirectFetch=async(url,opts)=>{
   if(url==='https://primary.example/rss')return {status:302,headers:new Headers({location:'https://secondary.example/rss'}),body:null};
   assert.equal(opts.headers['If-None-Match'],undefined);
   return {status:304,headers:new Headers(),body:null};
  };
  const result=await scanSources(db,{dnsLookup:dnsPublic,fetchImpl:redirectFetch});
  assert.equal(result.notModified,0);
  assert.equal(result.errors.length,1);
  assert.equal(db.get('feeds',feed.id).consecutiveFailures,1);
 }finally{db.close();}
});
test('a timeout still aborts a stalled HTTPS response body after headers were received',async()=>{
 const controller=new AbortController();let aborted=false,stream;
 const fakeRequest=(url,options,onResponse)=>{
  const req=new EventEmitter();
  req.end=()=>queueMicrotask(()=>{
   stream=new PassThrough();stream.statusCode=200;stream.headers={};
   onResponse(stream); // Intentionally do not finish streaming.
  });
  req.destroy=err=>{aborted=true;stream?.destroy(err);req.emit('error',err);};
  return req;
 };
 const result=await pinnedHttpsFetch('https://feed.example/rss',{
  addresses:[{address:'8.8.8.8',family:4}],signal:controller.signal,requestImpl:fakeRequest
 });
 const reader=result.body.getReader();
 const pending=reader.read();
 controller.abort();
 await assert.rejects(pending);
 assert.equal(aborted,true);
});
