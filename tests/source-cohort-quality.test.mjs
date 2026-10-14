import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {sourceCohortQualityReview} from '../src/source-cohort-quality.mjs';

function source(db,id,host,title,description){
 return db.put('sources',{id,status:'new',url:'https://'+host+'/posts/'+id,title,description,createdAt:'2026-10-10T01:00:00Z'});
}
function label(db,s,kind){
 return db.put('discovery_quality_labels',{id:s.id,label:kind,sourceRevision:s.revision,reason:'已人工核查原始帖文并记录本次独立判断'});
}
function fixtures(db){
 const tp=source(db,'pos','example.org','I cannot reconcile invoice records manually',
  'I manually reconcile invoices every day and spend hours fixing errors');
 const fp=source(db,'fp','example.net','Cannot automate repetitive photo uploads',
  'I manually upload photos every day and struggle with repeated clicks');
 const fn=source(db,'miss','example.org','New photo app','I need better options');
 const tn=source(db,'tn','example.net','We launched a new AI product today',
  'Our startup releases new AI features to subscribers');
 label(db,tp,'real_problem');label(db,fp,'not_problem');label(db,fn,'real_problem');label(db,tn,'not_problem');
 return {tp,fp,fn,tn};
}
test('current top-50 review tracks owner-labeled false positives and misses by source host',()=>{
 const db=openDatabase();try{
  fixtures(db);
  const snapshot=db.list('sources').map(s=>[s.id,s.revision]);
  const r=sourceCohortQualityReview(db);
  assert.deepEqual([r.totals.truePositive,r.totals.falsePositive,r.totals.falseNegative,r.totals.trueNegative],[1,1,1,1]);
  assert.equal(r.totals.reviewed,4);
  assert.equal(r.totals.labelsOutsideWindow,0);
  assert.equal(r.evaluatedRates,null);
  assert.equal(r.liveRuleChanged,false);
  assert.equal(r.readOnly,true);
  assert.deepEqual(r.queue.slice(0,2).map(x=>x.issue),['false_negative','false_positive']);
  assert.equal(r.cohorts.length,2);
  assert.equal(r.cohorts.find(x=>x.host==='example.org').falseNegative,1);
  assert.equal(r.cohorts.find(x=>x.host==='example.net').falsePositive,1);
  assert.ok(r.queue.every(x=>x.url.startsWith('https://')&&x.needsHumanReview));
  assert.deepEqual(db.list('sources').map(s=>[s.id,s.revision]),snapshot);
  assert.equal(db.eventsLatest(10).length,0);
 }finally{db.close();}
});
test('stale, uncertain and out-of-window labels are not treated as false positives or recall losses',()=>{
 const db=openDatabase();try{
  const {tp,fp,fn,tn}=fixtures(db);
  const old=db.get('sources',tp.id);
  db.put('sources',{...old,description:old.description+' last week'},old.revision);
  label(db,source(db,'uncertain','example.org','New software announcement','Brand announces a change'),'uncertain');
  db.put('discovery_quality_labels',{id:'archived',label:'real_problem',sourceRevision:1,reason:'旧记录已不在当前扫描窗口'});
  const r=sourceCohortQualityReview(db);
  assert.equal(r.totals.stale,1);
  assert.equal(r.totals.uncertain,1);
  assert.equal(r.totals.reviewed,3);
  assert.equal(r.totals.truePositive,0);
  assert.equal(r.totals.falsePositive,1);
  assert.equal(r.totals.falseNegative,1);
  assert.equal(r.totals.labelsOutsideWindow,1);
  assert.ok(r.queue.some(x=>x.sourceId==='pos'&&x.issue==='stale_label'));
  assert.ok(r.queue.some(x=>x.sourceId==='uncertain'&&x.issue==='uncertain_label'));
  assert.equal(r.cohorts.find(x=>x.host==='example.org').reviewedSampleRates,null);
 }finally{db.close();}
});
test('review queue includes rejected posts and rotates unlabeled origins; human feedback is contextual only',()=>{
 const db=openDatabase();try{
  source(db,'m-a','alpha.example','New cooking tools','Our blog announces a new tool');
  source(db,'m-b','beta.example','New gaming tools','Our blog announces a new tool');
  source(db,'m-c','alpha.example','We are a startup','We are shipping something');
  const r=sourceCohortQualityReview(db,{limit:2});
  assert.equal(r.totals.unlabeled,3);
  assert.equal(r.totals.unseenPending,1);
  assert.deepEqual(r.queue.map(x=>x.issue),['unlabeled_negative','unlabeled_negative']);
  assert.notEqual(r.queue[0].host,r.queue[1].host);
  assert.equal(r.totals.reviewed,0);
  assert.equal(r.evaluatedRates,null);
  assert.throws(()=>sourceCohortQualityReview(db,{limit:100}),{code:'BAD_LIMIT'});
 }finally{db.close();}
});
test('adoption and helpfulness counts cannot turn unreviewed source posts into ground truth',()=>{
 const db=openDatabase();try{
  const {tp}=fixtures(db);
  db.put('home_opportunity_feedback',{id:'signal:pos',verdict:'useful',sourceUrls:[tp.url]});
  db.put('opportunity_research_guidance_feedback',{id:'followup-1',candidateId:'signal:pos',response:'accepted',
   followup:{assessment:'helpful',selfReported:true}});
  const r=sourceCohortQualityReview(db);
  const cohort=r.cohorts.find(x=>x.host==='example.org');
  assert.equal(cohort.contextualFeedback.homeUseful,1);
  assert.equal(cohort.contextualFeedback.guidanceAccepted,1);
  assert.equal(cohort.contextualFeedback.followedUp,1);
  assert.equal(r.totals.reviewed,4);
  assert.equal(r.evaluatedRates,null);
 }finally{db.close();}
});
