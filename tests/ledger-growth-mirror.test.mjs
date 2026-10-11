import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'radar-ledger-mirror-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
process.env.RADAR_AGENT_TOKEN='mirror-agent';
process.env.RADAR_OWNER_TOKEN='mirror-owner';
const {createServer,closeStore}=await import('../src/server.mjs');

test('actual ledger entries mirror into growth metrics exactly once (calibers respected)',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'mirror-owner'};
 const call=async(path,method='GET',body,headers=owner)=>{const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  // Seed: opportunity → approved validation → experiment (the owner approval gate).
  const opp=await call('/api/opportunities','POST',{title:'账本镜像走查',problem:'重复记录',market:'中国大陆',sources:[{url:'https://example.org/mirror'}]});
  assert.equal(opp.status,201);const oid=opp.data.item.id;
  const plan=await call('/api/opportunities/'+oid+'/validation','POST',{audience:'需要管理家庭单据的个人与小团队',hypothesis:'家庭常找不到近期购买的重要单据',researchQuestion:'你最近一次找不到单据是什么时候？',channel:'社区志愿者随访与线下访谈',successCriterion:'两位参与者独立描述具体的失败细节',stopCondition:'四小时内没有任何有效访谈即暂停计划',nextAction:'邀请三位知情志愿者进行简短访谈',timeBudgetHours:2});
  assert.equal(plan.status,201);const planId=plan.data.item.id,planRev=plan.data.item.revision;
  await call('/api/opportunities/'+oid+'/validation/'+planId+'/observations','POST',{participantRef:'m-01',kind:'interview',stance:'supports',note:'合成测试观察，非真实消费者的反馈记录，仅用于走查',consentConfirmed:true});
  const closed=await call('/api/opportunities/'+oid+'/validation/'+planId+'/close','POST',{outcome:'continue',reason:'验证窗口结束，批准进入下一步原型验证',acknowledgeUncertainty:true,expected_revision:planRev});
  assert.equal(closed.status,200);
  const proj=await call('/api/experiments','POST',{opportunityId:oid,goal:'g',hypothesis:'h',criteria:['c1'],stopCondition:'stop',hours:10});
  assert.equal(proj.status,201);const pid=proj.data.project.id;

  // Idempotent double submit (Idempotency-Key through the nested-transaction
  // path) must produce ONE ledger row and ONE mirrored growth metric.
  const key={...owner,'Idempotency-Key':'mirror-visits'};
  const first=await call('/api/projects/'+pid+'/ledger','POST',{type:'visits',value:40,actual:true,source:'平台分析'},key);
  const again=await call('/api/projects/'+pid+'/ledger','POST',{type:'visits',value:40,actual:true,source:'平台分析'},key);
  assert.equal(first.status,201);assert.equal(again.status,201);
  assert.equal(again.data.item.id,first.data.item.id);
  await call('/api/projects/'+pid+'/ledger','POST',{type:'trials',value:2,actual:true});
  // Unmapped caliber (reuse ≠ retention) and non-actual entries never mirror.
  await call('/api/projects/'+pid+'/ledger','POST',{type:'reuse',value:1,actual:true});
  await call('/api/projects/'+pid+'/ledger','POST',{type:'trials',value:5,actual:false});

  const today=new Date().toISOString().slice(0,10);
  const report=await call('/api/projects/'+pid+'/growth/report?from=2026-01-01&to='+today+'&granularity=day');
  assert.equal(report.status,200);
  assert.equal(report.data.totals.visits,40,'idempotent double submit mirrored once');
  assert.equal(report.data.totals.trials,2,'only actual entries mirror');
  assert.equal(report.data.totals.activation,null,'unmapped/missing metrics stay unknown, never zero');
  const overview=await call('/api/projects/'+pid+'/growth');
  assert.equal(overview.data.provenanceCounts.manual_entry,2);
  assert.ok(overview.data.latest.every(x=>!String(x.dedupKey).startsWith('ledger:')||x.provenance==='manual_entry'));
  assert.equal(overview.data.latest.filter(x=>String(x.dedupKey).startsWith('ledger:')).length,2);
 }finally{
  await new Promise(r=>server.close(r));
  closeStore();
  rmSync(dir,{recursive:true,force:true});
 }
});
