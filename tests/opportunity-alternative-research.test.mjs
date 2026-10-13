import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {reviewExternalEvidence} from '../src/opportunity-evidence-review.mjs';
import {alternativeResearchBoard,recordAlternativeResearch} from '../src/opportunity-alternative-research.mjs';
import {opportunityResearchWorkbench} from '../src/opportunity-research-workbench.mjs';

function seed(db){
 db.put('sources',{id:'invoice-1',status:'new',url:'https://example.org/help',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
 const id=opportunityScanCandidates(db).items[0].id,ctx=candidateContext(db,id);
 const search=db.put('opportunity_external_research',{id,candidateFingerprint:ctx.fingerprint,
 results:[{url:'https://github.com/acme/invoice/issues/1',title:'Existing workflow',source:'GitHub Issues'}],sourceStatus:[{source:'GitHub Issues',status:'ok',count:1}]});
 return {id,ctx,search,url:'https://github.com/acme/invoice/issues/1'};
}
test('only owner-reviewed existing solutions can be investigated with missing price kept unknown',()=>{
 const db=openDatabase();try{
  const {id,ctx,search,url}=seed(db);
  assert.throws(()=>recordAlternativeResearch(db,id,{url,expected_revision:0}),{code:'NOT_REVIEWED_SOLUTION'});
  const review=reviewExternalEvidence(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,url,classification:'existing_solution',notes:'人工检查链接后认为可能是现有替代方案',expected_revision:0});
  const board=alternativeResearchBoard(db,id);
  assert.equal(board.eligible.length,1);
  const saved=recordAlternativeResearch(db,id,{url,name:'Invoice helper',capabilities:'CSV import',priceEvidence:'',reportedLimitations:'',notes:'只核对了已公开的导入功能，其余能力未知',candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,reviewRevision:review.revision,expected_revision:0});
  assert.equal(saved.revision,1);
  assert.equal(alternativeResearchBoard(db,id).items[0].priceEvidence,null);
  assert.equal(opportunityResearchWorkbench(db,id).alternatives.items.length,1);
  assert.throws(()=>recordAlternativeResearch(db,id,{url,name:'Other',notes:'人工核对的证据还不足以确认功能',candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,reviewRevision:review.revision,expected_revision:0}),{code:'REVISION_CONFLICT'});
 }finally{db.close();}
});
test('changing evidence classification or search version expires alternative notes',()=>{
 const db=openDatabase();try{
  const {id,ctx,search,url}=seed(db);
  const rev=reviewExternalEvidence(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,url,classification:'existing_solution',notes:'原帖中提到了一个替代产品的使用方法',expected_revision:0});
  recordAlternativeResearch(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,reviewRevision:rev.revision,expected_revision:0,url,name:'Invoice workflow',notes:'只能确认这条链接有功能相关讨论'});
  reviewExternalEvidence(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,url,classification:'not_relevant',notes:'进一步核查发现该链接不是相关解决方案',expected_revision:rev.revision});
  assert.equal(alternativeResearchBoard(db,id).stale,true);
  assert.equal(alternativeResearchBoard(db,id).items.length,0);
  db.put('opportunity_external_research',{...search,searchedAt:new Date().toISOString()},search.revision);
  assert.equal(alternativeResearchBoard(db,id).items.length,0);
 }finally{db.close();}
});
