import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {saveWeeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
import {weeklyResearchEvidence} from '../src/opportunity-weekly-evidence.mjs';
import {updateWeeklyResearchProgress} from '../src/opportunity-weekly-execution.mjs';

test('research activity alone never counts as observation; unsupported completion requires explicit owner acknowledgement',()=>{
 const db=openDatabase();try{
 db.put('sources',{id:'a',status:'new',url:'https://example.org/a',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
 const id=opportunityScanCandidates(db).items[0].id,now=new Date();
 saveWeeklyResearchPlan(db,{expected_revision:0,items:[{candidateId:id,task:'调查真实发票对账用户的日常工作和痛点',hours:2,budget:0}]},{now});
 db.event('opportunity.external_research.searched',id,'owner',{hits:5});
 let r=weeklyResearchEvidence(db,{now}).items[0];
 assert.equal(r.quality.activityOnly,1);
 assert.equal(r.quality.recordedObservations,0);
 assert.equal(r.completionCheck,'requires_manual_evidence_acknowledgement');
 assert.throws(()=>updateWeeklyResearchProgress(db,{candidateId:id,status:'completed',note:'已人工调查但还没有观察记录和独立证据',actualHours:1,expected_revision:1},{now}),{code:'EVIDENCE_ACK_REQUIRED'});
 const saved=updateWeeklyResearchProgress(db,{candidateId:id,status:'completed',note:'手动检查当前调查结果仍有重要证据缺口',actualHours:1,expected_revision:1,acknowledgeEvidenceGap:true},{now});
 assert.equal(saved.progress[0].evidenceAtDecision.gapAcknowledged,true);
 db.event('problem.interview.observed',id,'owner',{observationId:'observation-1'});
 db.event('problem.interview.decided',id,'owner',{decision:'stop'});
 r=weeklyResearchEvidence(db,{now}).items[0];
 assert.equal(r.quality.recordedObservations,1);
 assert.equal(r.counterEvidence,1);
 assert.equal(r.completionCheck,'review_observations_and_falsifiers');
 }finally{db.close();}
});
