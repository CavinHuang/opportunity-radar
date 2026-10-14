import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezeAndReviewRegression,addReviewedHoldout} from './helpers/frozen-regression-release-fixture.mjs';

test('real owner-only HTTP release trend is read-only, protects private post text and refuses stale evidence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-regression-release-http-'));
 const before={db:process.env.RADAR_DB,owner:process.env.RADAR_OWNER_TOKEN};
 process.env.RADAR_DB=join(dir,'test.sqlite');
 process.env.RADAR_OWNER_TOKEN='release-regression-owner-test';
 const {createServer,closeStore}=await import('../src/server.mjs');
 const {openDatabase}=await import('../src/db.mjs');
 const db=openDatabase(process.env.RADAR_DB);
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const auth={'X-Radar-Owner-Key':'release-regression-owner-test'};
 const path='/api/discovery/regression-suite/trend';
 try{
  for(let i=0;i<25;i++){
   const positive=i<8,fp=i>=8&&i<10,id='before-'+i;
   const s=db.put('sources',{id,status:'new',
    url:'https://'+(i%2?'site-two.example':'site-one.example')+'/'+i,
    title:positive||fp?'Cannot automate invoice workflow':'We launched a new product',
    description:positive?'I manually copy invoices every day and spend hours fixing errors':
     fp?'I copy invoices every day and spend hours fixing errors':'Our startup released a new tool'});
   db.put('discovery_quality_labels',{id,label:positive?'real_problem':'not_problem',
    sourceRevision:s.revision,reason:'已核对该原始帖子'});
  }
  assert.equal((await fetch(base+path)).status,401);
  const old=await (await fetch(base+path,{headers:auth})).json();
  assert.equal(old.releaseGate.ready,false);
  assert.ok(old.releaseGate.blockers.includes('frozenSuitePresent'));
  const {frozen}=freezeAndReviewRegression(db);
  addReviewedHoldout(db,frozen.snapshot.at);
  const response=await fetch(base+path,{headers:auth});
  assert.equal(response.status,200);
  const value=await response.json();
  assert.equal(value.releaseGate.ready,true);
  assert.equal(value.releaseGate.fresh.reviewed,6);
  assert.equal(value.versions.length,1);
  assert.equal(value.sameCorpus.length,2);
  assert.equal(value.releaseGate.productionChanged,false);
  assert.ok(!JSON.stringify(value).includes('I manually copy invoices every day'));
  const gate=await (await fetch(base+'/api/discovery/regression-suite/release-gate',{headers:auth})).json();
  assert.equal(gate.evidenceHash,value.releaseGate.evidenceHash);
  const tests=db.list('sources').length;
  assert.equal(tests,31);
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_release'),null);
  const s=db.get('sources','after-freeze-0');
  db.put('sources',{...s,title:'Changed after Owner labeled it'},s.revision);
  const invalid=await (await fetch(base+path,{headers:auth})).json();
  assert.equal(invalid.releaseGate.ready,false);
  assert.notEqual(invalid.releaseGate.evidenceHash,value.releaseGate.evidenceHash);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  db.close();closeStore();
  if(before.db===undefined)delete process.env.RADAR_DB;else process.env.RADAR_DB=before.db;
  if(before.owner===undefined)delete process.env.RADAR_OWNER_TOKEN;else process.env.RADAR_OWNER_TOKEN=before.owner;
  rmSync(dir,{recursive:true,force:true});
 }
});
