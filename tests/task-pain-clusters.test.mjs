import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {taskPainSignature,taskPainClusters} from '../src/task-pain-clusters.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';

const item=(id,title,description,url='https://example.org/'+id)=>({id,title,description,url,status:'new'});
test('different title wording can suggest the same explicit task without asserting same customer',()=>{
 const a=item('a','I cannot reconcile invoices','I manually reconcile invoices every day and spend hours fixing errors');
 const b=item('b','Matching invoice records is painful','I match invoices by hand every day and spend hours fixing errors','https://another.org/b');
 assert.equal(taskPainSignature(a),'invoice_reconciliation');
 assert.equal(taskPainSignature(b),'invoice_reconciliation');
 const clusters=taskPainClusters([a,b]);
 assert.equal(clusters.length,1);
 assert.deepEqual(clusters[0].members.map(x=>x.id),['a','b']);
 assert.equal(clusters[0].confidence,'candidate_only');
});
test('tracking links and unrelated tasks do not inflate semantic groups',()=>{
 const a=item('a','I cannot reconcile invoices','I manually reconcile invoices every day and spend hours fixing errors','https://example.org/pain?utm_source=one');
 const duplicate=item('b','Matching invoice records is painful','I match invoices by hand every day and spend hours fixing errors','https://example.org/pain?utm_source=two');
 const unrelated=item('c','I cannot organize photos','I manually organize photos every day and spend hours fixing errors');
 assert.equal(taskPainClusters([a,duplicate,unrelated]).length,0);
});
test('opportunity scan exposes additional task group even when title similarity is weak',()=>{
 const db=openDatabase();try{
  const a=item('a','I cannot reconcile invoices','I manually reconcile invoices every day and spend hours fixing errors');
  const b=item('b','Matching invoice records is painful','I match invoices by hand every day and spend hours fixing errors','https://another.org/b');
  db.put('sources',a);db.put('sources',b);
  const list=opportunityScanCandidates(db,{limit:12}).items;
  assert.ok(list.some(x=>x.clusterMethod==='task_action_pain_lexicon'));
  const cluster=list.find(x=>x.clusterMethod==='task_action_pain_lexicon');
  assert.equal(cluster.signalCount,2);
  assert.equal(cluster.status,'unverified_candidate');
  assert.ok(cluster.clusterCaveat.includes('人工'));
 }finally{db.close();}
});
