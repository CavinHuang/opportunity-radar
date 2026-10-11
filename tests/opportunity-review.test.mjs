import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {buildReviewDraft,createOpportunityReview,decideOpportunityReview,opportunityReviews,reviewSummary} from '../src/opportunity-review.mjs';
import {projectPipeline} from '../src/project-pipeline.mjs';

function setup(){
 const db=openDatabase();
 const s=createService(db);
 const o=s.createOpportunity({title:'Photo sorting pain',problem:'manual sorting burden',market:'China'});
 const p=s.startExperiment({opportunityId:o.id,goal:'validate the need',hypothesis:'people want it',criteria:['works'],stopCondition:'两周内没有真实试用就停止',hours:2,cash:0});
 return {db,s,p};
}
const kindsOf=r=>r.flaggedIssues.map(i=>i.kind);

test('review draft aggregates unknown data as unknown and never validates the opportunity',()=>{
 const {db,p}=setup();try{
  const draft=buildReviewDraft(db,p.id);
  assert.equal(draft.decision.status,'delivery_unverified');
  assert.equal(draft.decision.outcomes.visits,null);      // Unknown, not zero
  assert.equal(draft.decision.outcomes.trialRate,null);
  assert.equal(draft.decision.budget.weeklyUserHours,2);
  assert.equal(draft.decision.budget.recordedUserHours,null); // no actuals recorded → Unknown
  assert.equal(draft.decision.budget.paceExceeded,null);
  assert.equal(draft.decision.stopCondition.text,'两周内没有真实试用就停止');
  assert.equal(draft.decision.stopCondition.assessment,'unassessed');
  assert.equal(draft.originalBaseline.revision,1);
  assert.equal(draft.currentBaseline.revision,1);
  assert.equal(draft.hypothesisSnapshot!==undefined,false); // draft keeps baselines, snapshot lives on the stored review
  assert.ok(kindsOf(draft).includes('delivery_incomplete'));
  assert.ok(kindsOf(draft).includes('insufficient_validation'));
  assert.ok(kindsOf(draft).includes('stop_condition_unassessed'));
  assert.deepEqual(draft.recommendationOptions.map(o=>o.choice),['continue','adjust','pause','stop']);
  const cont=draft.recommendationOptions.find(o=>o.choice==='continue');
  assert.ok(cont.blockers.includes('insufficient_validation'));
  assert.equal(draft.market.growth.totals.visits,null);
  assert.equal(draft.market.growth.unknownPolicy,'missing_data_is_unknown');
  assert.equal(draft.market.validation.observationCount,0);
  assert.ok(draft.caveats.some(c=>c.includes('不按零')));
 }finally{db.close();}
});

test('window inputs are validated and reach the growth aggregation',()=>{
 const {db,p}=setup();try{
  assert.throws(()=>buildReviewDraft(db,p.id,{windowFrom:'2026-10-10',windowTo:'2026-13-99'}),{code:'BAD_REQUEST'});
  assert.throws(()=>buildReviewDraft(db,p.id,{windowFrom:'2026-10-10',windowTo:'2026-09-01'}),{code:'BAD_REQUEST'});
  const draft=buildReviewDraft(db,p.id,{windowFrom:'2026-09-01',windowTo:'2026-09-30'});
  assert.equal(draft.window.from,'2026-09-01');
  assert.equal(draft.window.to,'2026-09-30');
 }finally{db.close();}
});

