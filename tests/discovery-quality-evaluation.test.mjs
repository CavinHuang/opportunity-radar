import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.mjs';import {labelDiscoveryExample,discoveryQualityReport,discoveryReviewSample} from '../src/discovery-quality-evaluation.mjs';
test('manual labels reveal false positives and false negatives without fake scores',()=>{
 const db=openDatabase();try{
 db.put('sources',{id:'a',status:'new',url:'https://forum.example/a',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day and spend hours fixing errors'});
 db.put('sources',{id:'b',status:'new',url:'https://forum.example/b',title:'Best AI tools roundup',description:'A general list of applications'});
 const zero=discoveryQualityReport(db);assert.equal(zero.precision,null);assert.equal(zero.unlabeled.length,2);
 labelDiscoveryExample(db,'a',{label:'not_problem',reason:'原文只是模拟案例，并不是实际求助经历',expected_revision:0});
 labelDiscoveryExample(db,'b',{label:'real_problem',reason:'已经人工核对原始帖子描述了实际流程障碍',expected_revision:0});
 const report=discoveryQualityReport(db);assert.equal(report.counts.falsePositive,1);assert.equal(report.counts.falseNegative,1);assert.equal(report.precision,0);assert.equal(report.recall,0);
 const old=db.get('sources','a');db.put('sources',{...old,description:'updated source text'},old.revision);
 assert.equal(discoveryQualityReport(db).counts.stale,1);assert.equal(discoveryQualityReport(db).counts.usable,1);
 assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
test('label update uses revision fencing and explanation',()=>{const db=openDatabase();try{
 db.put('sources',{id:'a',status:'new',url:'https://forum.example/a',title:'AI recap',description:'Generic roundup'});
 assert.throws(()=>labelDiscoveryExample(db,'a',{label:'real_problem',reason:'short',expected_revision:0}),{code:'REASON_REQUIRED'});
 const v=labelDiscoveryExample(db,'a',{label:'uncertain',reason:'需要进一步核查来源是否描述实际任务',expected_revision:0});
 assert.throws(()=>labelDiscoveryExample(db,'a',{label:'not_problem',reason:'已经确认没有用户实际问题描述',expected_revision:0}),{code:'REVISION_CONFLICT'});
 assert.equal(v.label,'uncertain');
 }finally{db.close()}
});
test('review queue includes predicted negatives instead of only top-ranked positives',()=>{
 const db=openDatabase();try{
  for(let i=0;i<12;i++)db.put('sources',{id:'p'+String(i).padStart(2,'0'),status:'new',url:'https://forum.example/p/'+i,title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day and spend hours fixing errors'});
  for(let i=0;i<12;i++)db.put('sources',{id:'n'+String(i).padStart(2,'0'),status:'new',url:'https://forum.example/n/'+i,title:'Best AI tools roundup',description:'Generic products list'});
  const sample=discoveryReviewSample(db);
  assert.equal(sample.items.length,10);
  assert.equal(sample.items.filter(x=>x.predicted).length,5);
  assert.equal(sample.items.filter(x=>!x.predicted).length,5);
  assert.equal(sample.remainingUnlabeled,24);
  assert.deepEqual(discoveryReviewSample(db).items,sample.items);
  assert.equal(discoveryQualityReport(db).counts.remainingUnlabeled,24);
  labelDiscoveryExample(db,sample.items[0].sourceId,{label:'uncertain',reason:'原帖身份尚无法可靠核实，后续再确认',expected_revision:0});
  assert.equal(discoveryReviewSample(db).remainingUnlabeled,23);
  assert.ok(!discoveryReviewSample(db).items.some(x=>x.sourceId===sample.items[0].sourceId));
 }finally{db.close()}
});
test('review sample handles one empty stratum and rejects invalid limits',()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'only',status:'new',url:'https://forum.example/only',title:'Generic summary',description:'Generic list'});
  assert.equal(discoveryReviewSample(db).items.length,1);
  assert.equal(discoveryReviewSample(db,{limit:1}).items[0].sourceId,'only');
  assert.throws(()=>discoveryReviewSample(db,{limit:0}),{code:'BAD_LIMIT'});
  assert.throws(()=>discoveryReviewSample(db,{limit:101}),{code:'BAD_LIMIT'});
 }finally{db.close()}
});
