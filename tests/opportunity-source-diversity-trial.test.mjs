import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {opportunityDiscoveryBenchmark} from '../src/opportunity-discovery-benchmark.mjs';

test('offline round robin rescues a distinct-domain problem without relaxing eligibility',()=>{
 const db=openDatabase();try{
  for(let i=0;i<55;i++){
   const row=db.put('sources',{id:'main-'+i,status:'new',url:'https://one.example.org/'+i,
    title:'I cannot reconcile invoices for client '+i+' manually',
    description:'I manually reconcile invoices for client '+i+' every day and spend hours fixing errors'});
   if(i===0)db.put('discovery_quality_labels',{id:row.id,label:'real_problem',reason:'已核对来源内容为真实操作困难',sourceRevision:row.revision});
  }
  const other=db.put('sources',{id:'other',status:'new',url:'https://two.example.org/problem',
    title:'I cannot organize family photos manually',
    description:'I manually organize photos every day and spend hours fixing errors'});
  db.put('discovery_quality_labels',{id:other.id,label:'real_problem',reason:'已人工核查此问题确有操作障碍',sourceRevision:other.revision});
  const base=opportunityScanCandidates(db,{limit:50});
  const diverse=opportunityScanCandidates(db,{limit:50,sourceDiversityTrial:true});
  assert.equal(base.strategy,'production_baseline');
  assert.equal(diverse.strategy,'source_diversity_trial');
  assert.equal(base.items.length,50);
  assert.equal(diverse.items.length,50);
  assert.equal(diverse.items.some(x=>x.signalIds.includes('other')),true);
  assert.equal(opportunityDiscoveryBenchmark(db).diversityTrial.liveRuleChanged,false);
 }finally{db.close();}
});
test('diversity trial does not resurrect promotional content',()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'promo',status:'new',url:'https://market.example.org/p',
   title:'We launched a new invoice product',description:'We launched our AI invoice product today with discounted pricing'});
  assert.equal(opportunityScanCandidates(db,{sourceDiversityTrial:true}).items.length,0);
 }finally{db.close();}
});
