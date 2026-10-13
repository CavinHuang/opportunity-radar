// Phase D · Opportunity retrospective and decision support.
// Rules enforced here:
// - Each review compares outcomes against the ORIGINAL approved hypothesis
//   (baseline r1) AND the current baseline; both snapshots are preserved so a
//   later baseline revision never rewrites past reviews.
// - Missing data is Unknown (null), never zero. The system never produces a
//   completion percentage and never declares an opportunity validated.
// - Recommendation options (continue / adjust / pause / stop) are decision
//   support only. Project state changes (pause / stop / resume-on-continue)
//   happen exclusively after the Owner's explicit confirmation (confirm=true).
// - Decision reason, evidence summary, timestamps and baseline revision are
//   preserved on the review record and in the event log.
import { randomUUID } from 'node:crypto';
import { experimentDecisionReview } from './experiment-decision.mjs';
import { validationSummary } from './validation.mjs';
import { feedbackOverview } from './delivery-trace.mjs';
import { growthReport, parseDay } from './growth.mjs';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const now=()=>new Date().toISOString();
const DAY=86400000;
const clean=(v,max)=>String(v??'').trim().slice(0,max);

export const REVIEW_CYCLE_DAYS=7;
/** Deployment-tunable review cadence: RADAR_REVIEW_CYCLE_DAYS (integer 1–365),
 * default 7. Read at call time so tests and deployments can adjust without forks. */
export function reviewCycleDays(env=process.env){
 const raw=Number(env.RADAR_REVIEW_CYCLE_DAYS);
 if(!Number.isInteger(raw)||raw<1||raw>365)return REVIEW_CYCLE_DAYS;
 return raw;
}
export const FINDING_KINDS=['observation','contradiction','uncertainty','risk','anomaly'];
export const STOP_ASSESSMENTS=['unassessed','not_met','partially_met','met'];
export const REVIEW_CHOICES=['continue','adjust','pause','stop'];
// Finding kinds shown to the owner in Chinese, reused by the API error copy.
const FINDING_LABELS={observation:'用户观察',contradiction:'反证',uncertainty:'不确定性',risk:'未解决风险',anomaly:'数据异常'};
const CHOICE_LABELS={continue:'继续',adjust:'调整',pause:'暂停',stop:'停止'};

function requireProject(store,projectId){
 const project=store.get('projects',projectId);
 if(!project)throw fail('NOT_FOUND','项目不存在',404);
 return project;
}
const isActive=p=>!['paused','stopped','archived'].includes(p.status);

function snapshotBaseline(b){
 return b?{revision:b.revision,approvedAt:b.approvedAt||null,goal:b.goal,hypothesis:b.hypothesis,
  stopCondition:b.stopCondition,scope:b.scope||'',nonGoals:b.nonGoals||'',
  criteria:(b.criteria||[]).map(c=>c.text),budget:b.budget?{weeklyUserHours:b.budget.weeklyUserHours,cash:b.budget.cash}:null,
  changeReason:b.changeReason||null}:null;
}

/** Periodic-review status for one project: how many reviews exist, when the
 * latest was made, and whether a new cycle is due (active projects only). */
export function reviewSummary(store,projectId){
 const project=requireProject(store,projectId);
 const reviews=store.list('opportunity_reviews').filter(r=>r.projectId===projectId)
  .sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const latest=reviews.at(-1)||null;
 const cycleDays=reviewCycleDays();
 const nextDueAt=latest?new Date(Date.parse(latest.createdAt)+cycleDays*DAY).toISOString():null;
 return {count:reviews.length,cycleDays,
  latestAt:latest?.createdAt||null,
  latestDecision:latest?.decision?{choice:latest.decision.choice,decidedAt:latest.decision.decidedAt,appliedStateChange:latest.decision.appliedStateChange}:null,
  nextDueAt,due:isActive(project)&&(!latest||Date.now()>=Date.parse(nextDueAt)),
  projectActive:isActive(project)};
}

/** Read-only aggregation for one review cycle. Nothing here mutates data and
 * nothing here decides; every section keeps Unknown semantics. */
