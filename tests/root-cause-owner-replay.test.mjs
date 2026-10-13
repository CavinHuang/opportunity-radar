import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {discoveryClusters,reviewDiscoveryCluster} from '../src/discovery.mjs';
import {rootCauseOwnerReplay} from '../src/root-cause-owner-replay.mjs';
import {opportunityDiscoveryBenchmark} from '../src/opportunity-discovery-benchmark.mjs';
function insertPair(db,prefix,left,right){
 db.put('sources',{id:prefix+'a',status:'new',url:'https://example.org/'+prefix+'a',
  title:'I cannot reconcile invoice records manually',description:left});
 db.put('sources',{id:prefix+'b',status:'new',url:'https://other.org/'+prefix+'b',
  title:'I cannot reconcile invoice records manually',description:right});
}
test('different-problem and same-problem owner labels yield conservative group-level replay',()=>{
 const db=openDatabase();try{
  insertPair(db,'x','I manually reconcile invoices. Amounts are wrong and incorrect.','I manually reconcile invoices. This takes hours and is tedious.');
  const group=discoveryClusters(db,{includeDismissed:true}).items[0];
  reviewDiscoveryCluster(db,group.id,{action:'dismiss',classification:'different_problem',
   fingerprint:group.fingerprint,reason:'人工核查原始帖子，确认是不同的问题根因',expected_revision:0});
  const r=rootCauseOwnerReplay(db);
  assert.equal(r.sampleSize,1);
  assert.equal(r.counts.caughtDifferent,1);
  assert.equal(r.counts.falseSplitWarnings,0);
  assert.equal(r.liveRuleChanged,false);
  assert.equal(r.autoSplit,false);
  assert.equal(opportunityDiscoveryBenchmark(db).rootCauseReplay.sampleSize,1);
 }finally{db.close();}
});
test('stale owner review is excluded, no labels produces undefined rates',()=>{
 const db=openDatabase();try{
  insertPair(db,'a','I manually reconcile invoices. Amounts are wrong.','I manually reconcile invoices. This takes hours.');
  const group=discoveryClusters(db,{includeDismissed:true}).items[0];
  reviewDiscoveryCluster(db,group.id,{action:'confirm',fingerprint:group.fingerprint,
   reason:'人工查看原帖后判断仍然是同一个问题',expected_revision:0});
  let report=rootCauseOwnerReplay(db);
  assert.equal(report.counts.falseSplitWarnings,1);
  const s=db.get('sources','aa');
  db.put('sources',{...s,description:s.description+' additional evidence'},s.revision);
  report=rootCauseOwnerReplay(db);
  assert.equal(report.sampleSize,0);
  assert.equal(report.flaggedPrecision,null);
  assert.ok(report.excluded.unreviewed>=1);
 }finally{db.close();}
});
test('repost dismissals do not masquerade as different-problem labels',()=>{
 const db=openDatabase();try{
  insertPair(db,'p','I manually reconcile invoices. Amounts are wrong.','I manually reconcile invoices. This takes hours.');
  const group=discoveryClusters(db,{includeDismissed:true}).items[0];
  reviewDiscoveryCluster(db,group.id,{action:'dismiss',classification:'possible_repost',
   fingerprint:group.fingerprint,reason:'可能是同一作者转载，需要排除重复数据',expected_revision:0});
  const r=rootCauseOwnerReplay(db);
  assert.equal(r.sampleSize,0);
  assert.equal(r.excluded.otherDismissal,1);
 }finally{db.close();}
});
