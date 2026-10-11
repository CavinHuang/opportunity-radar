import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {growthOverview,growthReport,createGrowthChannel,createGrowthCampaign,recordGrowthMetric,importGrowthMetrics,reviseGrowthMetric,retractGrowthMetric,verifyGrowthMetric,growthHistory} from '../src/growth.mjs';

const T0='2026-09-10T09:00:00+08:00',T1='2026-09-11T10:00:00+08:00',T2='2026-09-12T11:00:00+08:00';
const T3='2026-09-13T12:00:00+08:00',T4='2026-09-14T13:00:00+08:00',T5='2026-09-15T14:00:00+08:00';
const WIN={from:'2026-09-01',to:'2026-09-30'};

function setup(){
 const db=openDatabase();
 const s=createService(db);
 const o=s.createOpportunity({title:'Photo sorting pain',problem:'manual sorting burden',market:'China'});
 const p=s.startExperiment({opportunityId:o.id,goal:'validate the need',hypothesis:'people want it',criteria:['core task works'],stopCondition:'stop when budget exhausted',hours:2,cash:0});
 const draft=s.saveContent(p.id,{title:'Launch post',body:'Real research update only',objective:'collect feedback',channel:'blog',claims:[]});
 s.reviewContent(p.id,draft.id,{action:'approve',factsChecked:true,privacyChecked:true});
 const published=s.reviewContent(p.id,draft.id,{action:'publish_record',url:'https://example.com/post',platform:'blog'});
 return {db,s,p,content:published};
}
const rate=(report,numerator,denominator,scope)=> (scope??report.conversions).find(r=>r.numerator===numerator&&r.denominator===denominator);

test('channels and campaigns organize growth data per project with ownership checks',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'微信公众号',notes:'manual posting'});
  assert.throws(()=>createGrowthChannel(db,p.id,{name:'微信公众号'}),{code:'GROWTH_CHANNEL_EXISTS'});
  assert.throws(()=>createGrowthChannel(db,p.id,{name:''}),{code:'BAD_REQUEST'});
  const camp=createGrowthCampaign(db,p.id,{channelId:ch.id,name:'九月的试用邀请',objective:'邀请真实试用'});
  assert.equal(camp.channelId,ch.id);
  assert.throws(()=>createGrowthCampaign(db,p.id,{channelId:'missing',name:'X'}),{code:'NOT_FOUND'});
  assert.throws(()=>createGrowthCampaign(db,p.id,{channelId:ch.id,name:'Backwards',startsAt:T1,endsAt:T0}),{code:'BAD_REQUEST'});
  // a metric whose campaign belongs to a different channel is rejected
  const ch2=createGrowthChannel(db,p.id,{name:'社群'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:1,channelId:ch2.id,campaignId:camp.id,occurredAt:T0}),{code:'BAD_REQUEST'});
  const ov=growthOverview(db,p.id);
  assert.equal(ov.channels.length,2);assert.equal(ov.campaigns.length,1);
 }finally{db.close();}
});

test('metric records validate type, value, time, provenance, source and anomaly notes',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'likes',value:1,channelId:ch.id,occurredAt:T0}),{code:'BAD_REQUEST'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:-3,channelId:ch.id,occurredAt:T0}),{code:'BAD_REQUEST'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:1,channelId:ch.id,occurredAt:'2026-09-10 09:00'}),{code:'BAD_REQUEST'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:1,channelId:ch.id,occurredAt:'2099-01-01T09:00:00+08:00'}),{code:'BAD_REQUEST'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:1,channelId:ch.id,occurredAt:T0,provenance:'api_fetch'}),{code:'BAD_REQUEST'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:1,channelId:ch.id,occurredAt:T0,sourceRef:'http://insecure.example/x'}),{code:'BAD_REQUEST'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:1,channelId:ch.id,occurredAt:T0,isAnomaly:true}),{code:'BAD_REQUEST'});
  const count=recordGrowthMetric(db,p.id,{metric:'visits',value:12,channelId:ch.id,occurredAt:T0,isAnomaly:true,anomalyNote:'平台转发导致突增'});
  assert.equal(count.unit,'count');assert.equal(count.provenance,'manual_entry');assert.equal(count.isAnomaly,true);
  const money=recordGrowthMetric(db,p.id,{metric:'income',value:'88.5',channelId:ch.id,occurredAt:T0});
  assert.equal(money.unit,'CNY');assert.equal(money.value,88.5);
  const imported=recordGrowthMetric(db,p.id,{metric:'impressions',value:100,channelId:ch.id,occurredAt:T0,provenance:'external_import',sourceRef:'https://analytics.example/report'});
  assert.equal(imported.sourceRef,'https://analytics.example/report');
 }finally{db.close();}
});