export function buildReviewDraft(store,projectId,{windowFrom,windowTo}={}){
 const project=requireProject(store,projectId);
 const toDay=windowTo!=null?parseDay(windowTo,'结束日期'):new Date().toISOString().slice(0,10);
 const fromDay=windowFrom!=null?parseDay(windowFrom,'开始日期'):new Date(Date.parse(toDay+'T00:00:00Z')-29*DAY).toISOString().slice(0,10);
 if(fromDay>toDay)throw fail('BAD_REQUEST','开始日期不能晚于结束日期');
 const decision=experimentDecisionReview({
  // 已撤回的账本条目不再计入复盘：收入/净现金/预算判断必须基于有效数据。
  ledger:store.list('ledger').filter(x=>x.projectId===projectId&&!x.retractedAt),
  milestones:store.list('milestones').filter(m=>m.projectId===projectId).sort((a,b)=>a.order-b.order),
  submissions:store.list('submissions').filter(x=>x.projectId===projectId),
  baselines:project.baselines});
 const validation=validationSummary(store,project.opportunityId);
 const feedback=feedbackOverview(store,projectId);
 const growth=growthReport(store,projectId,{from:fromDay,to:toDay});
 const evidenceRows=store.list('evidence').filter(x=>x.projectId===projectId);
 const flagged=collectIssues(decision,validation,growth,'unassessed');
 return {projectId,generatedAt:now(),window:{from:fromDay,to:toDay},
  originalBaseline:snapshotBaseline(project.baselines[0]),
  currentBaseline:snapshotBaseline(project.baselines.at(-1)),
  selectionRationale:project.selectionRationale||null,
  decision,
  evidence:{total:evidenceRows.length,
   verified:evidenceRows.filter(x=>x.verificationState==='verified').length,
   ownerAttested:evidenceRows.filter(x=>x.verificationState==='owner_attested').length,
   pending:evidenceRows.filter(x=>x.verificationState==='pending').length},
  market:{
   validation:{planCount:validation.planCount,latestPlanStatus:validation.latestPlan?.status||'not_started',
    observationCount:validation.observationCount,stanceCounts:validation.counts,
    distinctParticipantRefs:validation.distinctParticipantRefs,evidenceStatement:validation.evidenceStatement},
   feedback:{totalRecords:feedback.totalRecords,counts:feedback.counts,distinctAnonymousRefs:feedback.distinctAnonymousRefs},
   growth:{totals:growth.totals,anomalies:growth.anomalies,unknownPolicy:growth.unknownPolicy}},
  flaggedIssues:flagged,
  recommendationOptions:buildOptions(decision,flagged,'unassessed',project.status),
  caveats:['复盘只汇总已登记数据：缺失指标为未知，不按零；不存在完成度百分比。',
   '继续/调整/暂停/停止只是备选方案；任何项目状态变更都需你在此明确确认后执行。',
   '单条公开信号或一次宣发结果不构成“机会已被验证”的证据。'],
  unknownPolicy:'missing_data_is_unknown'};
}

/** Flag insufficient validation, data anomalies, unresolved risks, budget
 * overruns and unassessed stop conditions. Labels only — never verdicts. */
