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

test('dossier flags missing evidence, repeated origins and conflicting conclusions without treating them as users',()=>{
 const db=openDatabase();try{
  const id='candidate:review';
  for(const [i,week,finding] of [[0,'2026-08-03','supported'],[1,'2026-08-10','contradicted']]){
   const key='week:'+week;
   db.put('opportunity_weekly_plans',{id:key,weekStart:week,status:'reviewed',items:[{candidateId:id,title:'重复需求',task:'核实',hours:1,budget:0}]});
   db.put('opportunity_weekly_hypotheses',{id:key,items:[{candidateId:id,hypothesis:'需要核实的问题',finding,eventSeqs:[i+1]}]});
   db.put('opportunity_weekly_provenance',{id:key,reviews:[{candidateId:id,seq:i+1,classification:'independent_firsthand',origin:'https://example.com/post?utm_source='+i}]});
  }
  const r=crossWeekResearchDossier(db,id);
  const codes=r.reviewFlags.map(x=>x.code);
  assert.ok(codes.includes('REUSED_SOURCES'));
  assert.ok(codes.includes('CONFLICTING_FINDINGS'));
  assert.ok(codes.includes('STALE_RESEARCH'));
  assert.equal(r.overview.distinctReviewedOrigins,1);
 }finally{db.close();}
});
test('dossier flags no history and pending unreviewed linked events',()=>{
 const db=openDatabase();try{
  assert.deepEqual(crossWeekResearchDossier(db,'no-history').reviewFlags.map(x=>x.code),['NO_RESEARCH']);
  db.put('opportunity_weekly_plans',{id:'week:2026-10-12',weekStart:'2026-10-12',status:'planned',items:[{candidateId:'pending',title:'待研究',task:'验证',hours:2,budget:0}]});
  db.put('opportunity_weekly_hypotheses',{id:'week:2026-10-12',items:[{candidateId:'pending',hypothesis:'某个假设',eventSeqs:[12]}]});
  const codes=crossWeekResearchDossier(db,'pending').reviewFlags.map(x=>x.code);
  assert.ok(codes.includes('UNREVIEWED_PROVENANCE'));
  assert.ok(codes.includes('WEEK_NOT_REVIEWED'));
 }finally{db.close();}
});
