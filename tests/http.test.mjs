import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'radar-http-test-'));
// Close the module-level SQLite handle first: Windows cannot delete open database files.
after(()=>{closeDatabase();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
process.env.RADAR_DB=join(directory,'test.sqlite');
process.env.RADAR_AGENT_TOKEN='test-agent-token';
process.env.RADAR_OWNER_TOKEN='test-owner-token';
const {createServer,closeDatabase}=await import('../src/server.mjs');
test('HTTP contract enforces role separation and end-to-end workflow',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'},agent={'Content-Type':'application/json','Authorization':'Bearer test-agent-token'};
 const call=async(path,method='GET',body,headers=owner)=>{const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await call('/api/dashboard','GET',undefined,{})).status,401);
  assert.equal((await call('/api/agent/tools','GET',undefined,owner)).status,401);
  let toolListing=await call('/api/agent/tools','GET',undefined,agent);assert.equal(toolListing.data.tools.length,12);
  let opp=await call('/api/opportunities','POST',{title:'Household photo frustration',problem:'manual cleanup for consumers',market:'China',sources:[{url:'https://example.com/discussion'}]});assert.equal(opp.status,201);const oid=opp.data.item.id;
  let start=await call('/api/experiments','POST',{opportunityId:oid,goal:'validate real need',hypothesis:'consumers want sorting',criteria:['prototype processes user-selected photos'],stopCondition:'stop after 10 hours'});assert.equal(start.status,201);const pid=start.data.project.id;
  const p=(await call('/api/projects/'+pid)).data;assert.equal(p.milestones.length,3);assert.equal(p.baselines[0].revision,1);
  const setup=await call('/api/agent/setup?project_id='+pid);assert.equal(setup.status,200);assert.equal(setup.data.projectId,pid);assert.equal(setup.data.toolCount,12);assert.equal(setup.data.auth.secretExposed,false);assert.ok(!JSON.stringify(setup.data).includes('test-agent-token'));
  const setupForbidden=await call('/api/agent/setup?project_id='+pid,'GET',undefined,agent);assert.equal(setupForbidden.status,401);
  const context=await call('/api/agent/tools/project.get_context','POST',{project_id:pid},agent);assert.equal(context.status,200);assert.equal(context.data.result.baseline.goal,'validate real need');assert.equal(context.data.result.project.ledger,undefined);
  const task=await call('/api/agent/tools/task.upsert','POST',{project_id:pid,milestone_id:p.milestones[1].id,title:'Implement usable prototype',idempotency_key:'int-task-1'},agent);assert.equal(task.status,200);
  const claim=await call('/api/agent/tools/task.claim','POST',{project_id:pid,task_id:task.data.result.id,idempotency_key:'int-claim-1'},agent);assert.equal(claim.status,200);
  const report=await call('/api/agent/tools/progress.report','POST',{project_id:pid,summary:'Working on prototype',idempotency_key:'int-report-1'},agent);assert.equal(report.status,200);
  const githubEvidence=await call('/api/agent/tools/evidence.attach','POST',{project_id:pid,milestone_id:p.milestones[1].id,type:'github_pr',source_uri:'https://github.com/a/b/pull/1',commit_sha:'a'.repeat(40),criteria_ids:p.baselines[0].criteria.map(c=>c.id),idempotency_key:'http-gh-evidence'},agent);
  assert.equal(githubEvidence.status,200);
  const bypass=await call('/api/projects/'+pid+'/evidence/'+githubEvidence.data.result.id+'/attest','POST',{reason:'Manually approved without GitHub CI'});
  assert.equal(bypass.status,409);assert.equal(bypass.data.error,'GITHUB_AUTOMATED_CHECK_REQUIRED');
  const decision=await call('/api/agent/tools/decision.request','POST',{project_id:pid,kind:'scope_change',summary:'Need a larger scope',idempotency_key:'int-request-1'},agent);assert.equal(decision.data.result.status,'pending');
  assert.equal((await call('/api/projects/'+pid)).data.baselines.length,1);
  const pause=await call('/api/projects/'+pid+'/decide','POST',{action:'pause',reason:'budget check'});assert.equal(pause.status,200);
  const blocked=await call('/api/agent/tools/task.upsert','POST',{project_id:pid,milestone_id:p.milestones[1].id,title:'Should fail',idempotency_key:'paused-task'},agent);assert.equal(blocked.status,409);
  const home=await fetch(base+'/');assert.equal(home.status,200);assert.ok((await home.text()).includes('northstar')===false); // title is Northstar; UI mount root is static
  const staticJs=await fetch(base+'/app.js');assert.equal(staticJs.status,200);assert.ok((await staticJs.text()).includes('机会简报'));
  const i18nJs=await fetch(base+'/i18n.js');assert.equal(i18nJs.status,200);assert.ok((await i18nJs.text()).includes('LANGUAGES'));
 }finally{await new Promise(r=>server.close(r));}
});