test('creating a review snapshots the baseline, owner findings and stop-condition judgment',()=>{
 const {db,p}=setup();try{
  assert.throws(()=>createOpportunityReview(db,p.id,{overallAssessment:'太短'}),{code:'BAD_REQUEST'});
  assert.throws(()=>createOpportunityReview(db,p.id,{overallAssessment:'结论足够长，可以用来复盘判断',findings:[{kind:'gossip',note:'这不是有效的发现类型'}]}),{code:'BAD_REQUEST'});
  assert.throws(()=>createOpportunityReview(db,p.id,{overallAssessment:'结论足够长，可以用来复盘判断',findings:[{kind:'risk',note:'太短'}]}),{code:'BAD_REQUEST'});
  assert.throws(()=>createOpportunityReview(db,p.id,{overallAssessment:'结论足够长，可以用来复盘判断',windowFrom:'2026-10-10',windowTo:'2026-09-01'}),{code:'BAD_REQUEST'});
  assert.throws(()=>createOpportunityReview(db,'missing',{overallAssessment:'结论足够长，可以用来复盘判断'}),{code:'NOT_FOUND'});
  const review=createOpportunityReview(db,p.id,{
   windowFrom:'2026-09-01',windowTo:'2026-09-30',
   findings:[
    {kind:'observation',note:'两位参与者完成了核心整理任务',ref:'P1'},
    {kind:'contradiction',note:'一位参与者表示现有网盘已够用',ref:'P3'},
    {kind:'uncertainty',note:'样本太小，无法区分好奇与真实需求'},
    {kind:'risk',note:'尚无任何人表达付费意愿'}],
   stopConditionAssessment:'not_met',stopConditionNote:'两周内仍获得了 1 次真实试用',
   overallAssessment:'对照最初假设：需求观察成立但付费意愿未证实，继续小规模验证'});
  assert.equal(review.reviewedBaselineRevision,1);
  assert.equal(review.hypothesisSnapshot.originalBaseline.revision,1);
  assert.equal(review.hypothesisSnapshot.originalBaseline.hypothesis,'people want it');
  assert.equal(review.stopConditionAssessment,'not_met');
  assert.equal(review.findings.length,4);
  assert.deepEqual(kindsOf(review).filter(k=>k==='stop_condition_unassessed'),[]); // owner judged, so not flagged
  const cont=review.recommendationOptions.find(o=>o.choice==='continue');
  assert.ok(cont.blockers.includes('insufficient_validation')); // ledger metrics still missing
  const summary=reviewSummary(db,p.id);
  assert.equal(summary.count,1);
  assert.equal(summary.due,false);
  assert.equal(summary.latestDecision,null);
  const events=db.events(0,p.id).filter(e=>e.kind==='opportunity_review.created');
  assert.equal(events.length,1);
  assert.deepEqual(events[0].detail.findingKinds,['observation','contradiction','uncertainty','risk']);
  assert.equal(opportunityReviews(db,p.id).length,1);
 }finally{db.close();}
});

test('stop-condition met and data anomalies are flagged; baseline snapshots survive revision',()=>{
 const {db,s,p}=setup();try{
  const revised=s.ownerDecision(p.id,{action:'revise_baseline',goal:'validate willingness to pay',criteria:['one paid order'],stopCondition:'两个月无付费则停止',reason:'需求观察成立，进入付费验证'});
  assert.equal(revised.baselines.length,2);
  const review=createOpportunityReview(db,p.id,{
   overallAssessment:'对照最初假设与当前基线的差异：目标已从需求验证转向付费验证',
   stopConditionAssessment:'met',
   findings:[{kind:'anomaly',note:'访问数据出现未说明的峰值，需要人工核对来源'}]});
  assert.equal(review.reviewedBaselineRevision,2);
  assert.equal(review.hypothesisSnapshot.originalBaseline.revision,1);
  assert.equal(review.hypothesisSnapshot.currentBaseline.revision,2);
  assert.ok(kindsOf(review).includes('stop_condition_met'));
  const cont=review.recommendationOptions.find(o=>o.choice==='continue');
  assert.ok(cont.blockers.includes('stop_condition_met'));
  assert.throws(()=>decideOpportunityReview(db,p.id,review.id,{choice:'continue',reason:'虽然停止条件触发但我想继续推进实验',confirm:true}),{code:'OPEN_RISKS_ACK_REQUIRED'});
  const decided=decideOpportunityReview(db,p.id,review.id,{choice:'continue',reason:'虽然停止条件触发但我想继续推进实验',confirm:true,acceptOpenRisks:true});
  assert.equal(decided.decision.appliedStateChange,null); // active project: continue changes nothing
  assert.equal(decided.decision.acknowledgedOpenRisks,true);
  assert.equal(decided.decision.baselineRevisionAtDecision,2);
 }finally{db.close();}
});