function collectIssues(decision,validation,growth,stopAssessment){
 const issues=[];
 if(decision.status==='delivery_unverified')
  issues.push({kind:'delivery_incomplete',severity:'high',detail:'交付里程碑尚未全部正式验收，或仍有待处理的验收提交；交付完成情况不能记为完成'});
 if(decision.evidenceCoverage.missingMetrics.length)
  issues.push({kind:'insufficient_validation',severity:'medium',detail:'以下关键结果指标从未登记实际数据：'+decision.evidenceCoverage.missingMetrics.join('、')+'；缺失数据按未知处理，不能视为零结果'});
 const counts=validation.counts||validation.stanceCounts||{supports:0,contradicts:0,unclear:0};
 if(!validation.observationCount)
  issues.push({kind:'insufficient_validation',severity:'high',detail:'当前没有用户验证观察记录；不能依据缺失的观察宣布需求成立'});
 else{
  if(counts.contradicts>0)
   issues.push({kind:'unresolved_risk',severity:'medium',detail:'验证观察中有 '+counts.contradicts+' 条反证记录，尚未被后续证据覆盖或排除'});
  if(counts.unclear>0)
   issues.push({kind:'uncertainty_open',severity:'low',detail:'有 '+counts.unclear+' 条观察结论为“不确定”，仍需补充证据'});
 }
 if(growth.anomalies.unexplained.length)
  issues.push({kind:'data_anomaly',severity:'high',detail:'窗口内有 '+growth.anomalies.unexplained.length+' 条未说明的数据异常峰值，先补充异常说明再复盘'});
 const budget=decision.budget||{};
 if(budget.paceExceeded===true)
  issues.push({kind:'budget_exceeded',severity:'high',detail:'已登记的个人时间（'+budget.recordedUserHours+'h）超过按周折算的批准预算（'+budget.approvedHoursToNow+'h）；追加投入需新证据与审批'});
 if(budget.cashExceeded===true)
  issues.push({kind:'budget_exceeded',severity:'high',detail:'已登记现金支出（¥'+budget.recordedCashCost+'）超过批准的现金预算（¥'+budget.cashBudget+'）；追加投入需新证据与审批'});
 if(stopAssessment==='unassessed')
  issues.push({kind:'stop_condition_unassessed',severity:'medium',detail:'尚未对照批准的停止条件给出人工判断'});
 if(stopAssessment==='met')
  issues.push({kind:'stop_condition_met',severity:'high',detail:'人工判断停止条件已触发；继续执行需要先确认已知风险'});
 return issues;
}

/** Issue kinds that block a plain "continue" until the owner acknowledges them. */
const BLOCKING_KINDS=['delivery_incomplete','insufficient_validation','data_anomaly','budget_exceeded','stop_condition_met'];

/** Always present all four alternatives with explicit preconditions. A choice
 * with blockers stays selectable, but requires acknowledging the open risks. */
function buildOptions(decision,issues,stopAssessment,projectStatus){
 const blockers=[...new Set(issues.filter(i=>BLOCKING_KINDS.includes(i.kind)).map(i=>i.kind))];
 const pauseBlocked=!['research','execution','promotion','review'].includes(projectStatus);
 const stopBlocked=['stopped','archived'].includes(projectStatus);
 return [
  {choice:'continue',blockers,
   summary:projectStatus==='paused'?'恢复执行当前基线（项目当前已暂停）':'维持当前基线继续执行',
   requirement:'直接可选的前提：交付已验收、关键证据齐备、无未说明异常、预算未超支且停止条件未触发；存在缺口时必须确认已知风险后才能记录'},
  {choice:'adjust',blockers:[],
   summary:'继续推进，但调整目标、范围、验收标准或预算',
   requirement:'本决定本身不修改基线；调整必须通过单独的基线修订（revise_baseline）由你批准后生效'},
  {choice:'pause',blockers:pauseBlocked?['project_not_active']:[],
   summary:'暂停实验，停止授予新任务',
   requirement:'确认后项目立即进入暂停状态；外部进程不会被自动停机，需要人工核对'},
  {choice:'stop',blockers:stopBlocked?['project_not_active']:[],
   summary:'停止本实验，保留全部记录与决策原因',
   requirement:'确认后项目进入已停止状态；决定原因、时间与基线版本会随复盘留档'}];
}

function parseFindings(raw){
 if(raw==null)return [];
 if(!Array.isArray(raw)||raw.length>50)throw fail('BAD_REQUEST','findings 必须是不超过 50 条的数组');
 return raw.map(f=>{
  const kind=f&&FINDING_KINDS.includes(f.kind)?f.kind:null;
  if(!kind)throw fail('BAD_REQUEST','每条复盘发现必须标注类型：'+FINDING_KINDS.map(k=>FINDING_LABELS[k]).join('、'));
  const note=String(f.note??'').trim();
  if(note.length<6||note.length>1000)throw fail('BAD_REQUEST','每条复盘发现需要 6–1000 字的具体内容');
  return {id:randomUUID(),kind,note,ref:f.ref?clean(f.ref,300):null};
 });
}

