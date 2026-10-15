import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {continueEvidenceComparisons} from '../src/opportunity-evidence-comparison-next.mjs';
import {draftEvidenceComparison} from '../src/opportunity-evidence-comparison.mjs';
import {evidenceReviewBoard,reviewExternalEvidence} from '../src/opportunity-evidence-review.mjs';
const env={RADAR_LLM_BASE_URL:'https://model.example',RADAR_LLM_API_KEY:'fixture',RADAR_LLM_MODEL:'fixture'};
const verdict={taskRelation:'uncertain',relationReason:'需要核对原网页的具体任务。',solutionCoverage:'unknown',coverageReason:'片段不足以确定方案覆盖。',nextCheck:'用原帖输入核对现有办法是否解决相同错误。'};
const response=(v=verdict)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(v)}}]})});
function setup(){
 const db=openDatabase();db.put('sources',{id:'a',status:'new',url:'https://example.org/original',title:'Cannot import CSV into Excel',description:'I manually import CSV every day and spend 3 hours fixing errors.'});
 const ctx=candidateContext(db,'signal:a');
 db.put('opportunity_external_research',{id:'signal:a',candidateFingerprint:ctx.fingerprint,results:[
  {url:'https://example.org/weak',title:'Weak match',triageType:'weak_match'},
  {url:'https://example.org/first',title:'CSV Excel workaround',triageType:'possible_alternative'},
  {url:'https://example.org/second',title:'CSV Excel import issue',triageType:'related_problem_report'}]});
 return {db,input:{candidateFingerprint:ctx.fingerprint,searchRevision:1}};
}
test('bounded continuation prioritizes unreviewed clues, skips saved drafts and accurately stops',async()=>{
 const {db,input}=setup();try{
  const calls=[];const options={env,fetchImpl:async(u,o)=>{calls.push(JSON.parse(JSON.parse(o.body).messages[1].content).external.url);return response();}};
  const first=await continueEvidenceComparisons(db,'signal:a',input,options);
  assert.deepEqual(calls,['https://example.org/first','https://example.org/second']);
  assert.deepEqual(first.progress,{total:3,compared:2,pending:1,available:1,skipped:0});assert.equal(first.status,'more');
  const last=await continueEvidenceComparisons(db,'signal:a',input,options);
  assert.equal(calls[2],'https://example.org/weak');assert.equal(last.status,'complete');
  assert.equal(last.progress.pending,0);assert.equal(last.ownerReviewed,false);assert.equal(last.marketValidated,false);
  assert.equal((await continueEvidenceComparisons(db,'signal:a',input,options)).results.length,0);assert.equal(calls.length,3);
  assert.equal(evidenceReviewBoard(db,'signal:a').reviews.length,0);
 }finally{db.close();}
});
test('failed items stay pending, successes survive, and temporary skips can be retried individually',async()=>{
 const {db,input}=setup();try{
  const options={env,fetchImpl:async(u,o)=>JSON.parse(JSON.parse(o.body).messages[1].content).external.url.endsWith('/first')?response({}):response()};
  const partial=await continueEvidenceComparisons(db,'signal:a',input,options);
  assert.equal(partial.status,'partial');assert.equal(partial.results[0].code,'LLM_INVALID_RESPONSE');
  assert.equal(partial.results[1].status,'saved');assert.equal(partial.progress.compared,1);
  assert.equal(partial.progress.pending,2);assert.equal(partial.progress.skipped,1);
  const next=await continueEvidenceComparisons(db,'signal:a',{...input,skipUrls:partial.skipUrls},options);
  assert.equal(next.progress.compared,2);assert.equal(next.progress.pending,1);assert.equal(next.status,'paused');
  await draftEvidenceComparison(db,'signal:a',{...input,url:partial.skipUrls[0]},{env,fetchImpl:async()=>response()});
  assert.equal((await continueEvidenceComparisons(db,'signal:a',{...input,skipUrls:partial.skipUrls},options)).status,'complete');
 }finally{db.close();}
});
test('invalid limits, arbitrary skip URLs and stale versions cannot start a model request',async()=>{
 const {db,input}=setup();try{
  const options={env,fetchImpl:()=>{throw Error('must not request')}};
  for(const patch of [{limit:0},{limit:3},{limit:1.5},{skipUrls:'bad'},{skipUrls:['https://untrusted.example']}])
   await assert.rejects(continueEvidenceComparisons(db,'signal:a',{...input,...patch},options),{code:'BAD_REQUEST'});
  await assert.rejects(continueEvidenceComparisons(db,'signal:a',{...input,searchRevision:0},options),{code:'STALE_EVIDENCE'});
 }finally{db.close();}
});
test('duplicate concurrent continuations share model calls and release the request lock after failure',async()=>{
 const {db,input}=setup();try{
  let calls=0;const options={env,fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return response();}};
  const both=await Promise.all([continueEvidenceComparisons(db,'signal:a',input,options),continueEvidenceComparisons(db,'signal:a',input,options)]);
  assert.equal(calls,2);assert.equal(both[0].progress.compared,2);assert.equal(both[1].progress.compared,2);
  const item={...input,url:'https://example.org/weak'};let failures=0;
  const failing={env,fetchImpl:async()=>{failures++;throw Error('provider failure')}};
  const rejected=await Promise.allSettled([draftEvidenceComparison(db,'signal:a',item,failing),draftEvidenceComparison(db,'signal:a',item,failing)]);
  assert.ok(rejected.every(x=>x.status==='rejected'));assert.equal(failures,1);
  await draftEvidenceComparison(db,'signal:a',item,options);assert.equal(calls,3);
 }finally{db.close();}
});

test('continuation skips explicit owner-reviewed URLs without treating them as generated model drafts',async()=>{
 const {db,input}=setup();try{
  reviewExternalEvidence(db,'signal:a',{...input,url:'https://example.org/first',expected_revision:0,classification:'uncertain',notes:'Owner still needs to verify the original task context.'});
  const requested=[];const result=await continueEvidenceComparisons(db,'signal:a',input,{env,fetchImpl:async(u,o)=>{
   requested.push(JSON.parse(JSON.parse(o.body).messages[1].content).external.url);return response();}});
  assert.deepEqual(requested,['https://example.org/second','https://example.org/weak']);
  assert.deepEqual(result.progress,{total:3,compared:2,pending:0,available:0,skipped:0});
  assert.equal(result.status,'complete');assert.equal(evidenceReviewBoard(db,'signal:a').reviews.length,1);
 }finally{db.close();}
});