test('decision requires explicit confirmation and valid reasons before any state change',()=>{
 const {db,p}=setup();try{
  const review=createOpportunityReview(db,p.id,{overallAssessment:'交付尚未验收，先记录一次中期复盘结论'});
  assert.throws(()=>decideOpportunityReview(db,p.id,review.id,{choice:'pause',reason:'没有勾选确认就尝试暂停项目并留档',confirm:false}),{code:'CONFIRMATION_REQUIRED'});
  assert.throws(()=>decideOpportunityReview(db,p.id,review.id,{choice:'pause',reason:'理由太短',confirm:true}),{code:'BAD_REQUEST'});
  assert.throws(()=>decideOpportunityReview(db,p.id,review.id,{choice:'pivot',reason:'这不是有效的决定类型，理由长度也足够',confirm:true}),{code:'BAD_REQUEST'});
  assert.throws(()=>decideOpportunityReview(db,p.id,'missing',{choice:'pause',reason:'复盘记录不存在时不能做出任何决定',confirm:true}),{code:'NOT_FOUND'});
  assert.equal(db.get('projects',p.id).status,'research'); // nothing changed by refused attempts
  const decided=decideOpportunityReview(db,p.id,review.id,{choice:'pause',reason:'外部进度慢于预期，先暂停并核对外部状态',confirm:true});
  assert.deepEqual(decided.decision.appliedStateChange,{from:'research',to:'paused'});
  const project=db.get('projects',p.id);
  assert.equal(project.status,'paused');
  assert.ok(project.lastDecision.includes('复盘决定'));
  assert.throws(()=>decideOpportunityReview(db,p.id,review.id,{choice:'stop',reason:'同一次复盘不能重复决定两次并留档',confirm:true}),{code:'BAD_STATE'});
  const events=db.events(0,p.id).filter(e=>e.kind==='opportunity_review.decided');
  assert.equal(events.length,1);
  assert.equal(events[0].detail.appliedStateChange.to,'paused');
 }finally{db.close();}
});

test('paused projects can still be reviewed; stop works from pause, resume needs a free slot',()=>{
 const {db,s,p}=setup();try{
  const first=createOpportunityReview(db,p.id,{overallAssessment:'暂停前的中期复盘：证据不足以支撑继续投入'});
  decideOpportunityReview(db,p.id,first.id,{choice:'pause',reason:'暂停两周，先完成外部状态与租约核对',confirm:true});
  assert.equal(db.get('projects',p.id).status,'paused');
  // reviewing a paused project is allowed (retrospective), with adapted options
  const second=createOpportunityReview(db,p.id,{overallAssessment:'暂停期间复盘：没有新的真实试用出现'});
  const pauseOption=second.recommendationOptions.find(o=>o.choice==='pause');
  const stopOption=second.recommendationOptions.find(o=>o.choice==='stop');
  assert.ok(pauseOption.blockers.includes('project_not_active'));
  assert.equal(stopOption.blockers.length,0);
  decideOpportunityReview(db,p.id,second.id,{choice:'stop',reason:'两个月无试用，停止本实验并保留全部记录',confirm:true});
  assert.equal(db.get('projects',p.id).status,'stopped');
  // a stopped project can be archived as evidence but not re-paused by review
  const third=createOpportunityReview(db,p.id,{overallAssessment:'停止后的最终复盘：记录经验供下一次实验参考'});
  assert.ok(third.recommendationOptions.find(o=>o.choice==='stop').blockers.includes('project_not_active'));
  assert.throws(()=>decideOpportunityReview(db,p.id,third.id,{choice:'pause',reason:'停止后的项目不能再次暂停，应当拒绝',confirm:true}),{code:'BAD_STATE'});
  // continue on a stopped project only records the decision, no state change
  assert.throws(()=>decideOpportunityReview(db,p.id,third.id,{choice:'continue',reason:'停止条件已触发，直接继续需要确认风险',confirm:true}),{code:'OPEN_RISKS_ACK_REQUIRED'});
  const resumed=decideOpportunityReview(db,p.id,third.id,{choice:'continue',reason:'新证据显示渠道可行，重启实验并保留历史记录',confirm:true,acceptOpenRisks:true});
  assert.equal(resumed.decision.appliedStateChange,null); // stopped ≠ paused: continue does not resume
  assert.equal(db.get('projects',p.id).status,'stopped');
 }finally{db.close();}
});

