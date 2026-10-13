import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCauseHints,rootCauseConflict,clusterRootCauseAudit} from '../src/root-cause-audit.mjs';
import {openDatabase} from '../src/db.mjs';
import {opportunityDiscoveryBenchmark} from '../src/opportunity-discovery-benchmark.mjs';
const source=(id,description)=>({id,title:'I cannot reconcile invoices for my clients',description,url:'https://example.org/'+id,status:'new'});
test('same topic with explicitly different failure symptoms raises review suggestion only',()=>{
 const a=source('a','I manually reconcile invoices. The matched amounts are incorrect and wrong.');
 const b=source('b','I manually reconcile invoices. This takes hours and is time consuming.');
 const result=rootCauseConflict(a,b);
 assert.equal(result.conflict,true);
 assert.equal(result.verified,false);
 const audit=clusterRootCauseAudit([{id:'g',signals:[a,b]}]);
 assert.equal(audit.flaggedGroups,1);
 assert.equal(audit.autoSplit,false);
});
test('unknown or mixed symptoms cannot be used to assert different causes',()=>{
 const a=source('a','I have problems reconciling invoices.');
 const b=source('b','I cannot reconcile invoices; wrong results and this takes hours.');
 assert.equal(rootCauseHints(a).exclusive,null);
 assert.equal(rootCauseHints(b).exclusive,null);
 assert.equal(rootCauseConflict(a,b).conflict,false);
});
test('existing scanner remains unchanged; benchmark reports review-only flags',()=>{
 const db=openDatabase();try{
  const a=source('a','I manually reconcile invoices; the matched amounts are incorrect and wrong.');
  const b=source('b','I manually reconcile invoices; this takes hours and is too slow.');
  db.put('sources',a);db.put('sources',b);
  const benchmark=opportunityDiscoveryBenchmark(db);
  assert.equal(benchmark.rootCauseAudit.flaggedGroups,1);
  assert.equal(benchmark.rootCauseAudit.autoSplit,false);
  assert.equal(benchmark.candidateCount,1);
 }finally{db.close();}
});
