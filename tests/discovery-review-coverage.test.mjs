import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {discoveryReviewCoverage} from '../src/discovery-review-coverage.mjs';
import {productionHeartbeat} from '../src/production-heartbeat.mjs';

function seed(db,{host='alpha.example',positive=false,reviewed=false,id}={}){
 const title=positive?'Cannot automate invoice workflow':'AI product launch update';
 const description=positive?'I manually reconcile invoices every day and lose hours':
  'A startup has introduced a new product';
 const s=db.put('sources',{id,status:'new',title,description,url:'https://'+host+'/'+id});
 if(reviewed)db.put('discovery_quality_labels',{id,label:positive?'real_problem':'not_problem',
  sourceRevision:s.revision,reason:'人工检查此原始帖文的完整上下文'});
 return s;
}
test('review coverage surfaces concentrated labels and unreviewed predicted negatives',()=>{
 const db=openDatabase();try{
  for(let i=0;i<12;i++)seed(db,{id:'alpha-'+i,host:'alpha.example',positive:i<4,reviewed:true});
  for(let i=0;i<12;i++)seed(db,{id:'beta-'+i,host:'beta.example',positive:i<4,reviewed:false});
  const report=discoveryReviewCoverage(db,{limit:8});
  assert.equal(report.totals.sources,24);
  assert.equal(report.totals.currentReviewed,12);
  assert.equal(report.totals.distinctSourceHosts,2);
  assert.equal(report.totals.reviewedHostSharePercent,100);
  assert.ok(report.risks.includes('reviewed_labels_concentrated_in_one_host'));
  assert.ok(report.risks.includes('fewer_than_20_current_labels'));
  assert.equal(report.queue.length,8);
  assert.ok(report.queue.every(x=>x.host==='beta.example'));
  assert.ok(report.queue.some(x=>x.predicted==='negative'));
  assert.equal(report.productionChanged,false);
  assert.equal(db.list('discovery_quality_labels').length,12);
 }finally{db.close();}
});
test('coverage ignores stale and uncertain labels, prioritizes missing negative reviews',()=>{
 const db=openDatabase();try{
  const a=seed(db,{id:'valid',positive:true,reviewed:true});
  const b=seed(db,{id:'stale',positive:false,reviewed:true});
  seed(db,{id:'negative-unreviewed',positive:false});
  const l=db.get('sources',b.id);
  db.put('sources',{...l,description:'Content revised by original author'},l.revision);
  const u=seed(db,{id:'uncertain',positive:false});
  db.put('discovery_quality_labels',{id:u.id,label:'uncertain',sourceRevision:u.revision});
  const report=discoveryReviewCoverage(db,{limit:3});
  assert.equal(report.totals.currentReviewed,1);
  assert.equal(report.totals.staleLabels,1);
  assert.equal(report.totals.uncertain,1);
  assert.ok(report.risks.includes('negative_predictions_never_reviewed'));
  assert.equal(report.queue.length,3);
  assert.ok(report.queue.some(x=>x.reason==='stale_label'));
  assert.ok(report.queue.some(x=>x.reason==='uncertain_label'));
  assert.throws(()=>discoveryReviewCoverage(db,{limit:41}),{code:'BAD_LIMIT'});
 }finally{db.close();}
});
test('sanitized watch heartbeat excludes labels, tokens, reasons and private URLs',()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'private',title:'Private discussion',url:'https://secret.example/private'});
  db.put('discovery_rule_decisions',{id:'real_problem_production_release',
   policyId:null,percentage:0,history:[{action:'rollback',policyId:'require_workaround',
    reason:'人工确认的已暴露规则退化，自动恢复基线并保留对应证据',at:'2026-10-14T10:00:00Z'}]});
  db.event('discovery.production_guard.alert','real_problem_production_release','system',{
   code:'REVIEWED_REGRESSION',releaseRevision:4});
  const h=productionHeartbeat(db);
  assert.equal(h.application,'opportunity-radar');
  assert.equal(h.active,false);
  assert.equal(h.lastTransition,'rollback');
  assert.equal(h.lastGuardAlert.code,'REVIEWED_REGRESSION');
  assert.equal(h.ownerDataIncluded,false);
  for(const blocked of ['Private discussion','secret.example','人工确认的已暴露规则退化','RADAR_OWNER_TOKEN'])
   assert.equal(JSON.stringify(h).includes(blocked),false);
 }finally{db.close();}
});