test('source management and evidence-linked opportunity discovery through HTTP',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const headers={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const req=async(path,method='GET',payload,auth=headers)=>{
  const r=await fetch(base+path,{method,headers:auth,body:payload?JSON.stringify(payload):undefined});
  return {status:r.status,data:await r.json()};
 };
 try{
  assert.equal((await req('/api/sources')).status,200);
  assert.equal((await req('/api/sources','POST',{url:'https://feed.example.org/rss'},{})).status,401);
  const created=await req('/api/sources','POST',{url:'https://feed.example.org/rss',title:'Customer feed',market:'Global',keywords:'family,photos'});
  assert.equal(created.status,201);const feed=created.data.item;assert.equal(feed.keywords.length,2);
  assert.equal((await req('/api/sources','POST',{url:'https://feed.example.org/rss'})).status,409);
  assert.equal((await req('/api/sources/'+feed.id,'PATCH',{enabled:false,expected_revision:0})).status,409);
  const updated=await req('/api/sources/'+feed.id,'PATCH',{enabled:false,expected_revision:feed.revision});assert.equal(updated.status,200);
  const {openDatabase}=await import('../src/db.mjs');const store=openDatabase(join(directory,'test.sqlite'));
  const id='example-article-1';store.put('sources',{id,title:'Families keep losing their warranty details',description:'Warranty papers are easy to misplace',url:'https://consumer.example.org/thread/1',feed:feed.url,feedIds:[feed.id],market:'Global',createdAt:'2026-10-10T08:00:00Z',status:'new',linkedOpportunityId:null});store.close();
  const signals=await req('/api/signals?status=new');assert.equal(signals.status,200);assert.equal(signals.data.items.some(i=>i.id===id),true);
  const signal=signals.data.items.find(i=>i.id===id);
  const saved=await req('/api/signals/'+id+'/triage','POST',{status:'saved',expected_revision:signal.revision});assert.equal(saved.status,200);
  const imported=await req('/api/signals/'+id+'/import','POST',{title:'Warranty document reminders',problem:'Cannot locate warranty proof on time',market:'Global'});
  assert.equal(imported.status,201);assert.equal(imported.data.item.sources[0].url,'https://consumer.example.org/thread/1');assert.equal(imported.data.item.sources[0].independent,false);
  assert.equal((await req('/api/signals/'+id+'/import','POST',{})).status,409);
  const status=await req('/api/opportunities/'+imported.data.item.id+'/status','POST',{status:'watching',expected_revision:imported.data.item.revision});assert.equal(status.status,200);
  const converted=await req('/api/signals?status=converted');assert.equal(converted.data.items.some(i=>i.id===id),true);
  const second='example-article-2';const sourceDb=openDatabase(join(directory,'test.sqlite'));sourceDb.put('sources',{id:second,title:'Another user reports warranty frustration',description:'Lost purchase receipt',url:'https://consumer.example.org/thread/2',feed:feed.url,feedIds:[feed.id],market:'Global',status:'new',createdAt:new Date().toISOString()});sourceDb.close();
  const linked=await req('/api/signals/'+second+'/link','POST',{opportunity_id:imported.data.item.id});assert.equal(linked.status,200);assert.equal(linked.data.item.sources.length,2);
  assert.equal((await req('/api/signals/'+second+'/link','POST',{opportunity_id:imported.data.item.id})).status,409);
  assert.equal((await req('/api/signals?status=converted&q=warranty')).status,200);
 }finally{await new Promise(r=>server.close(r));}
});


