import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {opportunityFeasibilityBoard,saveOpportunityFeasibility} from '../src/opportunity-feasibility.mjs';
import {opportunityResearchWorkbench} from '../src/opportunity-research-workbench.mjs';
const seed=db=>{
 db.put('sources',{id:'invoice-one',status:'new',url:'https://example.org/problem',
 title:'I cannot reconcile invoice records manually',
 description:'I manually reconcile invoices every day and spend hours fixing errors'});
 return opportunityScanCandidates(db).items[0].id;
};
const payload=b=>({candidateFingerprint:b.candidateFingerprint,competitionRevision:b.competitionRevision,
 verificationRevision:b.verificationRevision,expected_revision:b.revision,
 technicalScope:'Data integration complexity and secure parsing may require significant engineering.',
 falsifier:'If nobody experiences repeated invoice reconciliation pain, stop the investigation.'});
test('feasibility remains uncertain even with complete notes and preserves unknown demand',()=>{
 const db=openDatabase();try{
  const id=seed(db),initial=opportunityFeasibilityBoard(db,id);
  assert.equal(initial.marketValidated,false);
  assert.equal(initial.readiness,'research_incomplete');
  const saved=saveOpportunityFeasibility(db,id,payload(initial));
  assert.equal(saved.revision,1);
  const next=opportunityFeasibilityBoard(db,id);
  assert.equal(next.current,true);
  assert.equal(next.inputs.paymentEvidence,'');
  assert.equal(next.marketValidated,false);
  assert.equal(next.automaticInvestment,false);
  assert.equal(opportunityResearchWorkbench(db,id).feasibility.current,true);
  assert.ok(opportunityResearchWorkbench(db,id).timeline.some(x=>x.kind==='opportunity.feasibility.reviewed'));
  assert.throws(()=>saveOpportunityFeasibility(db,id,payload(initial)),{code:'REVISION_CONFLICT'});
 }finally{db.close();}
});
test('candidate changes invalidate stored feasibility and reject stale writes',()=>{
 const db=openDatabase();try{
  const id=seed(db),baseline=opportunityFeasibilityBoard(db,id);
  saveOpportunityFeasibility(db,id,payload(baseline));
  const src=db.get('sources','invoice-one');
  db.put('sources',{...src,description:src.description+' revised'},src.revision);
  const changed=opportunityFeasibilityBoard(db,id);
  assert.equal(changed.current,false);
  assert.equal(changed.stale,true);
  assert.equal(changed.inputs,null);
  assert.throws(()=>saveOpportunityFeasibility(db,id,payload(baseline)),{code:'STALE_EVIDENCE'});
 }finally{db.close();}
});
test('mandatory research notes and falsifiers cannot be blank',()=>{
 const db=openDatabase();try{
  const id=seed(db),b=opportunityFeasibilityBoard(db,id);
  assert.throws(()=>saveOpportunityFeasibility(db,id,{...payload(b),technicalScope:''}),{code:'REVIEW_INCOMPLETE'});
 }finally{db.close();}
});
