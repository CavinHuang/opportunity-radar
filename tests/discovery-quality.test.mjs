import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {CATALOG,catalogList,installCatalogFeed} from '../src/source-catalog.mjs';
import {researchReport,reviewOpportunityEvidence} from '../src/research.mjs';
import {parseFeed} from '../src/signals.mjs';

function fixture(){
 const store=openDatabase();
 const service=createService(store);
 const opportunity=service.createOpportunity({title:'Cannot find receipts',problem:'I lost my receipts multiple times',market:'International',
 sources:[{url:'https://example.org/p/1',quote:'I lost my receipt',independent:false}],risk:'This could be rare'});
 return {store,service,opportunity};
}
test('curated feeds require opt-in; probing is never simulated',()=>{
 const store=openDatabase();try{
  assert.ok(CATALOG.length>=6);
  assert.equal(store.list('feeds').length,0);
  assert.equal(catalogList(store).filter(x=>x.verifiedLive).length,0);
  const first=installCatalogFeed(store,'v2ex-qna');
  assert.equal(first.alreadyInstalled,false);
  assert.equal(installCatalogFeed(store,'v2ex-qna').alreadyInstalled,true);
  assert.equal(store.list('feeds').length,1);
  assert.equal(first.item.sourceClass,'firsthand_candidate');
  assert.throws(()=>installCatalogFeed(store,'reddit-deprecated'),{code:'CATALOG_NOT_FOUND'});
 }finally{store.close();}
});
test('unreviewed forum posts do not count as independently proven demand',()=>{
 const {store,opportunity:o}=fixture();try{
  const report=researchReport(store,o.id);
  assert.equal(report.evidenceCount,1);
  assert.equal(report.reviewedIndependentFirsthandCount,0);
  assert.equal(report.stage,'unverified');
  assert.equal(report.businessEvidence,'unknown');
  assert.throws(()=>reviewOpportunityEvidence(store,o.id,{source_url:o.sources[0].url,expected_revision:o.revision,
   firsthand:true,independent:true,note:'Short'}),{code:'REVIEW_REQUIRED'});
 }finally{store.close();}
});
test('source review requires human original inspection, rationale, and expected revision',()=>{
 const {store,opportunity:o}=fixture();try{
  const request={source_url:o.sources[0].url,expected_revision:o.revision,reviewed_original:true,firsthand:true,
   independent:true,note:'I checked this original thread and verified that it describes the author’s own problem.'};
  const updated=reviewOpportunityEvidence(store,o.id,request);
  assert.equal(researchReport(store,o.id).stage,'single_observation');
  assert.throws(()=>reviewOpportunityEvidence(store,o.id,request),{code:'REVISION_CONFLICT'});
  const downgraded=reviewOpportunityEvidence(store,o.id,{...request,expected_revision:updated.revision,firsthand:false});
  assert.equal(downgraded.sources[0].independent,false);
  assert.equal(researchReport(store,o.id).stage,'unverified');
 }finally{store.close();}
});
test('similar links are suggestions, not automatically attached evidence',()=>{
 const {store,opportunity:o}=fixture();try{
  store.put('sources',{id:'related',title:'Cannot find receipts',description:'Me too',url:'https://example.net/post/2',status:'new',feedIds:[]});
  const r=researchReport(store,o.id);
  assert.equal(r.relatedCandidates[0].signalId,'related');
  assert.equal(r.evidenceCount,1);
  assert.equal(store.get('sources','related').status,'new');
 }finally{store.close();}
});
test('firsthand attribution is retained without automatic identity verification',()=>{
 const xml='<feed><entry><title>Lost receipts</title><link href="https://example.net/p/2"/><author><name>someone</name></author><summary>I lost my receipts</summary></entry></feed>';
 const parsed=parseFeed(xml,'https://example.net/rss');
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].author,'someone');
});