test('source scheduling preferences and health are served by real HTTP routes',async()=>{
 const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base=`http://127.0.0.1:${server.address().port}`;
 const headers={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const request=async(path,method='GET',data)=>{const response=await fetch(base+path,{method,headers,body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};};
 try{
   const created=await request('/api/sources','POST',{url:'https://public.example.org/rss',intervalMinutes:45,title:'Customer reports'});
   assert.equal(created.status,201);assert.equal(created.data.item.intervalMinutes,45);
   const sources=await request('/api/sources');assert.ok(sources.data.health);assert.ok(sources.data.health.due>=1);
   const item=created.data.item;
   const edited=await request('/api/sources/'+item.id,'PATCH',{expected_revision:item.revision,intervalMinutes:15,enabled:false});
   assert.equal(edited.status,200);assert.equal(edited.data.item.enabled,false);
   assert.equal(edited.data.item.intervalMinutes,15);
   const health=await request('/api/health');assert.ok(health.data.sourceHealth);
   assert.equal((await request('/api/sources','GET',null)).data.items.some(f=>f.id===item.id),true);
 }finally{await new Promise(done=>server.close(done));}
});


test('owner source catalog and opportunity research HTTP endpoints respect permissions',async()=>{
 const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const request=async(path,method='GET',data,headers=owner)=>{
  const r=await fetch(base+path,{method,headers,body:data?JSON.stringify(data):undefined});
  return {status:r.status,data:await r.json()};
 };
 try{
  assert.equal((await request('/api/source-catalog','GET',null,{})).status,401);
  assert.equal((await request('/api/source-quality','GET',undefined,{})).status,401);
  const emptyQuality=await request('/api/source-quality');assert.equal(emptyQuality.status,200);
  assert.equal(typeof emptyQuality.data.overview.uniqueSignals,'number');
  assert.ok(emptyQuality.data.overview.uniqueSignals>=0);
  assert.equal(typeof emptyQuality.data.overview.sourcesWithOwnerReviewedFirsthand,'number');
    const catalog=await request('/api/source-catalog');assert.equal(catalog.status,200);
  assert.ok(catalog.data.items.some(x=>x.id==='v2ex-qna'));
  const install=await request('/api/source-catalog/install','POST',{id:'ask-hn'});
  assert.equal(install.status,200);assert.equal(install.data.item.catalogId,'ask-hn');
  const opp=await request('/api/opportunities','POST',{title:'Receipts',problem:'I lose warranties',market:'International',
   sources:[{url:'https://consumer.example.org/post/8',quote:'I lost warranty paper'}]});
  assert.equal(opp.status,201);const id=opp.data.item.id;
  const before=await request('/api/opportunities/'+id+'/research');
  assert.equal(before.status,200);assert.equal(before.data.report.stage,'unverified');
  const review={source_url:'https://consumer.example.org/post/8',expected_revision:opp.data.item.revision,
   reviewed_original:true,firsthand:true,independent:true,
   note:'I read the original post and confirmed it is a firsthand account from the poster.'};
  assert.equal((await request('/api/opportunities/'+id+'/evidence/review','POST',review,{})).status,401);
  const saved=await request('/api/opportunities/'+id+'/evidence/review','POST',review);
  assert.equal(saved.status,200);
  assert.equal((await request('/api/opportunities/'+id+'/research')).data.report.stage,'single_observation');
 }finally{await new Promise(done=>server.close(done));}
});


test('Owner API links a real opportunity to a pre-build validation plan and evidence-backed decision',async()=>{
 const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const req=async(path,method='GET',data,headers=owner)=>{
  const response=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,data:await response.json()};
 };
 try{
  const o=await req('/api/opportunities','POST',{title:'Receipt field test',problem:'Families lose purchase receipts',market:'International'});
  assert.equal(o.status,201);const id=o.data.item.id;
  assert.equal((await req('/api/validations/overview','GET',undefined,{})).status,401);
  assert.equal((await req('/api/opportunities/'+id+'/validation','GET',undefined,{})).status,401);
  assert.equal((await req('/api/opportunities/'+id+'/validation','POST',{},{})).status,401);
  const input={
   audience:'Adults who retain paper receipts',
   hypothesis:'Receipt retrieval fails repeatedly for some family purchases.',
   researchQuestion:'Describe the last occasion when retrieving a receipt failed?',
   channel:'Opt-in volunteers from user community',
   successCriterion:'Two distinct users describe recent failures with concrete detail',
   stopCondition:'Stop after six hours if no participant reports a failure',
   nextAction:'Invite three anonymous participants for a brief conversation',
   timeBudgetHours:6,cashBudget:0
  };
  const start=await req('/api/opportunities/'+id+'/validation','POST',input);
  assert.equal(start.status,201);const pid=start.data.item.id;
  const overview=await req('/api/validations/overview');
  assert.ok(overview.data.items.some(x=>x.opportunityId===id&&x.status==='active'));
  assert.equal((await req('/api/opportunities/'+id+'/validation','POST',input)).status,409);
  const entry={participantRef:'guest-01',kind:'interview',stance:'contradicts',
   note:'A testing-only record with a clear counterexample, not a genuine participant.',consentConfirmed:true};
  assert.equal((await req('/api/opportunities/'+id+'/validation/'+pid+'/observations','POST',{...entry,consentConfirmed:false})).status,409);
  const observation=await req('/api/opportunities/'+id+'/validation/'+pid+'/observations','POST',entry);
  assert.equal(observation.status,201);
  const summary=await req('/api/opportunities/'+id+'/validation');
  assert.equal(summary.data.result.counts.contradicts,1);
  assert.equal(summary.data.result.independentlyVerifiedCount,0);
  const close=await req('/api/opportunities/'+id+'/validation/'+pid+'/close','POST',{
   outcome:'inconclusive',reason:'The only observed result does not demonstrate repeated frustration.',
   expected_revision:start.data.item.revision
  });
  assert.equal(close.status,200);assert.equal(close.data.item.status,'closed');
  assert.equal((await req('/api/opportunities/'+id+'/validation/'+pid+'/observations','POST',entry)).status,409);
 }finally{await new Promise(done=>server.close(done));}
});


test('research handoff and post-delivery feedback APIs enforce Owner auth and G4 acceptance',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const unauth={'Content-Type':'application/json'};
 const request=async(path,method='GET',body,headers=owner)=>{
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 };
 try{
  const o=await request('/api/opportunities','POST',{title:'Post-launch tracking',problem:'A specific recurring consumer frustration',market:'International'});
  assert.equal(o.status,201);const oid=o.data.item.id;
  assert.equal((await request('/api/experiments','POST',{
    opportunityId:oid,validationPlanId:'not-ours',goal:'Investigate one MVP',hypothesis:'Consumer may need this',
    criteria:['User can finish the main use case'],stopCondition:'Stop after 10 hours'
  })).status,409);
  const p=await request('/api/experiments','POST',{opportunityId:oid,goal:'Investigate one MVP',
    hypothesis:'Consumer may need this',criteria:['User can finish the main use case'],stopCondition:'Stop after 10 hours'});
  assert.equal(p.status,201);const id=p.data.project.id;
  assert.equal(p.data.project.researchBasis.status,'unlinked');
  assert.equal((await request('/api/projects/'+id+'/kickoff','POST',{},unauth)).status,401);
  const kickoff=await request('/api/projects/'+id+'/kickoff','POST',{});
  assert.equal(kickoff.status,200);
  assert.equal(kickoff.data.task.status,'open');
  assert.equal((await request('/api/projects/'+id+'/kickoff','POST',{})).data.alreadyPrepared,true);
  assert.equal((await request('/api/projects/'+id+'/feedback','GET',undefined,unauth)).status,401);
  assert.equal((await request('/api/projects/'+id+'/feedback','POST',{},unauth)).status,401);
  const pending=await request('/api/projects/'+id+'/feedback');
  assert.equal(pending.data.result.productMilestoneAccepted,false);
  const reject=await request('/api/projects/'+id+'/feedback','POST',{participantRef:'person-1',
    kind:'activation',summary:'A hypothetical event which is not yet accepted.',consentConfirmed:true});
  assert.equal(reject.status,409);assert.equal(reject.data.error,'PRODUCT_NOT_ACCEPTED');
 }finally{await new Promise(done=>server.close(done));}
});