test('continue on a paused project resumes only when no other experiment is active',()=>{
 const {db,s,p}=setup();try{
  const first=createOpportunityReview(db,p.id,{overallAssessment:'中期复盘：外部 Agent 进度受阻，先暂停'});
  decideOpportunityReview(db,p.id,first.id,{choice:'pause',reason:'暂停并核对租约与外部进程的真实状态',confirm:true});
  // a second experiment can start while the first is paused
  const o2=s.createOpportunity({title:'Second chance',problem:'other problem',market:'China'});
  s.startExperiment({opportunityId:o2.id,goal:'validate other need',hypothesis:'other want',criteria:['works'],stopCondition:'stop when idle',hours:1,cash:0});
  const second=createOpportunityReview(db,p.id,{overallAssessment:'暂停期复盘：仍认为该方向值得继续'});
  // even with open risks acknowledged, resuming is refused while another experiment is active
  assert.throws(()=>decideOpportunityReview(db,p.id,second.id,{choice:'continue',reason:'想同时恢复两个主实验的请求应当被拒绝',confirm:true,acceptOpenRisks:true}),{code:'ACTIVE_EXPERIMENT_EXISTS'});
  assert.equal(db.get('projects',p.id).status,'paused');
 }finally{db.close();}
});

test('budget consumption flags real overruns and keeps unrecorded legs unknown',()=>{
 const {db,s,p}=setup();try{
  const fresh=buildReviewDraft(db,p.id);
  assert.equal(fresh.decision.budget.recordedUserHours,null);
  assert.equal(fresh.decision.budget.cashExceeded,null);
  s.addLedger(p.id,{type:'user_hours',value:5,actual:true,source:'手动记录'});
  s.addLedger(p.id,{type:'cash_cost',value:50,actual:true,source:'域名支出'});
  const draft=buildReviewDraft(db,p.id);
  assert.equal(draft.decision.budget.recordedUserHours,5);
  assert.equal(draft.decision.budget.recordedCashCost,50);
  assert.equal(draft.decision.budget.paceExceeded,true);   // 5h recorded vs ~0 elapsed weeks of a 2h/week budget
  assert.equal(draft.decision.budget.cashExceeded,true);  // ¥50 vs ¥0 approved cash
  assert.ok(kindsOf(draft).filter(k=>k==='budget_exceeded').length===2);
 }finally{db.close();}
});

