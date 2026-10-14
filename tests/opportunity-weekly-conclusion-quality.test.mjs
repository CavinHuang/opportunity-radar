import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {saveWeeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
import {weeklyHypothesisBoard,saveWeeklyHypothesis} from '../src/opportunity-weekly-hypotheses.mjs';
import {weeklyConclusionQualityReview} from '../src/opportunity-weekly-conclusion-quality.mjs';
test('payment hypotheses cannot be supported solely by search activity, counterevidence is flagged',()=>{
 const db=openDatabase();try{
 db.put('sources',{id:'a',status:'new',url:'https://example.org/a',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
 const id=opportunityScanCandidates(db).items[0].id,now=new Date(),opts={now};
 saveWeeklyResearchPlan(db,{expected_revision:0,items:[{candidateId:id,task:'调查真实客户是否愿意为发票工具付费',hours:2,budget:0}]},opts);
 db.event('opportunity.external_research.searched',id,'owner',{hits:5});
 db.event('problem.interview.decided',id,'owner',{decision:'stop'});
 const before=weeklyHypothesisBoard(db,opts),seqs=before.items[0].eligibleEvidence.map(x=>x.seq);
 saveWeeklyHypothesis(db,{candidateId:id,planRevision:before.planRevision,expected_revision:0,
  hypothesis:'用户愿意每个月持续付费使用发票对账工具',expectedEvidence:'实际支付记录或可核实的付费实验结果',falsifier:'没有人愿意实际支付费用并继续使用该工具',
  finding:'supported',rationale:'人工暂时判断值得尝试但仍存在反面证据',eventSeqs:seqs},opts);
 const report=weeklyConclusionQualityReview(db,opts),item=report.items[0];
 assert.equal(item.assessment,'needs_review');
 assert.ok(item.issues.some(x=>x.code==='PAYMENT_MISMATCH'));
 assert.ok(item.issues.some(x=>x.code==='NO_OBSERVATION'));
 assert.ok(item.issues.some(x=>x.code==='COUNTEREVIDENCE'));
 assert.equal(report.marketValidated,false);
 assert.equal(weeklyHypothesisBoard(db,opts).items[0].finding,'supported');
 }finally{db.close();}
});
test('unanswered tasks are explicit rather than fabricated conclusions',()=>{
 const db=openDatabase();try{
 const result=weeklyConclusionQualityReview(db);
 assert.equal(result.items.length,0);
 assert.equal(result.summary.unanswered,0);
 }finally{db.close();}
});
