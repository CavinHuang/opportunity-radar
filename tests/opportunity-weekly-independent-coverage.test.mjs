import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {saveWeeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
import {weeklyHypothesisBoard,saveWeeklyHypothesis} from '../src/opportunity-weekly-hypotheses.mjs';
import {reviewWeeklyEvidenceProvenance} from '../src/opportunity-weekly-provenance.mjs';
import {weeklyIndependentEvidenceCoverage} from '../src/opportunity-weekly-independent-coverage.mjs';
test('three evidence events with tracking variants of same source count as one origin',()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'s1',status:'new',url:'https://example.org/post',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
  const id=opportunityScanCandidates(db).items[0].id,now=new Date(),opts={now};
  saveWeeklyResearchPlan(db,{expected_revision:0,items:[{candidateId:id,task:'观察有实际发票对账问题的用户行为和频率',hours:2,budget:0}]},opts);
  db.event('problem.interview.observed',id,'owner',{observationId:'a'});
  db.event('problem.interview.observed',id,'owner',{observationId:'b'});
  db.event('problem.interview.observed',id,'owner',{observationId:'c'});
  const board=weeklyHypothesisBoard(db,opts),seqs=board.items[0].eligibleEvidence.filter(x=>x.kind==='problem.interview.observed').map(x=>x.seq);
  saveWeeklyHypothesis(db,{candidateId:id,planRevision:1,expected_revision:0,
   hypothesis:'两个不同用户每周都需要手动完成繁琐发票核对',
   expectedEvidence:'来自不同原始来源的独立可核查工作记录',
   falsifier:'记录都来自同一个用户或者不同网站的转载',finding:'supported',
   rationale:'实际观察来源仍需经过人工真实性复核',eventSeqs:seqs},opts);
  const sources=['https://example.org/post?utm_source=a','https://example.org/post','https://example.org/post?fbclid=1'];
  for(let i=0;i<2;i++)reviewWeeklyEvidenceProvenance(db,{candidateId:id,seq:seqs[i],classification:'independent_firsthand',origin:sources[i],rationale:'人工查验来源页面并记录了实际原始入口',planRevision:1,expected_revision:i},opts);
  let coverage=weeklyIndependentEvidenceCoverage(db,opts).rows[0];
  assert.equal(coverage.sourceCoverage.reviewedOrigins,1);
  assert.equal(coverage.sourceCoverage.duplicateEventCount,1);
  assert.equal(coverage.sourceCoverage.unverifiedEventCount,1);
  assert.equal(coverage.calibration,'human_judgement_only');
  reviewWeeklyEvidenceProvenance(db,{candidateId:id,seq:seqs[2],classification:'repost',origin:sources[2],rationale:'确认该事件是相同原帖的第三次转载记录',planRevision:1,expected_revision:2},opts);
  coverage=weeklyIndependentEvidenceCoverage(db,opts).rows[0];
  assert.equal(coverage.sourceCoverage.reviewedOrigins,1);
  assert.equal(coverage.sourceCoverage.duplicateEventCount,2);
  assert.equal(coverage.sourceCoverage.nonIndependentOrigins,1);
  assert.equal(coverage.sourceCoverage.unverifiedEventCount,0);
  assert.equal(coverage.calibration,'requires_review');
 }finally{db.close();}
});
test('empty history reports no invented market validation',()=>{
 const db=openDatabase();try{
 const report=weeklyIndependentEvidenceCoverage(db);
 assert.deepEqual(report.rows,[]);
 assert.equal(report.marketValidated,false);
 }finally{db.close();}
});