test('content links require actually published content of the same project',()=>{
 const {db,s,p,content}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  const other=s.saveContent(p.id,{title:'Draft only',body:'Not approved',objective:'x',channel:'blog',claims:[]});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:5,channelId:ch.id,occurredAt:T0,contentId:other.id}),{code:'BAD_CAMPAIGN_REF'});
  const ok=recordGrowthMetric(db,p.id,{metric:'visits',value:5,channelId:ch.id,occurredAt:T0,contentId:content.id});
  assert.equal(ok.contentId,content.id);
 }finally{db.close();}
});

test('duplicates are rejected with an explicit escape hatch, not silently merged',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0});
  // identical fingerprint (no distinguishing key) is treated as double entry
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0}),{code:'GROWTH_DUPLICATE'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0,dedupKey:'row-1'});
  assert.throws(()=>recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0,dedupKey:'row-1'}),{code:'GROWTH_DUPLICATE'});
  // escape hatch: genuinely separate identical observations need distinct keys
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0,dedupKey:'row-2'});
  assert.equal(growthOverview(db,p.id).counts.active,3);
 }finally{db.close();}
});

test('revision creates a superseding row, keeps the original readable and redirects aggregates',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  const m=recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0,dedupKey:'row-1'});
  assert.throws(()=>reviseGrowthMetric(db,p.id,m.id,{value:25,reason:'太短'}),{code:'BAD_REQUEST'});
  const revised=reviseGrowthMetric(db,p.id,m.id,{value:25,reason:'与后台导出核对后修正'});
  assert.equal(revised.value,25);assert.equal(revised.revisionNumber,2);assert.equal(revised.supersedesId,m.id);
  const old=db.get('growth_metrics',m.id);
  assert.equal(old.status,'superseded');assert.equal(old.value,10);assert.equal(old.supersededById,revised.id);
  const report=growthReport(db,p.id,WIN);
  assert.equal(report.totals.visits,25);
  assert.equal(growthOverview(db,p.id).counts.active,1);
  assert.throws(()=>reviseGrowthMetric(db,p.id,m.id,{value:99,reason:'再次修订已被替代的旧版本'}),{code:'BAD_STATE'});
  assert.throws(()=>reviseGrowthMetric(db,p.id,'missing',{value:1,reason:'查找一条并不存在的数据'}),{code:'NOT_FOUND'});
 }finally{db.close();}
});

test('owner verification requires a rationale and is reset by value revisions',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  const m=recordGrowthMetric(db,p.id,{metric:'income',value:100,channelId:ch.id,occurredAt:T0});
  assert.throws(()=>verifyGrowthMetric(db,p.id,m.id,{reason:'看了'}),{code:'BAD_REQUEST'});
  const verified=verifyGrowthMetric(db,p.id,m.id,{reason:'核对了收款后台9月账单'});
  assert.equal(verified.provenance,'verified');assert.equal(verified.originalProvenance,'manual_entry');assert.ok(verified.verifiedAt);
  const revised=reviseGrowthMetric(db,p.id,m.id,{value:120,reason:'账单更正为 120 元'});
  assert.equal(revised.provenance,'manual_entry');assert.equal(revised.verifiedAt,null);
  const again=verifyGrowthMetric(db,p.id,revised.id,{reason:'再次核对后台账单'});
  assert.equal(again.provenance,'verified');
  const noteOnly=reviseGrowthMetric(db,p.id,again.id,{notes:'补充备注',reason:'仅补充备注，不修改数值'});
  assert.equal(noteOnly.provenance,'verified');
 }finally{db.close();}
});

