import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('owner authenticated regression fixture freeze and replay survives HTTP and SQLite restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-frozen-suite-'));
 const previousDb=process.env.RADAR_DB,previousKey=process.env.RADAR_OWNER_TOKEN;
 process.env.RADAR_DB=join(dir,'app.sqlite');process.env.RADAR_OWNER_TOKEN='frozen-suite-test-owner';
 const {createServer,closeStore}=await import('../src/server.mjs');
 const {openDatabase}=await import('../src/db.mjs');
 const db=openDatabase(process.env.RADAR_DB);
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const path='http://127.0.0.1:'+server.address().port+'/api/discovery/regression-suite';
 const headers={'Content-Type':'application/json','X-Radar-Owner-Key':'frozen-suite-test-owner'};
 try{
  for(let i=0;i<24;i++){
   const p=i<8,affected=i===8,id='e2e-'+i;
   const s=db.put('sources',{id,status:'new',url:'https://'+(i%2?'b.example':'a.example')+'/'+i,
    title:p||affected?'Cannot automate invoice workflow':'Software product news',
    description:p?'I manually copy invoices every day and spend hours fixing errors':
     affected?'I copy invoices every day and spend hours fixing errors':'A new product announcement'});
   db.put('discovery_quality_labels',{id,sourceRevision:s.revision,label:p?'real_problem':'not_problem',reason:'人工复核后记录的对照案例'});
  }
  assert.equal((await fetch(path)).status,401);
  assert.equal((await fetch(path,{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:'{}'})).status,403);
  const initial=await (await fetch(path,{headers})).json();
  assert.equal(initial.suite.candidate.ready,true);
  const payload={reason:'当前真实标注经过核对，固定原文便于后续版本比较',expected_revision:0};
  const create=await fetch(path,{method:'POST',headers,body:JSON.stringify(payload)});
  assert.equal(create.status,200);
  assert.equal((await create.json()).revision,1);
  assert.equal((await fetch(path,{method:'POST',headers,body:JSON.stringify(payload)})).status,409);
  const replay=await (await fetch(path+'/replay',{headers})).json();
  assert.equal(replay.available,true);
  assert.equal(replay.removedFalsePositives,1);
  assert.equal(replay.verdict,'manual_review_only');
  const decided=await fetch(path+'/review',{method:'POST',headers,body:JSON.stringify({
   policy_id:'require_workaround',suite_revision:1,fingerprint:replay.fingerprint,decision:'recommend_shadow_review',
   reason:'回归集未出现新增错误，但仍要求进一步人工影子测试',expected_revision:0})});
  assert.equal(decided.status,200);
  assert.equal((await decided.json()).record.decision,'recommend_shadow_review');
  assert.equal(db.get('discovery_rule_decisions','real_problem_rule_trials'),null);
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_release'),null);
  const persisted=await (await fetch(path,{headers})).json();
  assert.equal(persisted.suite.snapshots.length,1);
  assert.equal(persisted.review.records.length,1);
 }finally{
  await new Promise(resolve=>server.close(resolve));db.close();closeStore();
  if(previousDb===undefined)delete process.env.RADAR_DB;else process.env.RADAR_DB=previousDb;
  if(previousKey===undefined)delete process.env.RADAR_OWNER_TOKEN;else process.env.RADAR_OWNER_TOKEN=previousKey;
  rmSync(dir,{recursive:true,force:true});
 }
});
