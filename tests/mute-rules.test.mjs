import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'radar-mute-rules-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
process.env.RADAR_OWNER_TOKEN='mute-owner';
process.env.RADAR_AGENT_TOKEN='mute-agent';
const {createServer,closeStore}=await import('../src/server.mjs');
const {evaluateMuteRules}=await import('../src/mute-rules.mjs');

test('evaluateMuteRules matches title/description case-insensitively and skips deleted rules',()=>{
 const rules=[
  {id:'r1',keyword:'招聘',deletedAt:null},
  {id:'r2',keyword:'SPONSORED',deletedAt:null},
  {id:'r3',keyword:'已停用',deletedAt:'2026-10-11T00:00:00Z'},
 ];
 assert.equal(evaluateMuteRules(rules,{title:'内部 招聘 信息',description:''}).id,'r1');
 assert.equal(evaluateMuteRules(rules,{title:'x',description:'This post is sponsored by someone'}).id,'r2');
 assert.equal(evaluateMuteRules(rules,{title:'普通帖子',description:'无关键词'}),null);
 assert.equal(evaluateMuteRules(rules,{title:'提到 已停用 的旧规则',description:''}),null,'deleted rules never match');
 assert.equal(evaluateMuteRules([],{title:'anything',description:'x'}),null);
});

test('mute rule CRUD over HTTP; scan-muted signals restore; manual entries are never muted',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'mute-owner'};
 const call=async(path,method='GET',body,headers=owner)=>{const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  const created=await call('/api/mute-rules','POST',{keyword:'招聘',note:'走查：过滤招聘帖'});
  assert.equal(created.status,201);
  assert.throws(()=>{throw Object.assign(new Error('x'),{code:'X'});});
  const dup=await call('/api/mute-rules','POST',{keyword:'招聘'});
  assert.equal(dup.status,409);assert.equal(dup.data.error,'MUTE_RULE_EXISTS');
  assert.equal((await call('/api/mute-rules','POST',{keyword:'  '})).status,400);
  const list=await call('/api/mute-rules');
  assert.equal(list.data.items.length,1);assert.equal(list.data.items[0].keyword,'招聘');

  // 手动录入是 owner 显式动作：即使命中规则也不静音。
  const manual=await call('/api/signals/manual','POST',{title:'招聘 walkthough manual entry',description:'命中关键词但不应被静音',url:'https://example.org/manual/mute',market:'中国大陆'});
  assert.equal(manual.status,201);assert.equal(manual.data.item.status,'new');
  assert.equal(manual.data.item.muteRule??null,null);

  // 直接注入一条「扫描命中规则」的信号（scanSources 的写法），应带 muteRule 且可手动恢复。
  const {openDatabase}=await import('../src/db.mjs');
  const db=openDatabase(dir+'/db.sqlite');
  const mutedAt=new Date().toISOString();
  db.put('sources',{id:'muted-fixture',title:'扫描命中 招聘 的信号',description:'',url:'https://example.org/scanned/muted',feedIds:[],feed:'https://example.org/rss',market:'中国大陆',status:'dismissed',muteRule:{id:created.data.item.id,keyword:'招聘'},triagedAt:mutedAt,createdAt:mutedAt,linkedOpportunityId:null});
  db.close();
  const restored=await call('/api/signals/muted-fixture/triage','POST',{status:'new',expected_revision:1});
  assert.equal(restored.status,200);assert.equal(restored.data.item.status,'new');
  assert.equal(restored.data.item.muteRule.keyword,'招聘','恢复后保留命中规则，透明可查');

  // 删除规则：列表不再包含；删除不存在的返回 404。
  const del=await call('/api/mute-rules/'+created.data.item.id,'DELETE');
  assert.equal(del.status,200);
  assert.equal((await call('/api/mute-rules')).data.items.length,0);
  assert.equal((await call('/api/mute-rules/'+created.data.item.id,'DELETE')).status,404);
 }finally{
  await new Promise(r=>server.close(r));
  closeStore();
  rmSync(dir,{recursive:true,force:true});
 }
});
