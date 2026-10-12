import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'radar-review-http-'));
process.env.RADAR_DB=join(directory,'test.sqlite');
process.env.RADAR_AGENT_TOKEN='test-agent-token';
process.env.RADAR_OWNER_TOKEN='test-owner-token';
const {createServer,closeStore}=await import('../src/server.mjs');
// Close the module-level SQLite handle before deleting the temp directory;
// Windows refuses to unlink files that are still open.
after(()=>{try{closeStore();}finally{try{rmSync(directory,{recursive:true,force:true});}catch{/* best effort */}}});

test('review routes are owner-only and state changes require explicit confirmation over HTTP',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'test-owner-token'};
 const call=async(path,method='GET',payload,headers=owner)=>{const r=await fetch(base+path,{method,headers,body:payload?JSON.stringify(payload):undefined});return {status:r.status,data:await r.json()};};
 try{
  // owner token required for draft, list, create and decide
  for(const path of ['/api/projects/x/reviews','/api/projects/x/reviews/draft']){
   assert.equal((await call(path,'GET',undefined,{})).status,401);
  }

  // minimal approved experiment
  const opp=await call('/api/opportunities','POST',{title:'Review flow check',problem:'no periodic retrospective',market:'China'});
  assert.equal(opp.status,201);
  const start=await call('/api/experiments','POST',{opportunityId:opp.data.item.id,goal:'validate need',hypothesis:'people want it',criteria:['works'],stopCondition:'stop when no trial in two weeks',hours:2,cash:0});
  assert.equal(start.status,201);
  const pid=start.data.project.id;

  // draft aggregates before anything is recorded: unknown stays unknown
  const draft=await call(`/api/projects/${pid}/reviews/draft`);
  assert.equal(draft.status,200);
  assert.equal(draft.data.decision.status,'delivery_unverified');
  assert.equal(draft.data.decision.outcomes.visits,null);
  assert.equal(draft.data.originalBaseline.revision,1);
  assert.ok(draft.data.flaggedIssues.some(i=>i.kind==='stop_condition_unassessed'));
  assert.deepEqual(draft.data.recommendationOptions.map(o=>o.choice),['continue','adjust','pause','stop']);
  const badDraft=await call(`/api/projects/${pid}/reviews/draft?from=2026-10-10&to=2026-09-01`);
  assert.equal(badDraft.status,400);

  // project pipeline exposes the periodic due hint
  const project=await call(`/api/projects/${pid}`);
  assert.equal(project.data.pipeline.reviewDue,true);
  assert.equal(project.data.reviewSummary.count,0);

  // creation validates server-side
  const badCreate=await call(`/api/projects/${pid}/reviews`,'POST',{overallAssessment:'太短'});
  assert.equal(badCreate.status,400);
  const badFindings=await call(`/api/projects/${pid}/reviews`,'POST',{overallAssessment:'结论足够长，可以用来复盘判断',findings:[{kind:'rumor',note:'无效的发现类型应当被拒绝'}]});
  assert.equal(badFindings.status,400);
  const review=await call(`/api/projects/${pid}/reviews`,'POST',{
   windowFrom:'2026-09-01',windowTo:'2026-09-30',
   findings:[{kind:'observation',note:'两位参与者完成了核心整理任务',ref:'P1'},{kind:'uncertainty',note:'样本太小，无法区分好奇与真实需求'}],
   stopConditionAssessment:'not_met',stopConditionNote:'两周内仍获得 1 次真实试用',
   overallAssessment:'对照最初假设：需求观察成立但付费意愿未证实，先继续小规模验证'});
  assert.equal(review.status,201);
  const reviewId=review.data.item.id;
  assert.equal(review.data.item.reviewedBaselineRevision,1);
  assert.equal(review.data.item.findings.length,2);
  const after=await call(`/api/projects/${pid}`);
  assert.equal(after.data.pipeline.reviewDue,false);
  assert.equal(after.data.reviewSummary.count,1);

  // decisions refuse to bypass confirmation, blockers and duplicate decisions
  const noConfirm=await call(`/api/projects/${pid}/reviews/${reviewId}/decide`,'POST',{choice:'pause',reason:'没有勾选确认就尝试暂停项目并留档'});
  assert.equal(noConfirm.status,409);assert.equal(noConfirm.data.error,'CONFIRMATION_REQUIRED');
  const blockedContinue=await call(`/api/projects/${pid}/reviews/${reviewId}/decide`,'POST',{choice:'continue',reason:'证据缺失时直接宣布继续应当被拦截',confirm:true});
  assert.equal(blockedContinue.status,409);assert.equal(blockedContinue.data.error,'OPEN_RISKS_ACK_REQUIRED');
  assert.equal((await call(`/api/projects/${pid}`)).data.status,'research');

  // pause requires confirmation and then really pauses
  const pause=await call(`/api/projects/${pid}/reviews/${reviewId}/decide`,'POST',{choice:'pause',reason:'外部进度慢于预期，先暂停并核对状态',wakeCondition:'外部状态核对完成且重新具备推进条件',confirm:true});
  assert.equal(pause.status,200);
  assert.deepEqual(pause.data.item.decision.appliedStateChange,{from:'research',to:'paused'});
  assert.equal(pause.data.item.decision.baselineRevisionAtDecision,1);
  assert.equal((await call(`/api/projects/${pid}`)).data.status,'paused');

  // a decided review cannot be decided twice
  const twice=await call(`/api/projects/${pid}/reviews/${reviewId}/decide`,'POST',{choice:'stop',reason:'同一次复盘不能重复决定两次并留档',confirm:true});
  assert.equal(twice.status,409);assert.equal(twice.data.error,'BAD_STATE');

  // retrospective on the paused project; illegal transitions are rejected
  const second=await call(`/api/projects/${pid}/reviews`,'POST',{overallAssessment:'暂停期间复盘：没有新的真实试用出现',stopConditionAssessment:'met'});
  assert.equal(second.status,201);
  const secondId=second.data.item.id;
  assert.ok(second.data.item.flaggedIssues.some(i=>i.kind==='stop_condition_met'));
  const badPause=await call(`/api/projects/${pid}/reviews/${secondId}/decide`,'POST',{choice:'pause',reason:'暂停中的项目不能再次暂停，应当拒绝',confirm:true});
  assert.equal(badPause.status,409);assert.equal(badPause.data.error,'BAD_STATE');
  const stop=await call(`/api/projects/${pid}/reviews/${secondId}/decide`,'POST',{choice:'stop',reason:'停止条件已触发，停止实验并保留全部记录',confirm:true});
  assert.equal(stop.status,200);
  assert.deepEqual(stop.data.item.decision.appliedStateChange,{from:'paused',to:'stopped'});

  // list preserves every decision with reason, time and baseline version
  const list=await call(`/api/projects/${pid}/reviews`);
  assert.equal(list.status,200);
  assert.equal(list.data.items.length,2);
  const decisions=list.data.items.map(x=>x.decision).filter(Boolean);
  assert.equal(decisions.length,2);
  assert.ok(decisions.every(d=>d.reason&&d.decidedAt&&d.baselineRevisionAtDecision===1));

  // the agent token cannot touch owner review routes (owner authorization applies)
  const agent={'Content-Type':'application/json','Authorization':'Bearer test-agent-token'};
  const agentCreate=await call('/api/projects/'+pid+'/reviews','POST',{overallAssessment:'Agent 不能创建或决定复盘记录'},agent);
  assert.equal(agentCreate.status,401);
 }finally{await new Promise(r=>server.close(r));}
});
