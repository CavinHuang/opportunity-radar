import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {discoveryClusters,reviewDiscoveryCluster} from '../src/discovery.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {opportunityDiscoveryBenchmark} from '../src/opportunity-discovery-benchmark.mjs';

const add=(store,id,url)=>store.put('sources',{id,status:'new',url,
 title:'I cannot reconcile invoices manually for customer records',
 description:'I manually reconcile invoices every day and spend hours fixing errors for different workflows'});

test('owner-marked different problems recover as distinct qualified opportunities, never remerge',()=>{
 const db=openDatabase();try{
  const first=add(db,'first','https://first.example.org/thread');
  const second=add(db,'second','https://second.example.org/thread');
  for(const s of [first,second])db.put('discovery_quality_labels',{id:s.id,label:'real_problem',sourceRevision:s.revision,reason:'原帖人工核查确认有具体流程障碍'});
  const group=discoveryClusters(db,{includeDismissed:true}).items[0];
  assert.equal(group.signalCount,2);
  const before=opportunityScanCandidates(db,{limit:50});
  assert.equal(before.items.filter(x=>x.signalIds.includes('first')||x.signalIds.includes('second')).length,1);
  reviewDiscoveryCluster(db,group.id,{action:'dismiss',classification:'different_problem',
   fingerprint:group.fingerprint,reason:'阅读原帖后发现其实是不同任务根因，不能合并成一个问题',expected_revision:0});
  const recovered=opportunityScanCandidates(db,{limit:50});
  const restored=recovered.items.filter(x=>['first','second'].some(id=>x.signalIds.includes(id)));
  assert.equal(restored.length,2);
  assert.deepEqual(restored.map(x=>x.signalIds).flat().sort(),['first','second']);
  assert.ok(restored.every(x=>x.clusterMethod==='owner_recovered_different_problem'));
  assert.equal(recovered.recoveredSplitSources,2);
  assert.equal(opportunityDiscoveryBenchmark(db).metric.truePositive,2);
  // Unchanged membership can be restored with version-checked owner action.
  const now=discoveryClusters(db,{includeDismissed:true}).items[0];
  reviewDiscoveryCluster(db,group.id,{action:'restore',fingerprint:now.fingerprint,expected_revision:1});
  assert.equal(opportunityScanCandidates(db,{limit:50}).items.filter(x=>x.signalIds.includes('first')).length,1);
 }finally{db.close();}
});

test('old different-problem dismissal does not override changed cluster membership',()=>{
 const db=openDatabase();try{
  add(db,'a','https://a.example.org/a');add(db,'b','https://b.example.org/b');
  const original=discoveryClusters(db,{includeDismissed:true}).items[0];
  reviewDiscoveryCluster(db,original.id,{action:'dismiss',fingerprint:original.fingerprint,
   classification:'different_problem',reason:'两个来源属于不同用户任务，不能合并展示',expected_revision:0});
  const src=db.get('sources','b');
  db.put('sources',{...src,description:src.description+' plus new details'},src.revision);
  const current=discoveryClusters(db,{includeDismissed:true}).items[0];
  assert.notEqual(current.fingerprint,original.fingerprint);
  assert.equal(current.state,'needs_review');
  assert.equal(opportunityScanCandidates(db).recoveredSplitSources,0);
 }finally{db.close();}
});

test('dismissing suspected repost does not restore it as separate high-confidence opportunity',()=>{
 const db=openDatabase();try{
  add(db,'a','https://a.example.org/a');add(db,'b','https://b.example.org/b');
  const group=discoveryClusters(db,{includeDismissed:true}).items[0];
  reviewDiscoveryCluster(db,group.id,{action:'dismiss',fingerprint:group.fingerprint,
   classification:'possible_repost',reason:'两条内容可能为同一帖子转载，需要继续核实',expected_revision:0});
  const report=opportunityScanCandidates(db);
  assert.equal(report.recoveredSplitSources,0);
  assert.ok(report.items.every(x=>x.clusterMethod!=='owner_recovered_different_problem'));
 }finally{db.close();}
});
