import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'radar-growth-http-'));
process.env.RADAR_DB=join(directory,'test.sqlite');
process.env.RADAR_AGENT_TOKEN='test-agent-token';
process.env.RADAR_OWNER_TOKEN='test-owner-token';
const {createServer,closeStore}=await import('../src/server.mjs');
// Close the module-level SQLite handle before deleting the temp directory;
// Windows refuses to unlink files that are still open.
after(()=>{try{closeStore();}finally{try{rmSync(directory,{recursive:true,force:true});}catch{/* best effort */}}});

test('growth routes are owner-only and enforce dedup, content and caliber guards over HTTP',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const call=async(path,method='GET',payload,headers=owner)=>{const r=await fetch(base+path,{method,headers,body:payload?JSON.stringify(payload):undefined});return {status:r.status,data:await r.json()};};
 try{
  // owner token required for growth reads and writes
  assert.equal((await call('/api/projects/x/growth','GET',undefined,{})).status,401);
  assert.equal((await call('/api/projects/x/growth/report','GET',undefined,{})).status,401);

  // minimal approved experiment with one manually published content
  const opp=await call('/api/opportunities','POST',{title:'Growth attribution check',problem:'manual tracking burden',market:'China'});
  assert.equal(opp.status,201);
  const start=await call('/api/experiments','POST',{opportunityId:opp.data.item.id,goal:'validate need',hypothesis:'people want it',criteria:['works'],stopCondition:'stop when exhausted'});
  assert.equal(start.status,201);
  const pid=start.data.project.id;
  const content=await call(`/api/projects/${pid}/contents`,'POST',{title:'Launch post',body:'Real update',objective:'feedback',channel:'blog'});
  const cid=content.data.item.id;
  await call(`/api/projects/${pid}/contents/${cid}/review`,'POST',{action:'approve',factsChecked:true,privacyChecked:true});
  const published=await call(`/api/projects/${pid}/contents/${cid}/review`,'POST',{action:'publish_record',url:'https://example.com/live',platform:'blog'});
  assert.equal(published.data.item.reviewState,'published');

  // channels and campaigns
  const channel=await call(`/api/projects/${pid}/growth/channels`,'POST',{name:'博客'});
  assert.equal(channel.status,201);
  const dupChannel=await call(`/api/projects/${pid}/growth/channels`,'POST',{name:'博客'});
  assert.equal(dupChannel.status,409);assert.equal(dupChannel.data.error,'GROWTH_CHANNEL_EXISTS');
  const campaign=await call(`/api/projects/${pid}/growth/campaigns`,'POST',{channelId:channel.data.item.id,name:'九月邀请',objective:'收集真实试用反馈'});
  assert.equal(campaign.status,201);
  assert.equal((await call(`/api/projects/${pid}/growth/campaigns`,'POST',{channelId:'nope',name:'X'})).status,404);

  // recording against an unpublished/draft content is refused
  const draft=await call(`/api/projects/${pid}/contents`,'POST',{title:'Draft',body:'Not approved yet',objective:'x',channel:'blog'});
  const guard=await call(`/api/projects/${pid}/growth/metrics`,'POST',{metric:'visits',value:5,channelId:channel.data.item.id,occurredAt:'2026-09-10T09:00:00+08:00',contentId:draft.data.item.id});
  assert.equal(guard.status,409);assert.equal(guard.data.error,'BAD_CAMPAIGN_REF');

  // invalid provenance without traceable source is refused
  const badProvenance=await call(`/api/projects/${pid}/growth/metrics`,'POST',{metric:'impressions',value:100,channelId:channel.data.item.id,occurredAt:'2026-09-10T09:00:00+08:00',provenance:'api_fetch'});
  assert.equal(badProvenance.status,400);

  const day=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const occurredAt=day+'T09:00:00+08:00';
  const ok=await call(`/api/projects/${pid}/growth/metrics`,'POST',{metric:'impressions',value:100,channelId:channel.data.item.id,campaignId:campaign.data.item.id,contentId:cid,occurredAt,provenance:'manual_entry',dedupKey:'row-1'});
  assert.equal(ok.status,201);
  assert.equal(ok.data.item.unit,'count');
  const dup=await call(`/api/projects/${pid}/growth/metrics`,'POST',{metric:'impressions',value:100,channelId:channel.data.item.id,campaignId:campaign.data.item.id,contentId:cid,occurredAt,provenance:'manual_entry',dedupKey:'row-1'});
  assert.equal(dup.status,409);assert.equal(dup.data.error,'GROWTH_DUPLICATE');
  const visits=await call(`/api/projects/${pid}/growth/metrics`,'POST',{metric:'visits',value:120,channelId:channel.data.item.id,occurredAt,dedupKey:'row-2'});
  assert.equal(visits.status,201);

  const overview=await call(`/api/projects/${pid}/growth`);
  assert.equal(overview.status,200);
  assert.equal(overview.data.counts.active,2);
  assert.equal(overview.data.provenanceCounts.manual_entry,2);

  const report=await call(`/api/projects/${pid}/growth/report?from=${day}&to=${day}`);
  assert.equal(report.status,200);
  assert.equal(report.data.totals.impressions,100);
  assert.equal(report.data.totals.visits,120);
  const pair=report.data.conversions.find(r=>r.numerator==='visits'&&r.denominator==='impressions');
  assert.equal(pair.reason,'caliber_inconsistent'); // 120 visits over 100 impressions is withheld
  assert.equal(pair.rate,null);
  assert.equal(report.data.window.granularity,'day');
  assert.ok(report.data.caveats.some(c=>c.includes('因果归因')));

  const badWindow=await call(`/api/projects/${pid}/growth/report?from=${day}&to=2026-13-99`);
  assert.equal(badWindow.status,400);

  // revise restores caliber; original row is preserved
  const revise=await call(`/api/projects/${pid}/growth/metrics/${visits.data.item.id}/revise`,'POST',{value:60,reason:'与后台导出核对后修正'});
  assert.equal(revise.status,200);assert.equal(revise.data.item.value,60);
  const revisedId=revise.data.item.id;
  const shortReason=await call(`/api/projects/${pid}/growth/metrics/${revisedId}/revise`,'POST',{value:61,reason:'太短'});
  assert.equal(shortReason.status,400);
  const report2=await call(`/api/projects/${pid}/growth/report?from=${day}&to=${day}`);
  const pair2=report2.data.conversions.find(r=>r.numerator==='visits'&&r.denominator==='impressions');
  assert.equal(pair2.rate,0.6);

  // verification requires a real rationale
  const badVerify=await call(`/api/projects/${pid}/growth/metrics/${ok.data.item.id}/verify`,'POST',{reason:'看了下'});
  assert.equal(badVerify.status,400);
  const verify=await call(`/api/projects/${pid}/growth/metrics/${ok.data.item.id}/verify`,'POST',{reason:'核对了站点分析后台的曝光数'});
  assert.equal(verify.status,200);assert.equal(verify.data.item.provenance,'verified');

  // the superseded original can no longer be retracted; the latest revision can
  const stale=await call(`/api/projects/${pid}/growth/metrics/${visits.data.item.id}/retract`,'POST',{reason:'试图撤回已被替代的旧版本'});
  assert.equal(stale.status,409);
  const retract=await call(`/api/projects/${pid}/growth/metrics/${revisedId}/retract`,'POST',{reason:'发现把两个渠道数据合并误录'});
  assert.equal(retract.status,200);assert.equal(retract.data.item.status,'retracted');
  const report3=await call(`/api/projects/${pid}/growth/report?from=${day}&to=${day}`);
  assert.equal(report3.data.totals.visits,null);
  const pair3=report3.data.conversions.find(r=>r.numerator==='visits'&&r.denominator==='impressions');
  assert.equal(pair3.reason,'unknown_data');

  // audit history and import endpoint
  const history=await call(`/api/projects/${pid}/growth/history?limit=50`);
  assert.equal(history.status,200);
  assert.ok(history.data.items.some(e=>e.kind==='growth.metric.verified'));
  assert.ok(history.data.items.some(e=>e.kind==='growth.metric.retracted'));
  const imported=await call(`/api/projects/${pid}/growth/metrics/import`,'POST',{items:[
   {metric:'interest',value:12,channelId:channel.data.item.id,occurredAt,provenance:'external_import',sourceRef:'https://analytics.example/export.csv',dedupKey:'x1'},
   {metric:'interest',value:12,channelId:channel.data.item.id,occurredAt,provenance:'external_import',sourceRef:'https://analytics.example/export.csv',dedupKey:'x1'}
  ]});
  assert.equal(imported.status,200);
  assert.equal(imported.data.acceptedCount,1);
  assert.equal(imported.data.duplicateCount,1);
 }finally{await new Promise(r=>server.close(r));}
});
