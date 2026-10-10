import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {sourceQualityReport} from '../src/source-quality.mjs';

function setup(){
 const store=openDatabase();
 store.put('feeds',{id:'feed-a',title:'Feed A',url:'https://example.com/rss',enabled:true,lastSuccessAt:'2026-10-10T01:00:00Z',nextScanAt:'2026-10-10T03:00:00Z',lastError:null});
 store.put('feeds',{id:'feed-b',title:'Feed B',url:'https://example.net/rss',enabled:true,lastSuccessAt:'2026-10-10T02:00:00Z',nextScanAt:'2026-10-10T04:00:00Z',lastError:null});
 return store;
}
const byId=(report,id)=>report.items.find(x=>x.feedId===id);

test('empty feeds do not falsely imply verified consumer demand',()=>{
 const store=setup();try{const r=sourceQualityReport(store);
 assert.equal(r.overview.uniqueSignals,0);assert.equal(r.overview.configuredSources,2);
 assert.equal(r.overview.sourcesWithOwnerReviewedFirsthand,0);assert.equal(byId(r,'feed-a').assessment,'no_signals');
 }finally{store.close();}
});

test('same article in two feeds is one globally unique signal',()=>{
 const store=setup();try{
 store.put('sources',{id:'one',url:'https://example.org/post/1',feedIds:['feed-a','feed-b'],status:'converted',author:'Casey'});
 store.put('opportunities',{id:'opp-1',sources:[{url:'https://example.org/post/1',reviewedAt:'2026-10-10T03:00:00Z',firsthand:true,independent:true}]});
 const r=sourceQualityReport(store);
 assert.equal(r.overview.uniqueSignals,1);assert.equal(r.overview.linkedOpportunities,1);
 assert.equal(byId(r,'feed-a').linkedOpportunities,1);assert.equal(byId(r,'feed-b').linkedOpportunities,1);
 assert.equal(byId(r,'feed-a').ownerReviewedIndependentFirsthand,1);
 assert.equal(r.overview.sourcesWithOwnerReviewedFirsthand,2);
 }finally{store.close();}
});

test('same attributed author is not counted as independent people twice',()=>{
 const store=setup();try{
 store.put('sources',{id:'one',url:'https://example.org/p/1',feedIds:['feed-a'],author:'SameAuthor',status:'converted'});
 store.put('sources',{id:'two',url:'https://example.org/p/2',feedIds:['feed-a'],author:'sameauthor',status:'converted'});
 store.put('opportunities',{id:'opp',sources:[
 {url:'https://example.org/p/1',reviewedAt:'2026-10-10T03:00:00Z',firsthand:true,independent:true},
 {url:'https://example.org/p/2',reviewedAt:'2026-10-10T03:00:00Z',firsthand:true,independent:true}]});
 const r=sourceQualityReport(store);
 assert.equal(byId(r,'feed-a').reviewedEvidenceUrls,2);
 assert.equal(byId(r,'feed-a').ownerReviewedIndependentFirsthand,1);
 }finally{store.close();}
});

test('unreviewed, secondhand and failed feeds are not promoted to verified',()=>{
 const store=setup();try{
 store.put('sources',{id:'one',url:'https://example.org/p/1',feedIds:['feed-b'],status:'converted'});
 store.put('sources',{id:'two',url:'https://example.org/p/2',feedIds:['feed-b'],status:'saved'});
 store.put('opportunities',{id:'opp',sources:[{url:'https://example.org/p/1',firsthand:true,independent:true}]});
 const old=store.get('feeds','feed-b');store.put('feeds',{...old,lastError:'HTTP 429',consecutiveFailures:2},old.revision);
 const r=sourceQualityReport(store,{nowMs:Date.parse('2026-10-10T05:00:00Z')});
 assert.equal(r.overview.failingSources,1);
 assert.equal(byId(r,'feed-b').unreviewedLinked,1);
 assert.equal(byId(r,'feed-b').ownerReviewedIndependentFirsthand,0);
 assert.equal(byId(r,'feed-b').counts.saved,1);
 assert.equal(byId(r,'feed-b').assessment,'scan_problem');
 assert.equal(byId(r,'feed-b').due,true);
 }finally{store.close();}
});