/** Persist one review: the aggregation snapshot is always recomputed on the
 * server; the owner only supplies findings, the stop-condition judgment and
 * the written conclusion. */
export function createOpportunityReview(store,projectId,data){
 const project=requireProject(store,projectId);
 const windowFrom=data.windowFrom!=null?parseDay(data.windowFrom,'开始日期'):undefined;
 const windowTo=data.windowTo!=null?parseDay(data.windowTo,'结束日期'):undefined;
 if(windowFrom&&windowTo&&windowFrom>windowTo)throw fail('BAD_REQUEST','开始日期不能晚于结束日期');
 const overall=String(data.overallAssessment??'').trim();
 if(overall.length<16||overall.length>2000)throw fail('BAD_REQUEST','复盘结论需要 16–2000 字，请写明对照最初假设的判断依据');
 if(data.stopConditionAssessment!=null&&data.stopConditionAssessment!==''&&!STOP_ASSESSMENTS.includes(data.stopConditionAssessment))
  throw fail('BAD_REQUEST','无效的停止条件判断，必须是：'+STOP_ASSESSMENTS.join('、'));
 const assessment=STOP_ASSESSMENTS.includes(data.stopConditionAssessment)?data.stopConditionAssessment:'unassessed';
 const findings=parseFindings(data.findings);
 return store.transaction(()=>{
  const draft=buildReviewDraft(store,projectId,{windowFrom,windowTo});
  const issues=collectIssues(draft.decision,draft.market.validation,draft.market.growth,assessment);
  const options=buildOptions(draft.decision,issues,assessment,project.status);
  const item=store.put('opportunity_reviews',{
   id:randomUUID(),projectId,createdAt:now(),createdBy:'owner',
   window:{from:draft.window.from,to:draft.window.to},
   reviewedBaselineRevision:draft.currentBaseline?.revision??null,
   hypothesisSnapshot:{originalBaseline:draft.originalBaseline,currentBaseline:draft.currentBaseline},
   decisionReview:draft.decision,evidence:draft.evidence,marketSummary:draft.market,
   flaggedIssues:issues,findings,
   stopConditionAssessment:assessment,
   stopConditionNote:data.stopConditionNote?clean(data.stopConditionNote,800):'',
   overallAssessment:overall,
   recommendationOptions:options,decision:null});
  store.event('opportunity_review.created',item.id,'owner',
   {projectId,window:item.window,baselineRevision:item.reviewedBaselineRevision,
    stopConditionAssessment:assessment,issueKinds:issues.map(i=>i.kind),
    findingKinds:findings.map(f=>f.kind)},projectId);
  return item;
 });
}

/** Apply the owner's decision to a stored review. pause/stop/resume-on-continue
 * change project state ONLY here, and only after data.confirm===true. The
 * open-risk gate re-aggregates CURRENT data and takes the union with the
 * blockers snapshotted at review creation, so issues that appeared after the
 * review was written can never be silently bypassed. */
