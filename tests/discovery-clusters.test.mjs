import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {problemTokens,titleSimilarity,discoveryClusters,reviewDiscoveryCluster} from '../src/discovery.mjs';

function setup(){
 const store=openDatabase(),service=createService(store);
 const insert=(id,title,domain,author='someone')=>store.put('sources',{
  id,title,description:'This article contains an unverified description of a consumer problem.',
  url:'https://'+domain+'/posts/'+id,feedIds:[],author,status:'new',
  createdAt:'2026-10-10T08:00:'+String(Number(id.replace(/\D/g,''))||0).padStart(2,'0')+'Z',
  market:'International'});
 return {store,service,insert,close:()=>store.close()};
}
test('conservative overlap groups repeated titles but rejects general unrelated posts',()=>{
 assert.ok(problemTokens('How can I keep receipts for online orders?').size>=3);
 assert.equal(titleSimilarity('How can I keep receipts for online orders?',
 'Where can I keep receipts for online orders?'),1);
 assert.equal(titleSimilarity('How can I keep receipts for online orders?',
 'Best travel backpacks for photographers'),0);
 const x=setup();try{
  x.insert('post1','How can I keep receipts for online orders?','forum.example','alex');
  x.insert('post2','Where can I keep receipts for online orders?','others.example','casey');
  x.insert('post3','Best travel backpacks for photographers','others.example','casey');
  const result=discoveryClusters(x.store);
  assert.equal(result.total,1);
  assert.equal(result.items[0].signalCount,2);
  assert.equal(result.items[0].domainCount,2);
  assert.equal(result.items[0].state,'needs_review');
  assert.ok(result.policy.includes('human inspection'));
 }finally{x.close();}
});
test('same author repeated URLs are not presented as unique consumers',()=>{
 const x=setup();try{
  x.insert('post1','Receipts lost for online purchases and returns','forum.example','alice');
  x.insert('post2','Receipts lost for online purchases and returns','forum.example','alice');
  const [group]=discoveryClusters(x.store).items;
  assert.equal(group.signalCount,2);
  assert.equal(group.domainCount,1);
  assert.equal(group.attributedAuthorKeys,1);
  assert.ok(group.caveat.includes('不能把帖子数量当成独立消费者'));
 }finally{x.close();}
});
test('Owner dismissal is versioned; new evidence makes earlier dismissal visible again',()=>{
 const x=setup();try{
  x.insert('post1','Lost receipts after buying online orders','forum.example','alice');
  x.insert('post2','Lost receipts after buying online orders','forum.example','alice');
  const initial=discoveryClusters(x.store).items[0];
  assert.throws(()=>reviewDiscoveryCluster(x.store,initial.id,{
   action:'dismiss',fingerprint:initial.fingerprint,reason:'short'}),{code:'REVIEW_REASON_REQUIRED'});
  const dismissed=reviewDiscoveryCluster(x.store,initial.id,{
   action:'dismiss',fingerprint:initial.fingerprint,reason:'Both posts were copied from the same original forum thread.'});
  assert.equal(dismissed.status,'dismissed');
  assert.equal(discoveryClusters(x.store).total,0);
  assert.equal(discoveryClusters(x.store,{includeDismissed:true}).items[0].state,'dismissed');
  x.insert('post3','Lost receipts after buying online orders','another.example','casey');
  const updated=discoveryClusters(x.store).items[0];
  assert.equal(updated.state,'needs_review');
  assert.equal(updated.signalCount,3);
  assert.notEqual(updated.fingerprint,initial.fingerprint);
  assert.throws(()=>reviewDiscoveryCluster(x.store,updated.id,{
   action:'dismiss',fingerprint:initial.fingerprint,reason:'There are now more posts to inspect.'}),{code:'CLUSTER_CHANGED'});
  assert.equal(reviewDiscoveryCluster(x.store,updated.id,{
   action:'dismiss',fingerprint:updated.fingerprint,reason:'Three articles describe the same syndicated release.',
   expected_revision:dismissed.revision}).status,'dismissed');
  const restored=reviewDiscoveryCluster(x.store,updated.id,{action:'restore',fingerprint:updated.fingerprint});
  assert.equal(restored.status,'active');
  assert.equal(discoveryClusters(x.store).total,1);
 }finally{x.close();}
});
test('Owner-approved group linking is atomic and marks all originals unreviewed',()=>{
 const x=setup();try{
  x.insert('post1','Lost receipts after buying online orders','forum.example','alice');
  x.insert('post2','Lost receipts after buying online orders','other.example','alex');
  const g=discoveryClusters(x.store).items[0];
  const opportunity=x.service.createOpportunity({title:'Receipt organization',problem:'Receipts are hard to retrieve at home',
   market:'International'});
  assert.throws(()=>x.service.linkDiscoveryCluster(g.id,{fingerprint:g.fingerprint,
   opportunity_id:opportunity.id}),{code:'DISCOVERY_REVIEW_REQUIRED'});
  assert.equal(x.store.get('sources','post1').status,'new');
  const done=x.service.linkDiscoveryCluster(g.id,{fingerprint:g.fingerprint,
    opportunity_id:opportunity.id,acknowledgeUnverified:true});
  assert.equal(done.signalCount,2);assert.equal(done.addedEvidence,2);
  const updated=x.store.get('opportunities',opportunity.id);
  assert.equal(updated.sources.length,2);
  assert.ok(updated.sources.every(e=>e.firsthand===false&&e.independent===false&&!e.reviewedAt));
  assert.equal(x.store.get('sources','post1').status,'converted');
  assert.equal(x.store.get('sources','post2').linkedOpportunityId,opportunity.id);
  assert.equal(discoveryClusters(x.store).total,0);
 }finally{x.close();}
});
test('bulk link rejects stale membership and foreign opportunities without partial writes',()=>{
 const x=setup();try{
  x.insert('post1','Online order receipt storage is painful','forum.example','alice');
  x.insert('post2','Online order receipt storage is painful','other.example','bobby');
  const g=discoveryClusters(x.store).items[0];
  x.insert('post3','Online order receipt storage is painful','other.example','carol');
  const opp=x.service.createOpportunity({title:'Receipt recovery',problem:'Difficulty organizing daily purchase receipts',market:'International'});
  assert.throws(()=>x.service.linkDiscoveryCluster(g.id,{fingerprint:g.fingerprint,
    opportunity_id:opp.id,acknowledgeUnverified:true}),{code:'CLUSTER_CHANGED'});
  assert.equal(x.store.get('opportunities',opp.id).sources.length,0);
  assert.equal(x.store.get('sources','post1').status,'new');
  const current=discoveryClusters(x.store).items[0];
  assert.throws(()=>x.service.linkDiscoveryCluster(current.id,{fingerprint:current.fingerprint,
    opportunity_id:'missing-opp',acknowledgeUnverified:true}),{code:'NOT_FOUND'});
  assert.equal(x.store.get('sources','post2').status,'new');
 }finally{x.close();}
});
test('converted and dismissed signals never populate new candidate group',()=>{
 const x=setup();try{
  x.insert('post1','Receipts lost during online shopping','forum.example');
  x.insert('post2','Receipts lost during online shopping','other.example');
  let before=discoveryClusters(x.store);
  assert.equal(before.total,1);
  let s=x.store.get('sources','post2');x.store.put('sources',{...s,status:'dismissed'},s.revision);
  assert.equal(discoveryClusters(x.store).total,0);
  s=x.store.get('sources','post2');x.store.put('sources',{...s,status:'saved'},s.revision);
  assert.equal(discoveryClusters(x.store).total,1);
  s=x.store.get('sources','post1');x.store.put('sources',{...s,status:'converted'},s.revision);
  assert.equal(discoveryClusters(x.store).total,0);
 }finally{x.close();}
});