test('discovery API is Owner-only and bulk association preserves unverified provenance',async()=>{
 const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const agent={'Content-Type':'application/json',Authorization:'Bearer test-agent-token'};
 const req=async(path,method='GET',data,headers=owner)=>{
  const response=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,data:await response.json()};
 };
 try{
  assert.equal((await req('/api/discovery/clusters','GET',undefined,{})).status,401);
  assert.equal((await req('/api/discovery/clusters','GET',undefined,agent)).status,401);
  const o=await req('/api/opportunities','POST',{title:'Digital purchase receipts',problem:'Customers may struggle to retrieve receipts',market:'International'});
  assert.equal(o.status,201);const oid=o.data.item.id;
  for(const [id,domain] of [['alpha','issues.example'],['beta','forum.example']]){
   const x=await req('/api/signals/manual','POST',{title:'Online shopping receipt storage is difficult',
    description:'[DEMO] Repeated test-only phrase; this is NOT real consumer research',
    url:'https://'+domain+'/test/'+id,market:'International'});
   assert.equal(x.status,201);
  }
  const first=await req('/api/discovery/clusters');assert.equal(first.status,200);
  const cluster=first.data.items.find(x=>x.representativeTitle==='Online shopping receipt storage is difficult');
  assert.ok(cluster);assert.equal(cluster.signalCount,2);
  assert.equal((await req('/api/discovery/clusters/'+cluster.id+'/link','POST',{
   fingerprint:cluster.fingerprint,opportunity_id:oid,acknowledgeUnverified:true},agent)).status,401);
  const denial=await req('/api/discovery/clusters/'+cluster.id+'/link','POST',{
    fingerprint:cluster.fingerprint,opportunity_id:oid,acknowledgeUnverified:false});
  assert.equal(denial.status,409);
  const linked=await req('/api/discovery/clusters/'+cluster.id+'/link','POST',{
    fingerprint:cluster.fingerprint,opportunity_id:oid,acknowledgeUnverified:true});
  assert.equal(linked.status,200);assert.equal(linked.data.addedEvidence,2);
  assert.ok(linked.data.opportunity.sources.every(x=>x.independent===false&&x.firsthand===false));
  assert.equal((await req('/api/discovery/clusters')).data.total,0);
  const repeat=await req('/api/discovery/clusters/'+cluster.id+'/link','POST',{
    fingerprint:cluster.fingerprint,opportunity_id:oid,acknowledgeUnverified:true});
  assert.equal(repeat.status,404);
 }finally{await new Promise(done=>server.close(done));}
});


