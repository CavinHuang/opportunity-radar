import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {reviewExternalEvidence} from '../src/opportunity-evidence-review.mjs';
import {recordAlternativeResearch} from '../src/opportunity-alternative-research.mjs';
import {opportunityCompetitionSpace} from '../src/opportunity-competition-space.mjs';
import {opportunityResearchWorkbench} from '../src/opportunity-research-workbench.mjs';

function setup(db){
 db.put('sources',{id:'s',status:'new',url:'https://example.org/problem',
 title:'I cannot reconcile invoice records manually',
 description:'I manually reconcile invoices every day and spend hours fixing errors'});
 const id=opportunityScanCandidates(db).items[0].id,ctx=candidateContext(db,id);
 const search=db.put('opportunity_external_research',{id,candidateFingerprint:ctx.fingerprint,
 results:[{url:'https://github.com/acme/tool/issues/4',title:'Alternative tool',source:'GitHub Issues'}],
 sourceStatus:[{source:'GitHub Issues',status:'ok',count:1}]});
 return {id,ctx,search,url:'https://github.com/acme/tool/issues/4'};
}
test('no competitors found is not proof of a market gap',()=>{
 const db=openDatabase();try{
  const {id}=setup(db),r=opportunityCompetitionSpace(db,id);
  assert.equal(r.assessment,'insufficient_comparison_evidence');
  assert.equal(r.marketGapVerified,false);
  assert.equal(r.items.length,0);
  assert.ok(r.missing.some(x=>x.includes('不能视为市场空白')));
 }finally{db.close();}
});
test('reviewed alternatives preserve unknown prices and claim uncertainty',()=>{
 const db=openDatabase();try{
  const {id,ctx,search,url}=setup(db);
  const rev=reviewExternalEvidence(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,
   url,classification:'existing_solution',notes:'已确认该问题讨论可能关联现有工具',expected_revision:0});
  recordAlternativeResearch(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,
   reviewRevision:rev.revision,expected_revision:0,url,name:'Possible tool',
   capabilities:'Only CSV import described',reportedLimitations:'One user complains of missing matching',
   notes:'还未独立确认功能清单及投诉真实性'});
  const r=opportunityCompetitionSpace(db,id);
  assert.equal(r.counts.investigatedAlternatives,1);
  assert.equal(r.items[0].pricing.status,'unknown');
  assert.equal(r.items[0].limitations.status,'owner_reported_unverified');
  assert.equal(r.marketGapVerified,false);
  assert.equal(opportunityResearchWorkbench(db,id).competitionSpace.items.length,1);
  const row=db.get('sources','s');
  db.put('sources',{...row,description:row.description+' updated'},row.revision);
  const stale=opportunityCompetitionSpace(db,id);
  assert.equal(stale.items.length,0);
  assert.equal(stale.marketGapVerified,false);
 }finally{db.close();}
});