test('retraction excludes data from reports without deleting the record',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  const m=recordGrowthMetric(db,p.id,{metric:'trials',value:6,channelId:ch.id,occurredAt:T0});
  assert.throws(()=>retractGrowthMetric(db,p.id,m.id,{reason:'录错'}),{code:'BAD_REQUEST'});
  retractGrowthMetric(db,p.id,m.id,{reason:'误把咨询人数录成试用'});
  const report=growthReport(db,p.id,WIN);
  assert.equal(report.totals.trials,null);
  const stored=db.get('growth_metrics',m.id);
  assert.equal(stored.status,'retracted');assert.ok(stored.retractReason.includes('误把'));
  assert.throws(()=>retractGrowthMetric(db,p.id,m.id,{reason:'重复撤回同一条数据记录'}),{code:'BAD_STATE'});
 }finally{db.close();}
});

test('report treats missing data as unknown and withholds inconsistent caliber rates',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  recordGrowthMetric(db,p.id,{metric:'impressions',value:100,channelId:ch.id,occurredAt:T0});
  let report=growthReport(db,p.id,WIN);
  assert.equal(report.totals.visits,null);            // Unknown, never 0
  assert.equal(report.totals.impressions,100);
  assert.equal(rate(report,'visits','impressions').reason,'unknown_data');
  assert.equal(rate(report,'interest','visits').reason,'unknown_data');
  // visits recorded above impressions in the same scope+window → caliber mismatch
  recordGrowthMetric(db,p.id,{metric:'visits',value:120,channelId:ch.id,occurredAt:T0});
  report=growthReport(db,p.id,WIN);
  assert.equal(rate(report,'visits','impressions').reason,'caliber_inconsistent');
  assert.equal(rate(report,'visits','impressions').rate,null);
  // explicit zero denominator is not silently converted into a rate
  recordGrowthMetric(db,p.id,{metric:'trials',value:0,channelId:ch.id,occurredAt:T0,dedupKey:'zero'});
  recordGrowthMetric(db,p.id,{metric:'activation',value:0,channelId:ch.id,occurredAt:T0,dedupKey:'zero-act'});
  report=growthReport(db,p.id,WIN);
  assert.equal(report.totals.trials,0); // explicit zero stays zero
  assert.equal(rate(report,'activation','trials').reason,'zero_denominator');
  // correcting the visits number restores a computable rate
  const visits=db.list('growth_metrics').find(x=>x.metric==='visits'&&x.status==='active');
  const fixed=reviseGrowthMetric(db,p.id,visits.id,{value:60,reason:'修正为后台真实访问数'});
  assert.equal(fixed.value,60);
  report=growthReport(db,p.id,WIN);
  assert.equal(rate(report,'visits','impressions').rate,0.6);
  assert.throws(()=>growthReport(db,p.id,{from:'2026-09-30',to:'2026-09-01'}),{code:'BAD_REQUEST'});
  assert.throws(()=>growthReport(db,p.id,{from:'2026/09/01',to:'2026-09-30'}),{code:'BAD_REQUEST'});
  assert.throws(()=>growthReport(db,p.id,{from:'2025-01-01',to:'2026-09-30'}),{code:'BAD_REQUEST'});
  assert.throws(()=>growthReport(db,p.id,{...WIN,granularity:'month'}),{code:'BAD_REQUEST'});
 }finally{db.close();}
});

test('mixed provenance is flagged on rates instead of being hidden',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  recordGrowthMetric(db,p.id,{metric:'impressions',value:100,channelId:ch.id,occurredAt:T0,provenance:'api_fetch',sourceRef:'https://analytics.example/api'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:20,channelId:ch.id,occurredAt:T0});
  let report=growthReport(db,p.id,WIN);
  assert.equal(rate(report,'visits','impressions').rate,0.2);
  assert.equal(rate(report,'visits','impressions').provenanceMixed,true);
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0,dedupKey:'manual-more'});
  report=growthReport(db,p.id,WIN);
  assert.equal(report.totals.visits,30);
  assert.equal(rate(report,'visits','impressions').provenanceMixed,true);
 }finally{db.close();}
});

