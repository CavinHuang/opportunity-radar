import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityEvidenceDossier} from '../src/opportunity-evidence-dossier.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';

const problem=(id,url)=>({id,url,status:'new',title:'I cannot reconcile invoices every day',description:'I manually reconcile invoices every day and spend 2 hours fixing errors'});
test('dossier preserves source evidence, deduplicates tracking URLs and marks unknowns',()=>{
 const a=problem('a','https://example.org/thread?utm_source=one');
 const b=problem('b','https://example.org/thread?utm_source=two');
 const d=opportunityEvidenceDossier([a,b]);
 assert.equal(d.sourceCount,1);
 assert.equal(d.sources.length,1);
 assert.ok(d.sources[0].excerpts.obstacle?.quote);
 assert.equal(d.checks.find(x=>x.id==='independent_users').state,'missing');
 assert.equal(d.checks.find(x=>x.id==='competitive_alternatives').state,'missing');
 assert.equal(d.validationState,'needs_independent_verification');
});
test('promotional material cannot create verified evidence',()=>{
 const d=opportunityEvidenceDossier([{id:'promo',url:'https://example.com/ad',title:'We launched our invoice tool today',description:'I manually reconcile invoices every day and spend 2 hours fixing errors'}]);
 assert.equal(d.sourceCount,0);
 assert.equal(d.checks.find(x=>x.id==='originals').state,'missing');
});
test('scan candidates include an unverified evidence dossier without adding a real opportunity',()=>{
 const db=openDatabase();try{
  db.put('sources',problem('a','https://example.org/a'));
  const items=opportunityScanCandidates(db).items;
  assert.ok(items.length>=1);
  assert.equal(items[0].evidenceDossier.validationState,'needs_independent_verification');
  assert.equal(items[0].evidenceDossier.sources[0].sourceId,'a');
  assert.equal(items[0].qualityReview.safeguards.validatedDemand,false);
 }finally{db.close();}
});
