import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase} from '../src/db.mjs';import {persistOpportunityIdentities,splitOpportunityIdentity,resolveOpportunityIdentity,opportunityIdentityDossier} from '../src/opportunity-identity.mjs';
test('owner can split accidental matching and future scans honor separation',()=>{
 const db=openDatabase();try{
 const title='Cannot automate weekly invoice workflow for freelancers';
 const a={id:'signal:a',title,sourceUrls:['https://forum.example/a']};
 const b={id:'signal:b',title,sourceUrls:['https://forum.example/b']};
 const first=persistOpportunityIdentities(db,[a])[0];const combined=persistOpportunityIdentities(db,[b])[0];assert.equal(combined.identityId,first.identityId);
 const original=db.get('home_opportunity_identities',first.identityId);
 assert.throws(()=>splitOpportunityIdentity(db,original.id,{candidateId:'signal:b',reason:'short',expected_revision:original.revision}),{code:'REASON_REQUIRED'});
 const moved=splitOpportunityIdentity(db,original.id,{candidateId:'signal:b',reason:'Two distinctly unrelated customer scenarios',expected_revision:original.revision});
 assert.notEqual(moved.toIdentityId,first.identityId);
 assert.equal(opportunityIdentityDossier(db,moved.toIdentityId).events.length,1);
 assert.equal(opportunityIdentityDossier(db,first.identityId).events.length,1);
 assert.equal(resolveOpportunityIdentity(db,b).id,moved.toIdentityId);
 assert.equal(resolveOpportunityIdentity(db,a).id,first.identityId);
 assert.equal(db.list('home_identity_separations').length,1);
 assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