test('trend buckets keep empty periods unknown and week granularity aggregates',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:5,channelId:ch.id,occurredAt:T1});
  const dayReport=growthReport(db,p.id,{from:'2026-09-10',to:'2026-09-12'});
  assert.equal(dayReport.trend.length,3);
  assert.equal(dayReport.trend[0].values.visits,null);
  assert.equal(dayReport.trend[1].values.visits,5);
  assert.equal(dayReport.trend[2].values.visits,null);
  // 2026-09-07 (Mon) .. 2026-09-13 (Sun) is one ISO week bucket; both entries fall in it
  recordGrowthMetric(db,p.id,{metric:'visits',value:7,channelId:ch.id,occurredAt:T3,dedupKey:'week-2'});
  const weekReport=growthReport(db,p.id,{from:'2026-09-07',to:'2026-09-13',granularity:'week'});
  assert.equal(weekReport.trend.length,1);
  assert.equal(weekReport.trend[0].bucket,'2026-09-07');
  assert.equal(weekReport.trend[0].values.visits,12);
 }finally{db.close();}
});

test('channel comparison keeps scopes separate and never mixes channels into a rate',()=>{
 const {db,s,p}=setup();try{
  const a=createGrowthChannel(db,p.id,{name:'渠道A'});
  const b=createGrowthChannel(db,p.id,{name:'渠道B'});
  recordGrowthMetric(db,p.id,{metric:'impressions',value:100,channelId:a.id,occurredAt:T0});
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:a.id,occurredAt:T0});
  recordGrowthMetric(db,p.id,{metric:'visits',value:50,channelId:b.id,occurredAt:T0,dedupKey:'b-visits'});
  const report=growthReport(db,p.id,WIN);
  const rowA=report.channels.find(c=>c.name==='渠道A'),rowB=report.channels.find(c=>c.name==='渠道B');
  assert.equal(rate(report,'visits','impressions',rowA.conversions).rate,0.1);
  assert.equal(rate(report,'visits','impressions',rowB.conversions).reason,'unknown_data');
  assert.equal(rowB.values.impressions,null);
  // project-scope aggregate is labeled as project scope, computed from all entries
  assert.equal(rate(report,'visits','impressions').numeratorValue,60);
  assert.equal(rate(report,'visits','impressions').denominatorValue,100);
  // campaigns roll up under their channel only
  const camp=createGrowthCampaign(db,p.id,{channelId:a.id,name:'九月活动',objective:'试用邀请'});
  recordGrowthMetric(db,p.id,{metric:'trials',value:2,channelId:a.id,campaignId:camp.id,occurredAt:T0,dedupKey:'camp'});
  const report2=growthReport(db,p.id,WIN);
  assert.equal(report2.campaigns.find(c=>c.name==='九月活动').values.trials,2);
  assert.equal(report2.campaigns.find(c=>c.name==='九月活动').channelName,'渠道A');
 }finally{db.close();}
});

test('anomaly detection separates owner-explained entries from unexplained spikes',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T0,dedupKey:'d1'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T1,dedupKey:'d2'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T2,dedupKey:'d3'});
  recordGrowthMetric(db,p.id,{metric:'visits',value:10,channelId:ch.id,occurredAt:T3,dedupKey:'d4'});
  let report=growthReport(db,p.id,WIN);
  assert.equal(report.anomalies.unexplained.length,0);
  recordGrowthMetric(db,p.id,{metric:'visits',value:100,channelId:ch.id,occurredAt:T4,dedupKey:'d5'});
  report=growthReport(db,p.id,WIN);
  assert.equal(report.anomalies.unexplained.length,1);
  assert.equal(report.anomalies.unexplained[0].value,100);
  assert.equal(report.anomalies.unexplained[0].detectionRule,'value_above_3x_median');
  // an owner explanation moves the spike into the explained list
  const spike=db.list('growth_metrics').find(x=>x.value===100&&x.status==='active');
  reviseGrowthMetric(db,p.id,spike.id,{value:100,isAnomaly:true,anomalyNote:'被平台编辑推荐，流量异常',reason:'补充异常原因的说明文字'});
  report=growthReport(db,p.id,WIN);
  assert.equal(report.anomalies.unexplained.length,0);
  assert.equal(report.anomalies.explained.length,1);
  assert.ok(report.anomalies.explained[0].anomalyNote.includes('平台编辑推荐'));
 }finally{db.close();}
});

