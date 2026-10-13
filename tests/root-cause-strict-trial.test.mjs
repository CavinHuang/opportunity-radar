import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {discoveryClusters,reviewDiscoveryCluster} from '../src/discovery.mjs';
import {rootCauseOwnerReplay} from '../src/root-cause-owner-replay.mjs';
import {strictRootCauseConflict} from '../src/root-cause-strict-trial.mjs';

const post=(id,description)=>({id,status:'new',url:'https://example.org/'+id,title:'I cannot reconcile invoice records manually',description});
test('generic slow versus wrong words do not automatically trigger stricter warning',()=>{
 const a=post('a','I manually reconcile invoices and results are wrong.');
 const b=post('b','I manually reconcile invoices and it is slow.');
 assert.equal(strictRootCauseConflict(a,b).baseline,true);
 assert.equal(strictRootCauseConflict(a,b).conflict,false);
});
test('specific wrong amounts versus hours of work remain visible to strict trial',()=>{
 const a=post('a','I manually reconcile invoices with incorrect amounts.');
 const b=post('b','I manually reconcile invoices; it takes several hours.');
 assert.equal(strictRootCauseConflict(a,b).conflict,true);
});
test('reviewed groups compare warning reductions without pretending demand proof',()=>{
 const db=openDatabase();try{
  db.put('sources',post('a','I manually reconcile invoices and results are wrong.'));
  db.put('sources',post('b','I manually reconcile invoices and it is slow.'));
  const g=discoveryClusters(db,{includeDismissed:true}).items[0];
  reviewDiscoveryCluster(db,g.id,{action:'confirm',fingerprint:g.fingerprint,reason:'已经查看原帖并确认这两种现象属于同一个用户问题',expected_revision:0});
  const r=rootCauseOwnerReplay(db);
  assert.equal(r.counts.falseSplitWarnings,1);
  assert.equal(r.strictTrial.trial.falseSplitWarnings,0);
  assert.equal(r.strictTrial.delta.falseSplitWarnings,-1);
  assert.equal(r.strictTrial.recommendation,'manual_review_required');
  assert.equal(r.strictTrial.liveRuleChanged,false);
 }finally{db.close();}
});
