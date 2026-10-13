import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {reviewPriority,evidenceFingerprint} from '../src/opportunity-evidence-priority.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
const friction=(id,url,description='I manually copy invoices every day and spend hours fixing errors')=>({id,status:'new',url,title:'Cannot automate repetitive invoice reconciliation workflow',description});
test('duplicate URLs and promotional tracking params never inflate review priority',()=>{
 const one=friction('a','https://example.com/problem?utm_source=feed');
 const same=friction('b','https://example.com/problem?utm_medium=rss');
 const another=friction('c','https://elsewhere.com/problem','I copy invoices every day and spend hours fixing errors');
 assert.equal(evidenceFingerprint(one),evidenceFingerprint(same));
 assert.equal(reviewPriority([one,same]).qualifiedSources,1);
 assert.equal(reviewPriority([one,another]).qualifiedSources,2);
 assert.ok(reviewPriority([one,another]).priority>reviewPriority([one,same]).priority);
 assert.ok(reviewPriority([one,another],{possibleRepost:true}).priority<reviewPriority([one,another]).priority);
});
test('promotion and generic AI announcements do not contribute qualified evidence',()=>{
 const valid=friction('real','https://example.com/real');
 const promotion={id:'promo',title:'We launched an invoice tool',description:'Our team manually copies invoices every day and spends hours fixing errors',url:'https://example.com/promo'};
 const report=reviewPriority([promotion,valid]);
 assert.equal(report.qualifiedSources,1);
 assert.deepEqual(report.sourceIds,['real']);
 assert.equal(report.reviewTier,'inspect_original');
});
test('candidate read model ranks repeated qualified friction above a single report',()=>{
 const db=openDatabase();try{
  const base=friction('one','https://one.example.com/one');
  const independent=friction('two','https://two.example.com/two');
  const single=friction('three','https://three.example.com/three','I manually copy receipts every day and spend hours fixing errors');
  single.title='Cannot automate receipt data entry workflow';
  for(const item of [base,independent,single])db.put('sources',item);
  const list=opportunityScanCandidates(db,{limit:12}).items;
  assert.ok(list.length>0);
  assert.ok(list.every(x=>x.evidencePriority&&Number.isInteger(x.priority)));
  assert.ok(list.every(x=>x.qualityReview.safeguards.validatedDemand===false));
 }finally{db.close();}
});
