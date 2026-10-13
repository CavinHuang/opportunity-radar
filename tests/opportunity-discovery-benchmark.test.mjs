import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityDiscoveryBenchmark,captureOpportunityBenchmark,opportunityBenchmarkHistory} from '../src/opportunity-discovery-benchmark.mjs';
const problem=(id,title,description)=>({id,url:'https://example.org/'+id,status:'new',title,description});
const seed=db=>{
 const pos=db.put('sources',problem('pos','I cannot reconcile invoice records manually','I manually reconcile invoices every day and spend hours fixing errors'));
 const neg=db.put('sources',problem('neg','We launched a new AI product today','Our startup releases new AI features to subscribers'));
 const missed=db.put('sources',problem('miss','New photo app','I need better options'));
 for(const [s,label] of [[pos,'real_problem'],[neg,'not_problem'],[missed,'real_problem']])
  db.put('discovery_quality_labels',{id:s.id,label,sourceRevision:s.revision,reason:'人工核查原帖内容并完成标注'});
};
test('opportunity benchmark counts previously missed positive labels, not just accepted candidates',()=>{
 const db=openDatabase();try{
  seed(db);
  const r=opportunityDiscoveryBenchmark(db);
  assert.equal(r.reviewed,3);
  assert.equal(r.metric.truePositive,1);
  assert.equal(r.metric.falseNegative,1);
  assert.equal(r.metric.trueNegative,1);
  assert.equal(r.metric.precision,1);
  assert.equal(r.metric.recall,0.5);
  assert.ok(r.missed.some(x=>x.sourceId==='miss'));
  assert.equal(r.topCandidateLimit,50);
 }finally{db.close();}
});
test('benchmark snapshots are version-fenced and cannot compare changed label cohorts',()=>{
 const db=openDatabase();try{
  seed(db);
  const one=captureOpportunityBenchmark(db,{reason:'复查三条正反样本，记录首次离线质量基线',expected_revision:0});
  assert.equal(one.revision,1);
  const two=captureOpportunityBenchmark(db,{reason:'相同样本重新评估以确认离线回放具有一致性',expected_revision:1});
  assert.equal(two.entry.comparison.recallDelta,0);
  assert.throws(()=>captureOpportunityBenchmark(db,{reason:'旧版本的评估快照不应允许覆盖新版本',expected_revision:1}),{code:'REVISION_CONFLICT'});
  const source=db.get('sources','pos');
  db.put('sources',{...source,description:'I manually reconcile invoices every day and spend hours fixing errors again'},source.revision);
  const changed=opportunityDiscoveryBenchmark(db);
  assert.equal(changed.stale,1);
  const three=captureOpportunityBenchmark(db,{reason:'源数据修改导致旧标注过期，本轮不做质量改进结论',expected_revision:2});
  assert.equal(three.entry.comparison,null);
  assert.equal(opportunityBenchmarkHistory(db).snapshots.length,3);
 }finally{db.close();}
});
test('zero usable human labels never stores a quality benchmark',()=>{
 const db=openDatabase();try{
  assert.equal(opportunityDiscoveryBenchmark(db).metric.precision,null);
  assert.throws(()=>captureOpportunityBenchmark(db,{reason:'没有任何人工标签，不允许伪造质量报告',expected_revision:0}),{code:'NO_REVIEWED_SAMPLES'});
 }finally{db.close();}
});
