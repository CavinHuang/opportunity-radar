import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectProductionProblem} from '../src/discovery-production-release.mjs';

test('owner authenticated HTTP post-release evidence is read only and pinned to the release baseline',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-postrelease-http-'));
 const oldDb=process.env.RADAR_DB,oldToken=process.env.RADAR_OWNER_TOKEN;
 process.env.RADAR_DB=join(dir,'radar.sqlite');
 process.env.RADAR_OWNER_TOKEN='post-release-owner-test';
 const {createServer,closeStore}=await import('../src/server.mjs');
 const {openDatabase}=await import('../src/db.mjs');
 const db=openDatabase(process.env.RADAR_DB);
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const url=base+'/api/discovery/post-release-evidence';
 const auth={'X-Radar-Owner-Key':'post-release-owner-test'};
 try{
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:auth})).status,404);
  const empty=await (await fetch(url,{headers:auth})).json();
  assert.equal(empty.report.status,'no_release_record');
  assert.equal(empty.report.totals.newMisses,0);
  const at='2026-10-13T12:00:00.000Z',pre='2026-10-13T10:00:00.000Z';
  db.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround'});
  db.put('discovery_rule_decisions',{id:'real_problem_release_preflight',records:[{
   policyId:'require_workaround',evidenceHash:'fake-pinned-evidence',
   frozenRegressionEvidence:{suiteRevision:3,suiteFingerprint:'test-frozen',holdoutFingerprint:'test-holdout'},
   sourceTrialFingerprint:'test-reviewed',capturedAt:pre
  }]});
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',policyId:'require_workaround',percentage:5,
   history:[{action:'release',policyId:'require_workaround',percentage:5,evidenceHash:'fake-pinned-evidence',at}]});
  let exposed;
  for(let i=0;i<150;i++){
   const s=db.put('sources',{id:'scan-'+i,status:'new',url:'https://forum.example/issue/'+i,
    title:'Cannot automate invoice workflow',description:'I copy invoices every day and spend hours fixing errors'});
   if(selectProductionProblem(db,s).productionVariant==='require_workaround_v1'){exposed=s;break;}
  }
  assert.ok(exposed);
  db.put('discovery_quality_labels',{id:exposed.id,label:'real_problem',sourceRevision:exposed.revision,
   at:'2026-10-13T14:00:00.000Z',reason:'使用合成样例验证发布后原帖人工复核'});
  const response=await fetch(url,{headers:auth});
  assert.equal(response.status,200);
  const parsed=await response.json();
  assert.equal(parsed.report.status,'confirmed_post_release_regression');
  assert.equal(parsed.report.totals.newMisses,1);
  assert.equal(parsed.report.baseline.frozenSuiteRevision,3);
  assert.equal(parsed.report.baselineVerified,true);
  assert.equal(parsed.report.liveRuleChanged,false);
  assert.equal(parsed.history.length,0);
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_monitor'),null);
  assert.equal(db.get('discovery_rule_decisions','real_problem_production_release').policyId,'require_workaround');
 }finally{
  await new Promise(resolve=>server.close(resolve));
  db.close();closeStore();
  if(oldDb===undefined)delete process.env.RADAR_DB;else process.env.RADAR_DB=oldDb;
  if(oldToken===undefined)delete process.env.RADAR_OWNER_TOKEN;else process.env.RADAR_OWNER_TOKEN=oldToken;
  rmSync(dir,{recursive:true,force:true});
 }
});
