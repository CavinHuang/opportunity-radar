import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {saveWeeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
import {weeklyHypothesisBoard,saveWeeklyHypothesis} from '../src/opportunity-weekly-hypotheses.mjs';
import {weeklyEvidenceProvenance,reviewWeeklyEvidenceProvenance} from '../src/opportunity-weekly-provenance.mjs';
import {weeklyConclusionQualityReview} from '../src/opportunity-weekly-conclusion-quality.mjs';
test('only current weekly candidate events can be reviewed; duplicate origins reach conclusion audit',()=>{
 const db=openDatabase();try{
 db.put('sources',{id:'a',status:'new',url:'https://example.org/a',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
 const id=opportunityScanCandidates(db).items[0].id,now=new Date(),options={now};
 saveWeeklyResearchPlan(db,{expected_revision:0,items:[{candidateId:id,task:'观察不同真实用户如何处理发票数据',hours:2,budget:0}]},options);
 db.event('problem.interview.observed',id,'owner',{observationId:'first'});
 db.event('problem.interview.observed',id,'owner',{observationId:'second'});
 db.event('problem.interview.observed','other','owner',{observationId:'unrelated'});
 const board=weeklyEvidenceProvenance(db,options),events=board.events;
 assert.equal(events.length,2);
 assert.throws(()=>reviewWeeklyEvidenceProvenance(db,{candidateId:'other',seq:events[0].seq,classification:'independent_firsthand',origin:'https://example.org/original',rationale:'核实了这个证据的原始讨论页面',planRevision:1,expected_revision:0},options),{code:'FOREIGN_EVIDENCE'});
 const params={candidateId:id,classification:'same_origin',origin:'https://example.org/original',rationale:'两条访谈记录来自同一原始来源，不能算独立样本',planRevision:1};
 reviewWeeklyEvidenceProvenance(db,{...params,seq:events[0].seq,expected_revision:0},options);
 assert.throws(()=>reviewWeeklyEvidenceProvenance(db,{...params,seq:events[1].seq,expected_revision:0},options),{code:'REVISION_CONFLICT'});
 reviewWeeklyEvidenceProvenance(db,{...params,seq:events[1].seq,expected_revision:1},options);
 const h=weeklyHypothesisBoard(db,options);
 saveWeeklyHypothesis(db,{candidateId:id,planRevision:1,expected_revision:0,hypothesis:'多个独立用户都需要频繁手工对账',
  expectedEvidence:'至少两个互不相关的实际用户观察记录',falsifier:'两个记录其实来自同一原始用户反馈',
  finding:'supported',rationale:'当前证据可能支持但仍需要核查独立性',eventSeqs:events.map(e=>e.seq)},options);
 const report=weeklyConclusionQualityReview(db,options).items[0];
 assert.ok(report.issues.some(x=>x.code==='DUPLICATE_ORIGIN'));
 assert.ok(report.issues.some(x=>x.code==='NONINDEPENDENT_SOURCE'));
 assert.equal(report.assessment,'needs_review');
 assert.equal(weeklyHypothesisBoard(db,options).items[0].finding,'supported');
 }finally{db.close();}
});