test('discovery quality counts Owner classifications without granting Agent visibility or certifying market demand',async()=>{
 const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const url='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const agent={'Content-Type':'application/json',Authorization:'Bearer test-agent-token'};
 const request=async(route,method='GET',value,headers=owner)=>{
  const response=await fetch(url+route,{method,headers,body:value===undefined?undefined:JSON.stringify(value)});
  return {status:response.status,body:await response.json()};
 };
 try{
  assert.equal((await request('/api/discovery/quality','GET',undefined,{})).status,401);
  assert.equal((await request('/api/discovery/quality','GET',undefined,agent)).status,401);
  const first=await request('/api/signals/manual','POST',{
   title:'How to store personal receipts from grocery shopping',
   description:'[DEMO] This is entirely hypothetical and not consumer evidence.',
   url:'https://retail-q.example/testing/quality-a',market:'International'});
  const second=await request('/api/signals/manual','POST',{
   title:'How to store personal receipts from grocery shopping',
   description:'[DEMO] This is entirely hypothetical and not consumer evidence.',
   url:'https://retail-r.example/testing/quality-b',market:'International'});
  assert.equal(first.status,201);assert.equal(second.status,201);
  const discovered=await request('/api/discovery/clusters');
  const g=discovered.body.items.find(x=>x.signals.some(s=>s.id===first.body.item.id));
  assert.ok(g);assert.equal(g.diagnostics.possibleRepost,true);
  const review=await request('/api/discovery/clusters/'+g.id+'/review','POST',{
   action:'confirm',fingerprint:g.fingerprint,expected_revision:g.reviewRevision,
   reason:'This is only test data; the same general problem appears in the two synthetic titles.'});
  assert.equal(review.status,200);
  assert.equal(review.body.item.status,'reviewed_related');
  const overview=await request('/api/discovery/quality');
  assert.equal(overview.status,200);
  assert.ok(overview.body.ownerMarkedRelated>=1);
  assert.equal(overview.body.ownerLabelAgreementRatio,null);
  assert.ok(overview.body.caveats.some(x=>x.includes('not independent consumer')));
  const invalid=await request('/api/discovery/clusters/'+g.id+'/review','POST',{
   action:'dismiss',fingerprint:g.fingerprint,classification:'approved_customer_demand',
   reason:'Not a valid issue review category in this dataset'});
  assert.equal(invalid.status,400);
  assert.equal(invalid.body.error,'BAD_REVIEW_CLASS');
 }finally{await new Promise(done=>server.close(done));}
});


test('first-run readiness is Owner-only, meaningful with empty data, and does not leak research notes',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const deny=await fetch(base+'/api/operations/readiness');
  assert.equal(deny.status,401);
  const denyAgent=await fetch(base+'/api/operations/readiness',{headers:{Authorization:'Bearer test-agent-token'}});
  assert.equal(denyAgent.status,401);
  const ready=await fetch(base+'/api/operations/readiness',{headers:{'X-Radar-Owner-Key':'test-owner-token'}});
  assert.equal(ready.status,200);
  const report=await ready.json();
  assert.equal(report.mode,'local-first');
  assert.equal(report.ownerProtected,true);
  assert.ok(report.checks.some(c=>c.id==='source_setup'));
  assert.ok(report.checks.some(c=>c.id==='source_connectivity'));
  assert.ok(report.checks.some(c=>c.id==='backup'&&c.ok===null));
  assert.ok(Number.isInteger(report.counts.enabledFeeds));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_FAKE_INTERVIEW_CONTENT'));
  assert.ok(report.warnings.some(x=>x.includes('not proof')));
 }finally{await new Promise(resolve=>server.close(resolve));}
});
