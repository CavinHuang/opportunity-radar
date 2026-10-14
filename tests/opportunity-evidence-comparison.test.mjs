import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {evidenceReviewBoard} from '../src/opportunity-evidence-review.mjs';
import {draftEvidenceComparison} from '../src/opportunity-evidence-comparison.mjs';

const env={RADAR_LLM_BASE_URL:'https://model.example',RADAR_LLM_API_KEY:'fixture',RADAR_LLM_MODEL:'fixture'};
function setup(path){
 const db=openDatabase(path);db.put('sources',{id:'a',status:'new',url:'https://forum.example/1',
  title:'I cannot import CSV files into Excel',description:'I manually import CSV every day and spend 3 hours fixing errors.'});
 const ctx=candidateContext(db,'signal:a');
 const ext=db.put('opportunity_external_research',{id:'signal:a',candidateFingerprint:ctx.fingerprint,
  results:[{url:'https://github.com/org/app/issues/1',title:'CSV Excel import workaround',excerpt:'The importer skips malformed rows but still needs manual fixes.'}]});
 return {db,input:{url:ext.results[0].url,candidateFingerprint:ctx.fingerprint,searchRevision:ext.revision}};
}
const verdict=()=>({taskRelation:'same_task',relationReason:'两处都涉及导入CSV，但根因与独立用户仍需核实。',
 originalEvidence:{sourceId:'a',quote:'I manually import CSV every day'},externalEvidence:{quote:'still needs manual fixes'},
 solutionCoverage:'reported_partial',coverageReason:'片段描述跳过异常行，尚不能证明解决原帖问题。',coverageQuote:'The importer skips malformed rows',nextCheck:'用原帖异常CSV复现；若现有导入器无须手工修复，则撤回缺口假设。'});
const response=x=>async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(x)}}]})});

test('task comparison uses quoted saved text, asks a falsifiable follow-up and writes no evidence or owner reviews',async()=>{
 const {db,input}=setup();try{
  const before=db.eventsLatest(400).length;let requested;
  const draft=await draftEvidenceComparison(db,'signal:a',input,{env,fetchImpl:async(url,options)=>{
   requested={url,body:JSON.parse(options.body)};return response(verdict())();}});
  assert.equal(requested.url.href,'https://model.example/chat/completions');
  const prompt=JSON.parse(requested.body.messages[1].content);assert.equal(prompt.originals[0].sourceId,'a');
  assert.equal(prompt.external.url,input.url);assert.equal(draft.comparison.solutionCoverage,'reported_partial');
  assert.equal(draft.comparison.originalEvidence.url,'https://forum.example/1');
  assert.equal(draft.readOnly,false);assert.equal(draft.ownerReviewed,false);assert.equal(draft.marketValidated,false);
  assert.equal(db.eventsLatest(400).length,before);assert.equal(db.list('opportunity_evidence_reviews').length,0);
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close();}
});
test('unknown comparison can remain unknown without invented quotes or absence claims',async()=>{
 const {db,input}=setup();try{
  const v={...verdict(),taskRelation:'uncertain',originalEvidence:null,externalEvidence:null,solutionCoverage:'not_described',coverageQuote:'',coverageReason:'片段未描述方案，不能证明没有方案。'};
  const d=await draftEvidenceComparison(db,'signal:a',input,{env,fetchImpl:response(v)});
  assert.equal(d.comparison.externalEvidence,null);assert.equal(d.comparison.originalEvidence,null);
 }finally{db.close();}
});
test('fabricated, absent, blank and wrong-source citations cannot support a definite task or coverage judgment',async()=>{
 const {db,input}=setup();try{
  for(const patch of [
   {externalEvidence:{quote:'invented capability not present'}},
   {originalEvidence:{sourceId:'unknown',quote:'I manually import CSV every day'}},
   {coverageQuote:'Supports every Windows task'},
   {coverageQuote:'        '},{externalEvidence:null},{coverageQuote:''}
  ])await assert.rejects(draftEvidenceComparison(db,'signal:a',input,{env,fetchImpl:response({...verdict(),...patch})}),{code:'LLM_UNGROUNDED_QUOTE'});
 }finally{db.close();}
});
test('unknown URLs and outdated caller search versions fail before any model request',async()=>{
 const {db,input}=setup();try{
  const options={env,fetchImpl:()=>{throw Error('must not call model')}};
  await assert.rejects(draftEvidenceComparison(db,'signal:a',{...input,url:'https://attacker.example'},options),{code:'UNKNOWN_EVIDENCE'});
  await assert.rejects(draftEvidenceComparison(db,'signal:a',{...input,searchRevision:0},options),{code:'STALE_EVIDENCE'});
 }finally{db.close();}
});
test('source edits and searches during model execution invalidate the returned draft',async()=>{
 for(const kind of ['source','search']){
  const {db,input}=setup();try{
   await assert.rejects(draftEvidenceComparison(db,'signal:a',input,{env,fetchImpl:async()=>{
    if(kind==='source'){const s=db.get('sources','a');db.put('sources',{...s,description:s.description+' New evidence.'},s.revision);}
    else{const s=db.get('opportunity_external_research','signal:a');db.put('opportunity_external_research',{...s,searchedAt:'changed'},s.revision);}
    return response(verdict())();}}),{code:'STALE_EVIDENCE'});
  }finally{db.close();}
 }
});
test('missing model config, provider failures and malformed output preserve manual review availability',async()=>{
 const {db,input}=setup();try{
  await assert.rejects(draftEvidenceComparison(db,'signal:a',input,{env:{}}),{code:'LLM_NOT_CONFIGURED'});
  await assert.rejects(draftEvidenceComparison(db,'signal:a',input,{env,fetchImpl:async()=>({ok:false,status:503})}),{code:'LLM_HTTP_ERROR'});
  await assert.rejects(draftEvidenceComparison(db,'signal:a',input,{env,fetchImpl:response({...verdict(),taskRelation:'validated'})}),{code:'LLM_INVALID_RESPONSE'});
  assert.equal(db.get('opportunity_external_research','signal:a').revision,1);
 }finally{db.close();}
});

