import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {replayDiscoveryRules} from '../src/discovery-rule-replay.mjs';

test('offline replay compares variants without changing sources or recorded labels',()=>{
 const db=openDatabase();try{
  const posts=[
   ['a','Cannot automate repetitive invoice workflow','I manually copy invoices every day and spend hours fixing errors','real_problem'],
   ['b','Cannot automate repetitive invoice workflow','I copy invoices every day and spend hours fixing errors','real_problem'],
   ['c','We launched an invoice tool that fixes errors','Our team copies invoices every day and spends hours fixing errors','not_problem']
  ];
  for(const [id,title,description,label] of posts){
   const s=db.put('sources',{id,title,description,status:'new',url:'https://example.org/'+id});
   db.put('discovery_quality_labels',{id,label,reason:'Reviewed original',sourceRevision:s.revision});
  }
  const before=db.list('sources');
  const r=replayDiscoveryRules(db);
  assert.equal(r.sampleSize,3);
  assert.equal(r.liveRuleChanged,false);
  assert.equal(r.policies.length,2);
  assert.equal(r.policies[0].delta.falseNegative,1);
  assert.equal(r.policies[0].recommendation,'increased_misses_do_not_apply');
  assert.deepEqual(db.list('sources'),before);
  assert.equal(db.list('discovery_quality_labels').length,3);
 }finally{db.close();}
});
test('stale and uncertain labels are excluded from rule replay',()=>{
 const db=openDatabase();try{
  const a=db.put('sources',{id:'a',title:'News',description:'Generic',url:'https://example.org/a'});
  db.put('discovery_quality_labels',{id:'a',label:'real_problem',sourceRevision:a.revision});
  db.put('sources',{...a,description:'changed'},a.revision);
  const b=db.put('sources',{id:'b',title:'News',description:'Generic',url:'https://example.org/b'});
  db.put('discovery_quality_labels',{id:'b',label:'uncertain',sourceRevision:b.revision});
  const r=replayDiscoveryRules(db);
  assert.equal(r.sampleSize,0);
  assert.equal(r.staleLabels,1);
  assert.equal(r.baseline.precision,null);
  assert.equal(r.policies[0].recommendation,'insufficient_reviewed_examples');
 }finally{db.close();}
});
