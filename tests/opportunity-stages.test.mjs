import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {opportunityStage} from '../src/opportunity-stages.mjs';
import {verificationContext} from '../src/problem-verification.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
const fixture=db=>{
 db.put('sources',{id:'s1',url:'https://example.org/problem',status:'new',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
 return opportunityScanCandidates(db).items[0].id;
};
test('unreviewed or missing external search cannot elevate real opportunity stage',()=>{
 const db=openDatabase();try{
  const id=fixture(db);
  const s=opportunityStage(db,id);
  assert.equal(s.stage,'insufficient_evidence');
  assert.equal(s.validatedMarketDemand,false);
  assert.equal(s.mayAutoInvest,false);
  assert.ok(s.gaps.some(x=>x.includes('外部反证')));
 }finally{db.close();}
});
test('external results promote only to further investigation, never business validation',()=>{
 const db=openDatabase();try{
  const id=fixture(db),ctx=candidateContext(db,id);
  db.put('opportunity_external_research',{id,candidateFingerprint:ctx.fingerprint,results:[{url:'https://github.com/org/repo/issues/3'}],sourceStatus:[{source:'GitHub Issues',status:'ok',count:1}]});
  const stage=opportunityStage(db,id);
  assert.equal(stage.stage,'worth_investigating');
  assert.equal(stage.reviewedProblem,false);
  assert.equal(stage.validatedMarketDemand,false);
  const source=db.get('sources','s1');
  db.put('sources',{...source,description:source.description+' more evidence'},source.revision);
  const stale=opportunityStage(db,id);
  assert.equal(stale.stage,'insufficient_evidence');
  assert.equal(stale.evidenceFresh.externalResearch,false);
 }finally{db.close();}
});
test('manual problem review alone cannot skip interviews and experiment gate',()=>{
 const db=openDatabase();try{
  const id=fixture(db),ctx=candidateContext(db,id),review=verificationContext(db,id);
  db.put('opportunity_external_research',{id,candidateFingerprint:ctx.fingerprint,results:[],sourceStatus:[{source:'Hacker News',status:'ok',count:0}]});
  db.put('problem_verifications',{id,fingerprint:review.fingerprint,firsthandConfirmed:true,impactConfirmed:true,alternativeAdequacy:'inadequate',actualWorkaround:'manual spreadsheet',decision:'worth_interviewing'});
  const stage=opportunityStage(db,id);
  assert.equal(stage.stage,'worth_investigating');
  assert.equal(stage.reviewedProblem,true);
  assert.ok(stage.gaps.some(x=>x.includes('访谈')));
 }finally{db.close();}
});
