import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('source cohort API uses actual SQLite snapshots, requires owner credentials and never mutates labels',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-source-cohort-http-'));
 const previous={RADAR_DB:process.env.RADAR_DB,RADAR_OWNER_TOKEN:process.env.RADAR_OWNER_TOKEN};
 process.env.RADAR_DB=join(directory,'radar.sqlite');
 process.env.RADAR_OWNER_TOKEN='cohort-test-owner';
 const {createServer,closeStore}=await import('../src/server.mjs');
 const {openDatabase}=await import('../src/db.mjs');
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const url=base+'/api/discovery/source-cohort-quality';
 const headers={'X-Radar-Owner-Key':'cohort-test-owner'};
 const db=openDatabase(process.env.RADAR_DB);
 try{
  const saved=db.put('sources',{id:'manual-observation',status:'new',title:'Cannot automate repetitive receipts workflow',
   description:'I spend hours manually copying receipts between tools',
   url:'https://source.example/posts/one',createdAt:'2026-10-10T01:00:00Z'});
  db.put('discovery_quality_labels',{id:saved.id,sourceRevision:saved.revision,label:'real_problem',reason:'原文人工核查后保留的验证标注'});
  const unauthorized=await fetch(url);
  assert.equal(unauthorized.status,401);
  const good=await fetch(url,{headers});
  assert.equal(good.status,200);
  const report=await good.json();
  assert.equal(report.totals.inWindow,1);
  assert.equal(report.totals.reviewed,1);
  assert.equal(report.readOnly,true);
  assert.equal(report.cohorts[0].host,'source.example');
  assert.equal(report.evaluatedRates,null);
  const bad=await fetch(url+'?limit=999',{headers});
  assert.equal(bad.status,400);
  const after=db.get('discovery_quality_labels','manual-observation');
  assert.equal(after.revision,1);
  assert.equal(db.list('discovery_rule_decisions').length,0);
 }finally{
  db.close();
  await new Promise(resolve=>server.close(resolve));
  closeStore();
  for(const [key,val] of Object.entries(previous)){if(val===undefined)delete process.env[key];else process.env[key]=val;}
  rmSync(directory,{recursive:true,force:true});
 }
});
