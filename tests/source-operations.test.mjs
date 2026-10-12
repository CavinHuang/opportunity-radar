import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.mjs';import {sourceOperations} from '../src/source-operations.mjs';import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
test('source recommendations do not mutate a broken feed',()=>{const db=openDatabase();try{const f=db.put('feeds',{id:'f1',url:'https://example.org/rss',title:'Broken',enabled:true,consecutiveFailures:4,lastError:'HTTP 503',keywords:[]});const review=sourceOperations(db);assert.equal(review.suggestions.length,1);assert.match(review.suggestions[0].reasons.join(' '),/连续失败/);assert.equal(db.get('feeds','f1').revision,f.revision);assert.equal(db.get('feeds','f1').enabled,true);}finally{db.close()}});
test('new data with no history does not imply poor source quality',()=>{const db=openDatabase();try{db.put('feeds',{id:'f2',url:'https://example.org/rss',title:'New',enabled:true,keywords:[]});assert.equal(sourceOperations(db).suggestions.length,0)}finally{db.close()}});
test('candidate includes explicit domain and missing competitor research',()=>{const db=openDatabase();try{db.put('sources',{id:'s1',url:'https://example.org/question',title:'Cannot automate manual receipts workflow for accounting',description:'I need a better alternative tool',status:'new',createdAt:'2026-10-12T01:00:00Z'});const x=opportunityScanCandidates(db);assert.ok(x.items.length);assert.ok(x.items[0].domains.includes('AI 与自动化'));assert.equal(x.items[0].competitionMentioned,true);assert.ok(x.items[0].counterEvidence.length)}finally{db.close()}});

test('shared signal provenance flags highly overlapping sources without mutating subscriptions',()=>{
 const db=openDatabase();try{
  const a=db.put('feeds',{id:'a',url:'https://a.example/rss',title:'A',enabled:true,keywords:[],lastSuccessAt:'2026-10-12T00:00:00Z'});
  db.put('feeds',{id:'b',url:'https://b.example/rss',title:'B',enabled:true,keywords:[],lastSuccessAt:'2026-10-12T00:00:00Z'});
  for(let i=0;i<10;i++)db.put('sources',{id:'overlap'+i,url:'https://original.example/'+i,title:'A problem '+i,description:'',feedIds:['a','b'],status:'new'});
  const item=sourceOperations(db).suggestions.find(x=>x.feedId==='a');
  assert.ok(item);assert.equal(item.observed.overlapRatio,1);assert.equal(item.observed.overlapWith,'b');
  assert.equal(db.get('feeds','a').revision,a.revision);
 }finally{db.close()}
});
test('small overlaps are not sufficient to recommend pausing',()=>{
 const db=openDatabase();try{
  db.put('feeds',{id:'a',url:'https://a.example/rss',title:'A',enabled:true,keywords:[]});
  db.put('feeds',{id:'b',url:'https://b.example/rss',title:'B',enabled:true,keywords:[]});
  for(let i=0;i<10;i++)db.put('sources',{id:'different'+i,url:'https://example.net/'+i,title:'Problem '+i,feedIds:i<2?['a','b']:['a'],status:'new'});
  assert.equal(sourceOperations(db).suggestions.filter(x=>x.feedId==='a').length,0);
 }finally{db.close()}
});
