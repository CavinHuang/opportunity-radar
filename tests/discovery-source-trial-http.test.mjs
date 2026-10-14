import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('real HTTP source-trial report and signoff require owner key and honor evidence fingerprint',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-source-trial-http-'));
 const oldDb=process.env.RADAR_DB,oldToken=process.env.RADAR_OWNER_TOKEN;
 process.env.RADAR_DB=join(directory,'db.sqlite');process.env.RADAR_OWNER_TOKEN='source-trial-http-owner';
 const {createServer,closeStore}=await import('../src/server.mjs');
 const {openDatabase}=await import('../src/db.mjs');
 const store=openDatabase(process.env.RADAR_DB);
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const url=base+'/api/discovery/source-trial-audit';
 const headers={'Content-Type':'application/json','X-Radar-Owner-Key':'source-trial-http-owner'};
 try{
  for(let i=0;i<25;i++){
   const changed=i<2;
   const item=store.put('sources',{id:'source-'+i,status:'new',
    url:'https://'+(i%2?'host-b.example':'host-a.example')+'/'+i,
    title:changed?'I cannot reconcile invoice records every week':'AI product news briefing',
    description:changed?'I copy invoice records every day and spend hours fixing errors':'Generic introduction'});
   store.put('discovery_quality_labels',{id:item.id,sourceRevision:item.revision,label:'not_problem',reason:'人工复核文本核验'}); 
  }
  store.put('discovery_rule_decisions',{id:'real_problem_rule_trials',selectedTrial:'require_workaround',history:[]});
  assert.equal((await fetch(url)).status,401);
  const r=await fetch(url,{headers});assert.equal(r.status,200);
  const info=await r.json();
  assert.equal(info.report.readyForOwnerSignoff,true);
  assert.equal(info.report.changedCount,2);
  assert.equal((await fetch(url+'?arbitrary=1',{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:'{}'})).status,403);
  const body={policy_id:'require_workaround',fingerprint:info.report.fingerprint,expected_revision:info.history.revision,
   reason:'逐条核实变更原帖和来源标签后签署本次离线复核'};
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(res.status,200);
  assert.equal((await res.json()).snapshot.status,'source_trial_reviewed_not_released');
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,409);
  assert.equal(store.get('discovery_rule_decisions','real_problem_production_release'),null);
  assert.equal(store.get('discovery_rule_decisions','real_problem_source_trial_audit').revision,1);
 }finally{
  await new Promise(resolve=>server.close(resolve));store.close();closeStore();
  if(oldDb===undefined)delete process.env.RADAR_DB;else process.env.RADAR_DB=oldDb;
  if(oldToken===undefined)delete process.env.RADAR_OWNER_TOKEN;else process.env.RADAR_OWNER_TOKEN=oldToken;
  rmSync(directory,{recursive:true,force:true});
 }
});
