import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {homeResearchSummary} from '../src/home-research-summary.mjs';
import {reviewExternalEvidence} from '../src/opportunity-evidence-review.mjs';
import {homeOpportunitySnapshot} from '../src/home-opportunities.mjs';

function setup(){
 const db=openDatabase();db.put('sources',{id:'s1',title:'I cannot import CSV files into Excel',description:'I manually import CSV every day and spend 3 hours fixing errors.',url:'https://forum.example/1',status:'new'});
 const context=candidateContext(db,'signal:s1');
 return {db,context};
}
function search(db,context,status='ok'){
 return db.put('opportunity_external_research',{id:context.candidate.id,candidateFingerprint:context.fingerprint,
  searchedAt:'2026-10-14T13:00:00Z',sourceStatus:[{source:'Hacker News',status}],
  results:[{url:'https://example.org/alternative',title:'CSV Excel import workaround',source:'Hacker News',triageType:'possible_alternative'}],
  analysis:{counts:{weak_match:0,related_discussion:0,related_problem_report:0,possible_alternative:1,solution_with_reported_limits:0}}},db.get('opportunity_external_research',context.candidate.id)?.revision||0);
}
test('missing search stays unknown while current search separates automated hints from zero owner reviews',()=>{
 const {db,context}=setup();try{
  const missing=homeResearchSummary(db,context.candidate);assert.equal(missing.state,'not_searched');assert.equal(missing.progress,null);
  search(db,context);
  const summary=homeResearchSummary(db,context.candidate);
  assert.equal(summary.automatic.possible_alternative,1);assert.equal(summary.ownerClassifications.existing_solution,0);
  assert.deepEqual(summary.progress,{total:1,reviewed:0,pending:1});
  assert.equal(summary.nextAction.action,'workbench-evidence-review');assert.equal(summary.marketValidated,false);
  assert.equal(summary.references[0].verified,false);
 }finally{db.close();}
});
test('owner solution classification directs comparison, not automatic investment; a new search invalidates old classifications',()=>{
 const {db,context}=setup();try{
  const ext=search(db,context);
  reviewExternalEvidence(db,context.candidate.id,{candidateFingerprint:context.fingerprint,searchRevision:ext.revision,
   expected_revision:0,url:'https://example.org/alternative',classification:'existing_solution',notes:'Owner notes: inspect the described import workaround.'});
  let summary=homeResearchSummary(db,context.candidate);
  assert.equal(summary.state,'reviewed');assert.equal(summary.nextAction.action,'workbench-alternatives');
  assert.equal(summary.canAutoInvest,false);assert.equal(summary.independentConsumers,'unknown');
  search(db,context);summary=homeResearchSummary(db,context.candidate);
  assert.equal(summary.ownerClassifications.existing_solution,0);assert.equal(summary.state,'needs_review');
 }finally{db.close();}
});
test('source changes hide outdated counts and links; partial provider coverage never means complete research',()=>{
 const {db,context}=setup();try{
  search(db,context,'partial');
  assert.equal(homeResearchSummary(db,context.candidate).nextAction.action,'external-research');
  const source=db.get('sources','s1');db.put('sources',{...source,description:source.description+' New current evidence.'},source.revision);
  const summary=homeResearchSummary(db,candidateContext(db,'signal:s1').candidate);
  assert.equal(summary.state,'stale');assert.equal(summary.progress,null);assert.equal(summary.automatic,null);assert.deepEqual(summary.references,[]);
 }finally{db.close();}
});
test('homepage attaches existing research summary without writing records or performing searches',()=>{
 const {db,context}=setup();try{
  search(db,context);db.put('home_opportunity_scans',{id:'latest',status:'filtered',items:[{id:'signal:s1',title:context.candidate.title,sourceUrls:context.candidate.sourceUrls}]});
  const before=db.eventsLatest(400).length;
  assert.equal(homeOpportunitySnapshot(db).items[0].researchSummary.state,'needs_review');
  assert.equal(db.eventsLatest(400).length,before);assert.equal(db.list('opportunities').length,0);
 }finally{db.close();}
});
test('a source change beyond the short research excerpt invalidates saved search evidence',()=>{
 const {db}=setup();try{
  const s=db.get('sources','s1');db.put('sources',{...s,description:s.description+' Context.'.repeat(60)+' Original ending.'},s.revision);
  const original=candidateContext(db,'signal:s1');search(db,original);
  const saved=db.get('sources','s1');db.put('sources',{...saved,description:saved.description.replace('Original ending.','Different ending.')},saved.revision);
  const changed=candidateContext(db,'signal:s1');
  assert.equal(original.sources[0].excerpt,changed.sources[0].excerpt);
  assert.notEqual(original.fingerprint,changed.fingerprint);
  assert.equal(homeResearchSummary(db,changed.candidate).state,'stale');
 }finally{db.close();}
});

test('finishing priority clues leaves weak results pending and directs a false-negative review',()=>{
 const {db,context}=setup();try{
  const ext=search(db,context);
  const current=db.put('opportunity_external_research',{...ext,results:[...ext.results,{url:'https://example.org/weak',triageType:'weak_match'}]},ext.revision);
  reviewExternalEvidence(db,context.candidate.id,{candidateFingerprint:context.fingerprint,searchRevision:current.revision,
   expected_revision:0,url:'https://example.org/alternative',classification:'uncertain',notes:'This clue still needs actual feature verification.'});
  const summary=homeResearchSummary(db,context.candidate);
  assert.equal(summary.state,'partially_reviewed');
  assert.deepEqual(summary.progress,{total:2,reviewed:1,pending:1});
  assert.deepEqual(summary.priorityProgress,{total:1,reviewed:1,pending:0});
  assert.equal(summary.nextAction.label,'复查弱相关与未分组结果');
  assert.equal(summary.marketValidated,false);
 }finally{db.close();}
});