test('saved drafts are reused without a model request; explicit refresh replaces only the automatic draft',async()=>{
 const {db,input}=setup();try{
  let calls=0;const options={env,fetchImpl:async()=>{calls++;return response(verdict())();}};
  const first=await draftEvidenceComparison(db,'signal:a',input,options);
  const row=db.get('opportunity_evidence_comparisons','signal:a');
  const again=await draftEvidenceComparison(db,'signal:a',input,{env:{},fetchImpl:()=>{throw Error('no request')}});
  assert.equal(again.cached,true);assert.equal(again.readOnly,true);assert.equal(again.generatedAt,first.generatedAt);
  assert.equal(db.get('opportunity_evidence_comparisons','signal:a').revision,row.revision);
  await draftEvidenceComparison(db,'signal:a',{...input,refresh:true},options);
  assert.equal(calls,2);assert.equal(db.get('opportunity_evidence_comparisons','signal:a').revision,row.revision+1);
  assert.equal(evidenceReviewBoard(db,'signal:a').reviews.length,0);
  await assert.rejects(draftEvidenceComparison(db,'signal:a',{...input,refresh:true},{env,fetchImpl:response({...verdict(),coverageQuote:'fabricated support'})}),{code:'LLM_UNGROUNDED_QUOTE'});
  assert.equal(db.get('opportunity_evidence_comparisons','signal:a').revision,row.revision+1);
 }finally{db.close();}
});
test('search revisions, source changes and comparison policy changes hide old drafts without deleting history',async()=>{
 for(const kind of ['search','source','policy']){
  const {db,input}=setup();try{
   await draftEvidenceComparison(db,'signal:a',input,{env,fetchImpl:response(verdict())});
   if(kind==='search'){const r=db.get('opportunity_external_research','signal:a');db.put('opportunity_external_research',{...r,searchedAt:'new'},r.revision);}
   if(kind==='source'){const r=db.get('sources','a');db.put('sources',{...r,description:r.description+' Changed'},r.revision);}
   if(kind==='policy'){const r=db.get('opportunity_evidence_comparisons','signal:a');db.put('opportunity_evidence_comparisons',{...r,policy:'old-policy'},r.revision);}
   assert.equal(evidenceReviewBoard(db,'signal:a').comparisons.length,0);
   assert.equal(db.get('opportunity_evidence_comparisons','signal:a').items.length,1);
  }finally{db.close();}
 }
});
test('concurrent comparisons merge distinct URLs and do not erase earlier saved drafts',async()=>{
 const {db,input}=setup();try{
  const ext=db.get('opportunity_external_research','signal:a');
  const second={...ext.results[0],url:'https://github.com/org/app/issues/2'};
  const newer=db.put('opportunity_external_research',{...ext,results:[...ext.results,second]},ext.revision);
  input.searchRevision=newer.revision;
  const options={env,fetchImpl:response(verdict())};
  await Promise.all([draftEvidenceComparison(db,'signal:a',input,options),draftEvidenceComparison(db,'signal:a',{...input,url:second.url},options)]);
  assert.equal(evidenceReviewBoard(db,'signal:a').comparisons.length,2);
  assert.equal(evidenceReviewBoard(db,'signal:a').reviews.length,0);
 }finally{db.close();}
});

test('automatic comparison drafts survive closing and reopening SQLite without creating owner reviews',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-comparison-cache-')),file=join(dir,'radar.sqlite');
 let db;
 try{
  const seeded=setup(file);db=seeded.db;
  const draft=await draftEvidenceComparison(db,'signal:a',seeded.input,{env,fetchImpl:response(verdict())});
  db.close();db=openDatabase(file);
  const cached=await draftEvidenceComparison(db,'signal:a',seeded.input,{env:{},fetchImpl:()=>{throw Error('must reuse')}});
  assert.equal(cached.cached,true);assert.equal(cached.generatedAt,draft.generatedAt);
  assert.equal(evidenceReviewBoard(db,'signal:a').comparisons.length,1);assert.equal(evidenceReviewBoard(db,'signal:a').reviews.length,0);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
