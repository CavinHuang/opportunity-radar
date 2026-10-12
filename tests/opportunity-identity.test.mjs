import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {persistOpportunityIdentities} from '../src/opportunity-identity.mjs';
test('stable identity follows repeated candidate and accumulates evidence',()=>{
 const db=openDatabase();try{
  const a={id:'signal:a',title:'Cannot automate repetitive invoice handling for freelancers',sourceUrls:['https://forum.one/a']};
  const first=persistOpportunityIdentities(db,[a])[0];assert.equal(first.novelty,'new_since_previous_scan');
  const repeat=persistOpportunityIdentities(db,[a])[0];assert.equal(repeat.identityId,first.identityId);assert.equal(repeat.novelty,'seen_before');assert.equal(repeat.observations,2);
  const addition=persistOpportunityIdentities(db,[{id:'signal:b',title:a.title,sourceUrls:['https://forum.two/b']}])[0];
  assert.equal(addition.identityId,first.identityId);assert.equal(addition.novelty,'new_evidence');assert.equal(addition.knownSources,2);
  assert.equal(db.list('home_opportunity_identity_events').length,3);
 }finally{db.close()}
});
test('unrelated topics remain distinct and no opportunities are approved',()=>{
 const db=openDatabase();try{
  const x=persistOpportunityIdentities(db,[{id:'x',title:'Cannot automate expense reimbursements weekly',sourceUrls:['https://a.example/x']}])[0];
  const y=persistOpportunityIdentities(db,[{id:'y',title:'Garden planning with shade-loving native trees',sourceUrls:['https://b.example/y']}])[0];
  assert.notEqual(x.identityId,y.identityId);assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
