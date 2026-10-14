import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {crossWeekResearchDossier} from '../src/opportunity-cross-week-dossier.mjs';
test('multiweek dossier deduplicates original URLs and tracks repeated conclusions without mutating ledgers',()=>{
 const db=openDatabase();try{
  const id='signal:example',h='用户每周都会花费大量时间人工处理发票对账';
  for(const [i,date,finding,origin] of [[0,'2026-09-28','supported','https://example.org/post?utm_source=news'],[1,'2026-10-05','contradicted','https://example.org/post?fbclid=abc']]){
   const key='week:'+date;
   db.put('opportunity_weekly_plans',{id:key,weekStart:date,status:'reviewed',items:[{candidateId:id,title:'发票问题',task:'访谈用户确认痛点',hours:3,budget:0}],progress:[],review:{results:[{candidateId:id,status:'inconclusive',actualHours:i+1,actualCost:0,observation:'人工记录'}]}});
   db.put('opportunity_weekly_hypotheses',{id:key,weekStart:date,items:[{candidateId:id,hypothesis:h,expectedEvidence:'不同用户',falsifier:'没有重复需求',finding,eventSeqs:[i+10],rationale:'人工核查'}]});
   db.put('opportunity_weekly_provenance',{id:key,weekStart:date,reviews:[{candidateId:id,seq:i+10,classification:'independent_firsthand',origin,rationale:'人工审核'}]});
  }
  const r=crossWeekResearchDossier(db,id);
  assert.equal(r.overview.researchWeeks,2);
  assert.equal(r.overview.actualHoursClosed,3);
  assert.equal(r.overview.distinctReviewedOrigins,1);
  assert.equal(r.overview.repeatedOriginCount,1);
  assert.equal(r.overview.repeatedHypotheses,1);
  assert.equal(r.overview.changedConclusionHypotheses,1);
  assert.equal(r.weeks[0].hypothesis.finding,'supported');
  assert.equal(r.weeks[1].hypothesis.finding,'contradicted');
  assert.equal(db.get('opportunity_weekly_hypotheses','week:2026-09-28').items[0].finding,'supported');
 }finally{db.close();}
});
test('candidate dossier isolates other opportunities and no history stays empty',()=>{
 const db=openDatabase();try{
  db.put('opportunity_weekly_plans',{id:'week:2026-09-28',weekStart:'2026-09-28',status:'planned',items:[{candidateId:'a',title:'A',task:'research',hours:2,budget:0}]});
  assert.equal(crossWeekResearchDossier(db,'b').overview.researchWeeks,0);
  assert.equal(crossWeekResearchDossier(db,'a').overview.actualHoursClosed,0);
  assert.equal(crossWeekResearchDossier(db,'a').weeks[0].result,null);
 }finally{db.close();}
});