test('invalid stop-condition judgment is rejected instead of silently stored as unassessed',()=>{
 const {db,p}=setup();try{
  assert.throws(()=>createOpportunityReview(db,p.id,{overallAssessment:'结论足够长，可以用来复盘判断',stopConditionAssessment:'banana'}),{code:'BAD_REQUEST'});
  // absent value still defaults to unassessed (missing ≠ invalid)
  const review=createOpportunityReview(db,p.id,{overallAssessment:'结论足够长，可以用来做出复盘判断'});
  assert.equal(review.stopConditionAssessment,'unassessed');
 }finally{db.close();}
});
test('baseline revision never re-judges hours consumed under the previous baseline',()=>{
 const {db,s,p}=setup();try{
  const backdated=new Date(Date.now()-28*86400000).toISOString();
  const proj=db.get('projects',p.id);
  db.put('projects',{...proj,baselines:[{...proj.baselines[0],approvedAt:backdated},...proj.baselines.slice(1)]},proj.revision);
  s.addLedger(p.id,{type:'user_hours',value:2,actual:true,source:'手动记录'});
  s.ownerDecision(p.id,{action:'revise_baseline',goal:'validate willingness to pay',criteria:['one paid order'],stopCondition:'两个月无付费则停止',reason:'需求观察成立，进入付费验证'});
  const after=createOpportunityReview(db,p.id,{overallAssessment:'修订后立即复盘：旧基线内的消耗不得判为超支'});
  assert.equal(after.decisionReview.budget.startedAt,backdated);
  assert.equal(after.decisionReview.budget.weeksElapsed,4);
  assert.equal(after.decisionReview.budget.approvedHoursToNow,8);
  assert.equal(after.decisionReview.budget.paceExceeded,false);
  assert.ok(!kindsOf(after).includes('budget_exceeded'));
  // consumption beyond the accumulated allowance is still flagged
  s.addLedger(p.id,{type:'user_hours',value:10,actual:true,source:'追加投入（未走预算审批）'});
  const later=buildReviewDraft(db,p.id);
  assert.equal(later.decision.budget.paceExceeded,true);
  assert.ok(kindsOf(later).includes('budget_exceeded'));
 }finally{db.close();}
});
test('decide re-aggregates current data and unions blockers beyond the stored snapshot',()=>{
 const {db,s,p}=setup();try{
  const review=createOpportunityReview(db,p.id,{overallAssessment:'创建时只有证据缺失问题，尚无预算超支记录'});
  const storedContinue=review.recommendationOptions.find(o=>o.choice==='continue');
  assert.ok(!storedContinue.blockers.includes('budget_exceeded'));
  // a budget overrun appears AFTER the review was written
  s.addLedger(p.id,{type:'user_hours',value:50,actual:true,source:'超出批准预算的投入'});
  assert.throws(()=>decideOpportunityReview(db,p.id,review.id,{choice:'continue',reason:'试图不确认新增的预算超支风险就直接继续',confirm:true}),{code:'OPEN_RISKS_ACK_REQUIRED'});
  const decided=decideOpportunityReview(db,p.id,review.id,{choice:'continue',reason:'确认新增的预算超支风险后继续推进实验',confirm:true,acceptOpenRisks:true});
  assert.ok(decided.decision.openRiskKinds.includes('budget_exceeded')); // union with freshly aggregated issues
  assert.ok(decided.decision.openRiskKinds.includes('insufficient_validation')); // stored blockers retained
 }finally{db.close();}
});

test('periodic reminder reaches the pipeline only with an explicit due review summary',()=>{
 const base=()=>({status:'research',baselines:[{revision:1}],tasks:[],milestones:[{acceptanceState:'pending'}],submissions:[],decisions:[],contents:[]});
 const without=projectPipeline(base());
 assert.equal(without.reviewDue,null);
 assert.equal(without.nextActions.some(x=>x.kind==='review'),false); // regression: unchanged without reviewSummary
 const due=projectPipeline({...base(),reviewSummary:{due:true}});
 assert.equal(due.reviewDue,true);
 assert.equal(due.nextActions.some(x=>x.kind==='review'&&x.tab==='review'),true);
 assert.equal(projectPipeline({...base(),reviewSummary:{due:false}}).nextActions.some(x=>x.kind==='review'),false);
 const stopped=projectPipeline({status:'paused',baselines:[{revision:1}],tasks:[{status:'open',baselineRevision:1}],milestones:[{acceptanceState:'pending'}],submissions:[],decisions:[],contents:[],reviewSummary:{due:false,projectActive:false}});
 assert.equal(stopped.nextActions.some(x=>x.kind==='review'),false);
});
