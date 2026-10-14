import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {evidenceReviewBoard,evidenceReviewQueue,reviewExternalEvidence} from '../src/opportunity-evidence-review.mjs';
import {opportunityResearchWorkbench} from '../src/opportunity-research-workbench.mjs';

function setup(db){
 db.put('sources',{id:'source-1',status:'new',url:'https://example.org/problem',
 title:'I cannot reconcile invoice records manually',
 description:'I manually reconcile invoices every day and spend hours fixing errors'});
 const id=opportunityScanCandidates(db).items[0].id,ctx=candidateContext(db,id);
 const search=db.put('opportunity_external_research',{id,candidateFingerprint:ctx.fingerprint,
 results:[{url:'https://github.com/org/repo/issues/5',title:'A possible workaround',source:'GitHub Issues'}],
 sourceStatus:[{source:'GitHub Issues',status:'ok',count:1}]});
 return {id,ctx,search};
}
test('review only URLs from current search and guard concurrent revisions',()=>{
 const db=openDatabase();try{
 const {id,ctx,search}=setup(db);
 assert.throws(()=>reviewExternalEvidence(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,
  url:'https://attacker.example/',classification:'existing_solution',notes:'人工核对现有解决方案存在',expected_revision:0}),{code:'UNKNOWN_EVIDENCE'});
 const input={candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,
  url:'https://github.com/org/repo/issues/5',classification:'existing_solution',notes:'核对原帖后发现一个候选替代方案，功能还需检查',expected_revision:0};
 const row=reviewExternalEvidence(db,id,input);
 assert.equal(row.revision,1);
 assert.equal(evidenceReviewBoard(db,id).reviews.length,1);
 assert.throws(()=>reviewExternalEvidence(db,id,input),{code:'REVISION_CONFLICT'});
 const workbench=opportunityResearchWorkbench(db,id);
 assert.equal(workbench.evidenceReview.reviews.length,1);
 assert.ok(workbench.timeline.some(x=>x.kind==='opportunity.external_evidence.reviewed'));
 assert.equal(workbench.validatedMarketDemand,false);
 }finally{db.close();}
});
test('new search invalidates review and source edits expire all current claims',()=>{
 const db=openDatabase();try{
 const {id,ctx,search}=setup(db);
 reviewExternalEvidence(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,
  url:'https://github.com/org/repo/issues/5',classification:'uncertain',notes:'尚不能确认这条讨论是否真的有关联',expected_revision:0});
 db.put('opportunity_external_research',{...search,searchedAt:new Date().toISOString()},search.revision);
 const stale=evidenceReviewBoard(db,id);
 assert.equal(stale.stale,true);
 assert.equal(stale.reviews.length,0);
 assert.throws(()=>reviewExternalEvidence(db,id,{candidateFingerprint:ctx.fingerprint,searchRevision:search.revision,
  url:'https://github.com/org/repo/issues/5',classification:'uncertain',notes:'重新检查这个线索',expected_revision:1}),{code:'STALE_EVIDENCE'});
 const s=db.get('sources','source-1');
 db.put('sources',{...s,description:s.description+' updated'},s.revision);
 assert.equal(evidenceReviewBoard(db,id).current,false);
 assert.equal(opportunityResearchWorkbench(db,id).evidenceReview.reviews.length,0);
 }finally{db.close();}
});

test('review queue preserves every hit and separates automatic priority from explicit owner classification',()=>{
 const hits=[{url:'weak',triageType:'weak_match'},{url:'problem',triageType:'related_problem_report'},
  {url:'solution',triageType:'possible_alternative'},{url:'discussion',triageType:'related_discussion'},
  {url:'limits',triageType:'solution_with_reported_limits'},{url:'legacy'},{url:'future',triageType:'unknown_future_type'}];
 const q=evidenceReviewQueue(hits,[{url:'solution',classification:'uncertain'},{url:'missing'}]);
 assert.deepEqual(q.priority.map(x=>x.url),['problem','discussion','limits']);
 assert.deepEqual(q.other.map(x=>x.url),['weak','legacy','future']);
 assert.deepEqual(q.reviewed.map(x=>x.url),['solution']);
 assert.deepEqual(q.priorityProgress,{total:4,reviewed:1,pending:3});
 assert.equal(new Set([...q.priority,...q.other,...q.reviewed].map(x=>x.url)).size,hits.length);
});
test('stale search exposes no review queue or old priority progress',()=>{
 const db=openDatabase();try{
  const {id}=setup(db);const source=db.get('sources','source-1');
  db.put('sources',{...source,description:source.description+' New evidence'},source.revision);
  assert.deepEqual(evidenceReviewBoard(db,id).queue,{priority:[],other:[],differentTask:[],reviewed:[],priorityProgress:{total:0,reviewed:0,pending:0}});
 }finally{db.close();}
});
test('model task judgments adjust priority but remain separate from owner reviews and preserve every URL',()=>{
 const hits=[{url:'rejected',triageType:'possible_alternative'},{url:'lexical',triageType:'related_discussion'},
  {url:'promoted',triageType:'weak_match'},{url:'unknown',triageType:'weak_match'}];
 const drafts=[{url:'rejected',comparison:{taskRelation:'different_task'}},{url:'promoted',comparison:{taskRelation:'same_task'}}];
 const q=evidenceReviewQueue(hits,[],drafts);
 assert.deepEqual(q.priority.map(x=>x.url),['promoted','lexical']);assert.deepEqual(q.differentTask.map(x=>x.url),['rejected']);
 assert.deepEqual(q.other.map(x=>x.url),['unknown']);assert.equal(q.reviewed.length,0);
 assert.equal(new Set([...q.priority,...q.other,...q.differentTask,...q.reviewed].map(x=>x.url)).size,4);
 assert.deepEqual(q.priorityProgress,{total:2,reviewed:0,pending:2});
 const owner=evidenceReviewQueue(hits,[{url:'rejected',classification:'related_problem'}],drafts);
 assert.equal(owner.reviewed[0].url,'rejected');assert.equal(owner.differentTask.length,0);
});
