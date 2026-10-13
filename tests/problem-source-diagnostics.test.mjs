import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.mjs';import {problemSourceDiagnostics} from '../src/problem-source-diagnostics.mjs';
test('source diagnostics never invent signals for an empty feed',()=>{const db=openDatabase();try{db.put('feeds',{id:'f1',url:'https://feed.example/rss',title:'Example feed',enabled:true});const d=problemSourceDiagnostics(db);assert.equal(d.items.length,1);assert.equal(d.items[0].sampled,0);assert.equal(d.items[0].concreteProblems,0);assert.deepEqual(d.items[0].flags,[]);}finally{db.close()}});
test('diagnostics explain concrete firsthand-looking problems and promotions',()=>{const db=openDatabase();try{db.put('feeds',{id:'f1',url:'https://feed.example/rss',title:'Example feed',enabled:true});db.put('sources',{id:'a',feedIds:['f1'],url:'https://forum.example/a',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day and spend hours fixing errors',status:'new'});db.put('sources',{id:'b',feedIds:['f1'],url:'https://forum.example/b',title:'We launched an AI invoicing tool',description:'Our product launch announcement',status:'new'});const d=problemSourceDiagnostics(db).items[0];assert.equal(d.sampled,2);assert.equal(d.concreteProblems,1);assert.equal(d.possibleFirsthand,1);assert.equal(d.promotions,1);assert.equal(d.examples[0].url,'https://forum.example/a');assert.equal(db.list('opportunities').length,0);}finally{db.close()}});

test('human source diagnostics distinguish stale, uncertain, missed, and false-positive labels',()=>{
 const db=openDatabase();try{
  db.put('feeds',{id:'f1',url:'https://feed.example/rss',title:'Human checked',enabled:true});
  const inputs=[
   ['miss','Best AI tools roundup','Generic overview','real_problem'],
   ['false','Cannot automate repetitive invoice workflow','I manually copy invoices every day and spend hours fixing errors','not_problem'],
   ['unknown','AI tool overview','Generic overview','uncertain'],
   ['old','AI apps roundup','Generic listing','real_problem']
  ];
  for(const [id,title,description,label] of inputs){
   const s=db.put('sources',{id,feedIds:['f1'],status:'new',url:'https://forum.example/'+id,title,description});
   db.put('discovery_quality_labels',{id,label,reason:'人工核对帖子内容确认类型',sourceRevision:s.revision,at:new Date().toISOString()});
  }
  const old=db.get('sources','old');db.put('sources',{...old,description:'Content was changed'},old.revision);
  const review=problemSourceDiagnostics(db).items[0].humanReview;
  assert.equal(review.currentLabels,3);
  assert.equal(review.usableLabels,2);
  assert.equal(review.uncertain,1);
  assert.equal(review.stale,1);
  assert.equal(review.falseNegative,1);
  assert.equal(review.falsePositive,1);
  assert.equal(review.advice,'collect_more_labels');
  assert.equal(review.missedExamples[0].sourceId,'miss');
  assert.equal(review.falsePositiveExamples[0].sourceId,'false');
 }finally{db.close()}
});
test('feeds with no human reviews never claim accuracy',()=>{
 const db=openDatabase();try{
  db.put('feeds',{id:'f1',url:'https://feed.example/rss',title:'Empty review'});
  const d=problemSourceDiagnostics(db).items[0].humanReview;
  assert.equal(d.usableLabels,0);
  assert.equal(d.advice,'collect_more_labels');
  assert.deepEqual(d.missedExamples,[]);
 }finally{db.close()}
});
