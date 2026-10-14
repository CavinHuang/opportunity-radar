import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {saveWeeklyResearchPlan,weeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
import {weeklyResearchEvidence} from '../src/opportunity-weekly-evidence.mjs';

test('weekly evidence is scoped to candidate, week, and supported research actions',()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'a',status:'new',url:'https://example.org/a',title:'I cannot reconcile invoice records manually',
   description:'I manually reconcile invoices every day and spend hours fixing errors'});
  const candidate=opportunityScanCandidates(db).items[0];
  const now=new Date();
  const board=weeklyResearchPlan(db,{now});
  saveWeeklyResearchPlan(db,{expected_revision:0,items:[{candidateId:candidate.id,task:'与真实发票对账用户沟通确认问题和影响',hours:2,budget:0}]},{now});
  db.event('problem.interview.observed',candidate.id,'owner',{observationId:'example-1'});
  db.event('opportunity.external_evidence.reviewed','other-candidate','owner',{url:'https://example.org/unrelated'});
  db.event('irrelevant.system.event',candidate.id,'owner',{});
  const report=weeklyResearchEvidence(db,{now});
  assert.equal(report.items.length,1);
  assert.equal(report.items[0].evidenceCount,1);
  assert.equal(report.items[0].evidence[0].label,'用户访谈观察');
  assert.equal(report.items[0].autoCompleted,false);
  assert.equal(report.items[0].progressCount,0);
  const nextWeek=new Date(now.getTime()+8*86400000);
  assert.equal(weeklyResearchEvidence(db,{now:nextWeek}).items.length,0);
 }finally{db.close();}
});
test('empty plan does not fabricate research activities',()=>{
 const db=openDatabase();try{
  const report=weeklyResearchEvidence(db);
  assert.deepEqual(report.items,[]);
 }finally{db.close();}
});
