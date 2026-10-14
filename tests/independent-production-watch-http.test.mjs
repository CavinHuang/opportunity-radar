import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {probeProduction} from '../scripts/production-watch.mjs';

test('watch is disabled by default, requires separate secret and never opens Owner data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-watch-http-'));
 const old={db:process.env.RADAR_DB,owner:process.env.RADAR_OWNER_TOKEN,watch:process.env.RADAR_WATCH_TOKEN};
 process.env.RADAR_DB=join(dir,'radar.sqlite');
 process.env.RADAR_OWNER_TOKEN='owner-must-stay-secret';
 delete process.env.RADAR_WATCH_TOKEN;
 const {createServer,closeStore}=await import('../src/server.mjs');
 const {openDatabase}=await import('../src/db.mjs');
 const db=openDatabase(process.env.RADAR_DB);
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const key='valid-independent-watch-token-more-than-32-characters';
 try{
  const disabled=await fetch(base+'/api/operations/watch');
  assert.equal(disabled.status,503);
  assert.equal((await disabled.json()).code,'WATCH_NOT_CONFIGURED');
  process.env.RADAR_WATCH_TOKEN=key;
  assert.equal((await fetch(base+'/api/operations/watch')).status,401);
  assert.equal((await fetch(base+'/api/operations/watch',{headers:{'X-Radar-Watch-Key':'bad'}})).status,401);
  db.put('sources',{id:'private-item',url:'https://secret-private.example/sensitive',
   title:'Sensitive personal notes',status:'new',description:'private'});
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',policyId:'require_workaround',percentage:1,
   history:[{action:'release',policyId:'require_workaround',percentage:1,
    reason:'Internal researcher notes must never be public',at:'2026-10-14T10:00:00Z'}]});
  const ok=await fetch(base+'/api/operations/watch',{headers:{'X-Radar-Watch-Key':key}});
  assert.equal(ok.status,200);
  const body=await ok.json();
  assert.equal(body.active,true);
  assert.equal(body.rolloutPercent,1);
  assert.equal(body.ownerDataIncluded,false);
  for(const text of ['Internal researcher notes','Sensitive personal notes','secret-private.example',key])
   assert.ok(!JSON.stringify(body).includes(text));
  assert.equal((await fetch(base+'/api/discovery/review-coverage')).status,401);
  assert.equal((await fetch(base+'/api/discovery/review-coverage',{
   headers:{'X-Radar-Watch-Key':key}})).status,401);
  const reviewed=await fetch(base+'/api/discovery/review-coverage',{
   headers:{'X-Radar-Owner-Key':'owner-must-stay-secret'}});
  assert.equal(reviewed.status,200);
  assert.equal((await reviewed.json()).totals.sources,1);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  db.close();closeStore();
  if(old.db===undefined)delete process.env.RADAR_DB;else process.env.RADAR_DB=old.db;
  if(old.owner===undefined)delete process.env.RADAR_OWNER_TOKEN;else process.env.RADAR_OWNER_TOKEN=old.owner;
  if(old.watch===undefined)delete process.env.RADAR_WATCH_TOKEN;else process.env.RADAR_WATCH_TOKEN=old.watch;
  rmSync(dir,{recursive:true,force:true});
 }
});

test('real HTTP health can remain green while independent watcher rejects stopped guard snapshots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-guard-watch-http-'));
 const old={db:process.env.RADAR_DB,owner:process.env.RADAR_OWNER_TOKEN,
  watch:process.env.RADAR_WATCH_TOKEN,sha:process.env.RADAR_RELEASE_SHA};
 const token='separate-long-watch-key-over-32-characters';
 const sha='d'.repeat(40);
 process.env.RADAR_DB=join(dir,'guard.sqlite');
 process.env.RADAR_OWNER_TOKEN='integration-owner-token';
 process.env.RADAR_WATCH_TOKEN=token;
 process.env.RADAR_RELEASE_SHA=sha;
 const {createServer,closeStore}=await import('../src/server.mjs?independent-guard-watch');
 const {openDatabase}=await import('../src/db.mjs');
 const db=openDatabase(process.env.RADAR_DB);
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const now=Date.parse('2026-10-14T12:00:00.000Z');
 try{
  const ready=await probeProduction({url,expectedSha:sha,
   watchToken:token,allowHttpLoopback:true,now});
  assert.equal(ready.state,'healthy');
  assert.equal(ready.guardStatus,'inactive');
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',
   policyId:'require_workaround',percentage:1,history:[{action:'release',
    policyId:'require_workaround',at:'2026-10-14T11:00:00.000Z'}]});
  const liveness=await probeProduction({url,expectedSha:sha,
   watchToken:token,allowHttpLoopback:true,now});
  assert.equal(liveness.state,'down');
  assert.equal(liveness.code,'GUARD_RELEASE_MISMATCH');
  const publicHealthy=await (await fetch(url+'/api/health')).json();
  assert.equal(publicHealthy.ok,true);
  db.put('discovery_rule_decisions',{id:'real_problem_production_monitor',
   snapshots:[{at:'2026-10-14T11:55:00.000Z',releaseRevision:1,autoRollback:false}]});
  const ok=await probeProduction({url,expectedSha:sha,
   watchToken:token,allowHttpLoopback:true,now});
  assert.equal(ok.state,'healthy');
  assert.equal(ok.guardMonitorAgeSeconds,300);
  const content=JSON.stringify(ok);
  assert.ok(!content.includes(token));
  assert.ok(!content.includes('integration-owner-token'));
 }finally{
  await new Promise(resolve=>server.close(resolve));
  db.close();closeStore();
  if(old.db===undefined)delete process.env.RADAR_DB;else process.env.RADAR_DB=old.db;
  if(old.owner===undefined)delete process.env.RADAR_OWNER_TOKEN;else process.env.RADAR_OWNER_TOKEN=old.owner;
  if(old.watch===undefined)delete process.env.RADAR_WATCH_TOKEN;else process.env.RADAR_WATCH_TOKEN=old.watch;
  if(old.sha===undefined)delete process.env.RADAR_RELEASE_SHA;else process.env.RADAR_RELEASE_SHA=old.sha;
  rmSync(dir,{recursive:true,force:true});
 }
});