export function decideOpportunityReview(store,projectId,reviewId,data){
 requireProject(store,projectId);
 const choice=data.choice;
 if(!REVIEW_CHOICES.includes(choice))throw fail('BAD_REQUEST','无效的决定类型，必须是：'+REVIEW_CHOICES.map(c=>CHOICE_LABELS[c]).join('、'));
 const reason=String(data.reason??'').trim();
 if(reason.length<16||reason.length>1600)throw fail('BAD_REQUEST','决定理由需要 16–1600 字，这是留档的决策依据');
 if(data.confirm!==true)throw fail('CONFIRMATION_REQUIRED','项目状态变更必须由你明确确认；请先勾选“我确认执行该决定”',409);
 return store.transaction(()=>{
  const review=store.get('opportunity_reviews',reviewId);
  if(!review||review.projectId!==projectId)throw fail('NOT_FOUND','复盘记录不存在',404);
  if(review.decision)throw fail('BAD_STATE','该复盘已有决定；如需新的决定，请再创建一次周期复盘',409);
  const storedBlockers=((review.recommendationOptions||[]).find(o=>o.choice===choice)||{}).blockers||[];
  const project=store.get('projects',projectId);
  const stateBlocked=(choice==='pause'&&!isActive(project))||(choice==='stop'&&['stopped','archived'].includes(project.status));
  if(stateBlocked||storedBlockers.includes('project_not_active'))
   throw fail('BAD_STATE','项目已暂停或结束，该状态变更在当前复盘下不可用',409);
  let openRiskKinds=[...storedBlockers];
  if(choice==='continue'){
   // Re-aggregate with the review's own window against CURRENT data; union with
   // the stored blockers (conservative in both directions: nothing expires).
   const fresh=buildReviewDraft(store,projectId,{windowFrom:review.window?.from,windowTo:review.window?.to});
   const current=collectIssues(fresh.decision,fresh.market.validation,fresh.market.growth,review.stopConditionAssessment)
    .filter(i=>BLOCKING_KINDS.includes(i.kind)).map(i=>i.kind);
   openRiskKinds=[...new Set([...openRiskKinds,...current])];
  }
  if(openRiskKinds.length&&data.acceptOpenRisks!==true)
   throw fail('OPEN_RISKS_ACK_REQUIRED','该选项存在未解决问题（'+openRiskKinds.join('、')+'）；先处理问题，或确认已知风险后再记录该决定',409);
   const applied=applyStateChange(store,project,choice,data);
  const decision={choice,reason,decidedAt:now(),decidedBy:'owner',confirmed:true,
   baselineRevisionAtDecision:project.baselines.at(-1)?.revision??null,
   openRiskKinds,acknowledgedOpenRisks:openRiskKinds.length>0,
   appliedStateChange:applied,
   note:choice==='adjust'?'调整须经单独的基线修订并由你批准后生效；本决定未修改基线':null};
  const saved=store.put('opportunity_reviews',{...review,decision},review.revision);
  store.event('opportunity_review.decided',saved.id,'owner',
   {projectId,choice,reason,appliedStateChange:applied,
    baselineRevision:decision.baselineRevisionAtDecision,reviewCreatedAt:review.createdAt},projectId);
  return saved;
 });
}

function applyStateChange(store,project,choice,data={}){
 const from=project.status;
 let to=null;
 if(choice==='pause'){
  if(!isActive(project))throw fail('BAD_STATE','项目已处于暂停或结束状态',409);
  to='paused';
 }
 if(choice==='stop'){
  if(['stopped','archived'].includes(from))throw fail('BAD_STATE','项目已经停止',409);
  to='stopped';
 }
 if(choice==='continue'&&from==='paused'){
  if(store.list('projects').some(x=>x.id!==project.id&&!['paused','stopped','archived'].includes(x.status)))
   throw fail('ACTIVE_EXPERIMENT_EXISTS','已有其他主实验在推进，不能同时恢复',409);
  if(project.wakeCondition&&data.acknowledgeWakeCondition!==true)
   throw fail('WAKE_CONDITION_ACK_REQUIRED','恢复前需对照暂停时登记的唤醒条件并确认（acknowledgeWakeCondition）',409);
  to='research';
 }
 if(!to)return null;
 // PRD D45: pausing must record the wake condition; resuming requires the
 // owner to acknowledge it (decided at the review, same rule as ownerDecision).
 let wakeCondition=project.wakeCondition||null;
 if(to==='paused'){
  const wake=String(data.wakeCondition||'').trim();
  if(!wake)throw fail('BAD_REQUEST','暂停必须登记唤醒条件（满足什么条件才继续）',400);
  wakeCondition={text:wake,at:now()};
 }
 // Resume must move stage along with status — the same fix service.ownerDecision
 // already carries; without it a paused promotion project resumes as research/promotion.
 const stage=to==='research'?'research':project.stage;
 store.put('projects',{...project,status:to,stage,wakeCondition,externalProcessState:'unknown',
  lastDecision:'复盘决定：'+CHOICE_LABELS[choice]+'（依据见复盘记录）'},project.revision);
 return {from,to};
}

export function opportunityReviews(store,projectId){
 requireProject(store,projectId);
 return store.list('opportunity_reviews').filter(r=>r.projectId===projectId)
  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
