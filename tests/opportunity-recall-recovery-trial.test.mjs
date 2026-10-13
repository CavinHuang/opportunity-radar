import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {opportunityDiscoveryBenchmark} from '../src/opportunity-discovery-benchmark.mjs';

test('short title with real workflow pain is rescued only by offline description fallback',()=>{
 const db=openDatabase();try{
  const positive=db.put('sources',{id:'short-real',url:'https://example.org/real',status:'new',title:'Help',description:'I manually reconcile invoices every day and spend hours fixing errors in the records'});
  const negative=db.put('sources',{id:'short-promo',url:'https://example.org/promo',status:'new',title:'News',description:'We launched our invoice reconciliation tool today with a great discount'});
  for(const [item,label] of [[positive,'real_problem'],[negative,'not_problem']])
   db.put('discovery_quality_labels',{id:item.id,label,reason:'原始问题已人工核查',sourceRevision:item.revision});
  const baseline=opportunityScanCandidates(db,{limit:50});
  const trial=opportunityScanCandidates(db,{limit:50,descriptionFallback:true});
  assert.ok(!baseline.items.some(x=>x.signalIds.includes('short-real')));
  assert.ok(trial.items.some(x=>x.signalIds.includes('short-real')));
  assert.ok(!trial.items.some(x=>x.signalIds.includes('short-promo')));
  assert.equal(trial.strategy,'description_fallback_trial');
  const report=opportunityDiscoveryBenchmark(db);
  assert.equal(report.metric.falseNegative,1);
  assert.equal(report.recallTrial.trial.truePositive,1);
  assert.equal(report.recallTrial.delta.falseNegative,-1);
  assert.equal(report.recallTrial.delta.falsePositive,0);
  assert.equal(report.recallTrial.recommendation,'manual_review_required');
  assert.equal(report.recallTrial.liveRuleChanged,false);
 }finally{db.close();}
});
test('no labels or observed rescue does not claim improved recall',()=>{
 const db=openDatabase();try{
  const r=opportunityDiscoveryBenchmark(db);
  assert.equal(r.recallTrial.recommendation,'insufficient_labels');
  assert.equal(r.recallTrial.trial.recall,null);
 }finally{db.close();}
});