test('paste import skips duplicates, rejects invalid rows and explains both',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  assert.throws(()=>importGrowthMetrics(db,p.id,{items:[]}),{code:'BAD_REQUEST'});
  const result=importGrowthMetrics(db,p.id,{items:[
   {metric:'visits',value:12,channelId:ch.id,occurredAt:T0,provenance:'external_import',sourceRef:'https://analytics.example/export.csv',dedupKey:'x1'},
   {metric:'visits',value:12,channelId:ch.id,occurredAt:T0,provenance:'external_import',sourceRef:'https://analytics.example/export.csv',dedupKey:'x1'},
   {metric:'followers',value:3,channelId:ch.id,occurredAt:T0},
   {metric:'impressions',value:50,channelId:ch.id,occurredAt:T0,provenance:'api_fetch',sourceRef:'https://analytics.example/api'}
  ]});
  assert.equal(result.acceptedCount,2);
  assert.equal(result.duplicateCount,1);
  assert.equal(result.rejected.length,2);
  assert.ok(result.rejected.some(r=>r.code==='GROWTH_DUPLICATE'));
  assert.ok(result.rejected.some(r=>r.code==='BAD_REQUEST'));
  assert.equal(growthOverview(db,p.id).counts.active,2);
 }finally{db.close();}
});

test('growth audit history records every mutation in reverse order',()=>{
 const {db,s,p}=setup();try{
  const ch=createGrowthChannel(db,p.id,{name:'博客'});
  assert.throws(()=>growthHistory(db,p.id,{limit:0}),{code:'BAD_REQUEST'});
  assert.throws(()=>growthHistory(db,p.id,{limit:999}),{code:'BAD_REQUEST'});
  const m=recordGrowthMetric(db,p.id,{metric:'income',value:100,channelId:ch.id,occurredAt:T0});
  verifyGrowthMetric(db,p.id,m.id,{reason:'核对了收款后台凭证'});
  const revised=reviseGrowthMetric(db,p.id,m.id,{value:120,reason:'凭证实际为 120 元'});
  // audit events stay attached to the entity they acted on; the chain is linked by supersedesId
  const oldHist=growthHistory(db,p.id,{metricId:m.id});
  assert.deepEqual(oldHist.map(h=>h.kind),['growth.metric.verified','growth.metric.recorded']);
  const newHist=growthHistory(db,p.id,{metricId:revised.id});
  assert.deepEqual(newHist.map(h=>h.kind),['growth.metric.revised']);
  assert.equal(newHist[0].detail.reason,'凭证实际为 120 元');
  assert.equal(newHist[0].detail.changes.value.from,100);
  assert.equal(newHist[0].detail.changes.value.to,120);
  assert.equal(newHist[0].detail.verificationReset,true);
  retractGrowthMetric(db,p.id,revised.id,{reason:'发现是重复记账，全部撤回'});
  const all=growthHistory(db,p.id,{limit:10});
  assert.equal(all[0].kind,'growth.metric.retracted');
 }finally{db.close();}
});

test('ledger accepts retention additively without changing summary semantics',()=>{
 const {db,s,p}=setup();try{
  const entry=s.addLedger(p.id,{type:'retention',value:4,actual:true});
  assert.equal(entry.type,'retention');assert.equal(entry.unit,'count');
  assert.throws(()=>s.addLedger(p.id,{type:'followers',value:1}),{code:'BAD_REQUEST'});
  const summary=s.summaryLedger(s.getFullProject(p.id).ledger);
  assert.equal(summary.contribution,0); // retention never enters cash math
 }finally{db.close();}
});
