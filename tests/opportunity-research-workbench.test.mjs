import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {opportunityResearchWorkbench} from '../src/opportunity-research-workbench.mjs';

const setup=db=>{
 db.put('sources',{id:'source-1',status:'new',url:'https://example.org/problem',
  title:'I cannot reconcile invoice records manually',
  description:'I manually reconcile invoices every day and spend hours fixing errors'});
 return opportunityScanCandidates(db).items[0].id;
};
test('workbench combines evidence without mutating owner records',()=>{
 const db=openDatabase();try{
  const id=setup(db),before=db.list('opportunity_external_research').length;
  const result=opportunityResearchWorkbench(db,id);
  assert.equal(result.candidate.id,id);
  assert.equal(result.originalSources.length,1);
  assert.equal(result.nextAction,'external_research');
  assert.equal(result.validatedMarketDemand,false);
  assert.equal(result.readOnly,true);
  assert.equal(result.external.current,false);
  assert.equal(db.list('opportunity_external_research').length,before);
 }finally{db.close();}
});
test('workbench fences stale external search, manual verification and LLM research',()=>{
 const db=openDatabase();try{
  const id=setup(db),ctx=candidateContext(db,id);
  db.put('opportunity_external_research',{id,candidateFingerprint:ctx.fingerprint,results:[{url:'https://github.com/org/app/issues/5',title:'Issue',source:'GitHub Issues'}],sourceStatus:[{source:'GitHub Issues',status:'ok'}]});
  db.put('opportunity_research',{id,sourceFingerprint:ctx.fingerprint,decision:'accept_as_notes',sections:{problem:{text:'draft'}}});
  const current=opportunityResearchWorkbench(db,id);
  assert.equal(current.external.current,true);
  assert.equal(current.aiResearch.current,true);
  assert.equal(current.nextAction,'problem_verification');
  const row=db.get('sources','source-1');
  db.put('sources',{...row,description:row.description+' updated'},row.revision);
  const stale=opportunityResearchWorkbench(db,id);
  assert.equal(stale.external.current,false);
  assert.equal(stale.external.stale,true);
  assert.equal(stale.external.results.length,0);
  assert.equal(stale.aiResearch.current,false);
  assert.equal(stale.aiResearch.sections,null);
 }finally{db.close();}
});
