import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.mjs';import {persistOpportunityIdentities,opportunityIdentityDossier,opportunityIdentityIndex} from '../src/opportunity-identity.mjs';
test('dossier links real observations, feedback and decisions without inventing evidence',()=>{
 const db=openDatabase();try{
  const c={id:'signal:a',title:'Cannot automate weekly invoice workflow',sourceUrls:['https://forum.example/post/1']};
  const first=persistOpportunityIdentities(db,[c])[0];
  db.put('home_opportunity_feedback',{id:'signal:a',verdict:'false_positive',reason:'Original post was actually promotional',at:'2026-10-12T06:00:00Z'});
  db.put('home_opportunity_decisions',{id:'signal:a',action:'dismiss',at:'2026-10-12T06:30:00Z'});
  const d=opportunityIdentityDossier(db,first.identityId);
  assert.equal(d.observations,1);assert.equal(d.events.length,1);assert.equal(d.feedback.length,1);assert.equal(d.decisions.length,1);
  assert.deepEqual(d.sourceUrls,['https://forum.example/post/1']);
  assert.equal(opportunityIdentityIndex(db).items[0].id,first.identityId);
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
test('unknown id returns null and empty knowledge index is honest',()=>{const db=openDatabase();try{assert.equal(opportunityIdentityDossier(db,'missing'),null);assert.deepEqual(opportunityIdentityIndex(db).items,[]);}finally{db.close()}});
