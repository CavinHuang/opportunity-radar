import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {discoveryClusters,discoveryQualityReport,groupDiagnostics,reviewDiscoveryCluster,titleSimilarity} from '../src/discovery.mjs';
const put=(store,id,title,{site='forum.example',author=null,description='',status='new'}={})=>store.put('sources',{
 id,title,author,description,url:'https://'+site+'/thread/'+id,status,
 market:'International',createdAt:'2026-10-10T10:00:00Z',feedIds:[]});
const setup=()=>{const store=openDatabase(),service=createService(store);return {store,service,close:()=>store.close()}};

test('group diagnostics explain actual lexical matches and flag possible syndication without claiming it is proven',()=>{
 const a={title:'How to organize purchase receipts for online orders?',description:'A very long detailed personal description of the pain point and why receipt retrieval is slow.',author:'Mia',url:'https://one.example/p/1'};
 const b={...a,url:'https://two.example/p/2'};
 const d=groupDiagnostics([a,b]);
 assert.equal(d.possibleRepost,true);
 assert.ok(d.possibleRepostReasons.includes('identical_titles'));
 assert.ok(d.possibleRepostReasons.includes('identical_summaries'));
 assert.ok(d.sharedTerms.includes('receipt'));
 assert.equal(d.siteCount,2);
 assert.equal(d.minimumTitleSimilarity,1);
 assert.match(d.warning,/不能据此确定/);
 const c={title:'How to organize purchase receipts for online orders?',url:'https://one.example/p/3',author:'Mia',description:'An unrelated description of a personal experience.'};
 const sameAuthor=groupDiagnostics([a,c]);
 assert.ok(sameAuthor.possibleRepostReasons.includes('repeated_attributed_author'));
 assert.equal(groupDiagnostics([{...a,title:'Need help organizing receipts from orders'},{...b,author:'An independent pen name',description:'A completely different summary describing a personal workflow and how the search changed.',title:'Organizing purchase receipts after ordering online'}]).possibleRepost,false);
});
test('human related label is versioned, remains unverified, and new article invalidates previous label',()=>{
 const {store,close}=setup();try{
  put(store,'first','Cannot find original receipts from online orders',{site:'q.example'});
  put(store,'second','Cannot find original receipts from online orders',{site:'a.example'});
  const group=discoveryClusters(store).items[0];
  assert.equal(group.state,'needs_review');
  assert.throws(()=>reviewDiscoveryCluster(store,group.id,{action:'confirm',fingerprint:group.fingerprint,reason:'too short'}),{code:'REVIEW_REASON_REQUIRED'});
  const row=reviewDiscoveryCluster(store,group.id,{action:'confirm',fingerprint:group.fingerprint,
   reason:'Manually read both posts; similar user problem but identities still unknown.',expected_revision:0});
  assert.equal(row.status,'reviewed_related');
  const marked=discoveryClusters(store).items[0];
  assert.equal(marked.state,'reviewed_related');
  assert.equal(marked.reviewClass,'same_problem_unverified');
  assert.equal(discoveryQualityReport(store).ownerMarkedRelated,1);
  assert.equal(discoveryQualityReport(store).ownerLabelAgreementRatio,null); // too few labeled groups
  assert.throws(()=>reviewDiscoveryCluster(store,group.id,{action:'confirm',fingerprint:group.fingerprint,
   reason:'Review tried to update a stale version after another decision.',expected_revision:0}),{code:'REVISION_CONFLICT'});
  put(store,'third','Cannot find original receipts from online orders',{site:'b.example'});
  const newest=discoveryClusters(store).items[0];
  assert.equal(newest.state,'needs_review');
  assert.notEqual(newest.fingerprint,group.fingerprint);
  assert.equal(discoveryQualityReport(store).currentLabeledGroups,0);
 }finally{close();}
});
test('typed false-positive labels are counted only for current candidate memberships',()=>{
 const {store,close}=setup();try{
  put(store,'copy1','Missing household receipts during returns',{site:'one.example'});
  put(store,'copy2','Missing household receipts during returns',{site:'two.example'});
  const g=discoveryClusters(store).items[0];
  assert.throws(()=>reviewDiscoveryCluster(store,g.id,{action:'dismiss',fingerprint:g.fingerprint,
   classification:'invented_reason',reason:'I have reviewed these as false positives.'}),{code:'BAD_REVIEW_CLASS'});
  reviewDiscoveryCluster(store,g.id,{action:'dismiss',fingerprint:g.fingerprint,
   classification:'possible_repost',reason:'Identical newswire text syndicated across different sites.'});
  let report=discoveryQualityReport(store);
  assert.equal(report.ownerDismissed,1);
  assert.equal(report.classificationCounts.possible_repost,1);
  assert.equal(report.currentLabeledGroups,1);
  assert.equal(report.labelCoverage,1);
  assert.equal(report.ownerLabelAgreementRatio,null);
  // Once the membership changes, old labels are retained but excluded from current-window stats.
  put(store,'copy3','Missing household receipts during returns',{site:'three.example'});
  report=discoveryQualityReport(store);
  assert.equal(report.ownerDismissed,0);
  assert.equal(report.unlabeledGroups,1);
  assert.equal(report.possibleReposts,1);
 }finally{close();}
});
test('manual confirmation never creates opportunities, assigns consumer identity or approves demand',()=>{
 const {store,service,close}=setup();try{
  put(store,'one','How do I recover lost household receipts?',{site:'one.example'});
  put(store,'two','How do I recover lost household receipts?',{site:'two.example'});
  const g=discoveryClusters(store).items[0];
  reviewDiscoveryCluster(store,g.id,{action:'confirm',fingerprint:g.fingerprint,
   reason:'Potential related problem; no confirmation of people or willingness to pay.'});
  assert.equal(store.list('opportunities').length,0);
  assert.equal(store.get('sources','one').status,'new');
  const opportunity=service.createOpportunity({title:'Lost receipts',problem:'Some people struggle to recover receipts',market:'Global'});
  const linked=service.linkDiscoveryCluster(g.id,{fingerprint:g.fingerprint,opportunity_id:opportunity.id,acknowledgeUnverified:true});
  assert.equal(linked.evidenceVerified,false);
  assert.ok(linked.opportunity.sources.every(x=>x.firsthand===false&&x.independent===false));
 }finally{close();}
});
test('offline exploratory pair tests distinguish rewordings, unrelated posts and CJK titles (not real measured precision)',()=>{
 const pairs=[
  ['Cannot find receipts for my online orders','Where can I find receipts for my online orders',true],
  ['How to backup family phone photos automatically','Can I backup family phone photos automatically',true],
  ['无法找到之前购买商品的发票记录','无法找到之前购买商品的发票记录',true],
  ['How to backup family phone photos automatically','Fastest city bikes for grocery shopping',false],
  ['Where to archive purchase receipts for refunds','Best backpacks for traveling abroad',false],
  ['如何整理家人的手机照片备份','更换汽车轮胎后如何检查胎压',false]
 ];
 const predictions=pairs.map(([a,b])=>titleSimilarity(a,b)>=.58);
 const correct=predictions.filter((x,i)=>x===pairs[i][2]).length;
 assert.equal(correct,pairs.length,'Keep this tiny fixture honest; it is not a production precision estimate');
});

test('editing attributed text invalidates older human classification even when member IDs are unchanged',()=>{
 const {store,close}=setup();try{
  put(store,'ref-a','Saving receipts from online grocery purchases',{author:'alice',site:'a.example'});
  put(store,'ref-b','Saving receipts from online grocery purchases',{author:'bob',site:'b.example'});
  const first=discoveryClusters(store).items[0];
  reviewDiscoveryCluster(store,first.id,{action:'dismiss',fingerprint:first.fingerprint,
   classification:'possible_repost',reason:'These two posts appear to quote one copied news announcement.'});
  const b=store.get('sources','ref-b');
  store.put('sources',{...b,author:'a revised attributed author',description:'New original observations have been added and still need review.'},b.revision);
  const updated=discoveryClusters(store).items[0];
  assert.equal(updated.id,first.id);
  assert.notEqual(updated.fingerprint,first.fingerprint);
  assert.equal(updated.state,'needs_review');
  assert.throws(()=>reviewDiscoveryCluster(store,updated.id,{action:'restore',fingerprint:first.fingerprint}),{code:'CLUSTER_CHANGED'});
 }finally{close();}
});
