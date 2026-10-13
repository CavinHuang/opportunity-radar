import {opportunityScanCandidates} from './opportunity-scan.mjs';
import {opportunityDecisionBrief} from './opportunity-decision-brief.mjs';
import {decisionEffectivenessReport} from './opportunity-decision-effectiveness.mjs';

// Read-only research queue. The order means "what deserves review next", not ROI.
export function opportunityPortfolioReview(store,{limit=50}={}){
 const scan=opportunityScanCandidates(store,{limit:Math.min(Math.max(1,Number(limit)||50),50)});
 const rows=scan.items.map(candidate=>{
  const brief=opportunityDecisionBrief(store,candidate.id);
  const effectiveness=decisionEffectivenessReport(store,{problemId:candidate.id});
  const history=store.list('opportunity_decision_history').filter(x=>x.problemId===candidate.id);
  const pending=history.filter(x=>!x.outcome);
  const inconclusive=effectiveness.inconclusive;
  const stopped=brief.disposition==='pause_or_stop';
  const experiment=brief.disposition==='review_small_experiment';
  const reviewClass=stopped?'review_stop':pending.length?'close_feedback_loop':experiment?'review_small_experiment':'fill_evidence_gap';
  const reasons=stopped?['已有人工反证或停止决定，先复核原因']:pending.length?
   ['存在未回填的研究决策，应先补充真实结果']:experiment?['满足当前证据门槛，可人工复核最小实验']:['证据仍不充分，优先处理首个缺口'];
  if(inconclusive.records)reasons.push('此前有'+inconclusive.records+'次研究未取得明确结论');
  return {id:candidate.id,title:candidate.title,sourceUrls:candidate.sourceUrls,
   stage:brief.stage,disposition:brief.disposition,reviewClass,priorityReasons:reasons,
   nextAction:pending.length?'回填已有研究决策的实际结果':brief.nextAction,
   blockers:brief.blockers.slice(0,5),pendingDecisions:pending.length,
   decisionRecords:history.length,completedDecisions:effectiveness.sample.closed,
   inconclusiveHours:inconclusive.hours,actualHours:effectiveness.actual.hoursClosed,
   plannedHoursForClosed:effectiveness.plan.hoursClosed,
   // Budget and currency may differ; do not rank or aggregate money here.
   reportAvailable:true};
 });
 const rank={close_feedback_loop:0,review_small_experiment:1,fill_evidence_gap:2,review_stop:3};
 rows.sort((a,b)=>rank[a.reviewClass]-rank[b.reviewClass]||
  b.pendingDecisions-a.pendingDecisions||a.id.localeCompare(b.id));
 const suggested=rows.filter(r=>r.reviewClass!=='review_stop').slice(0,3);
 const pendingTotal=rows.reduce((s,r)=>s+r.pendingDecisions,0);
 return {scope:{candidateLimit:50,examined:scan.examined,shown:rows.length},rows,suggested,
  summary:{pendingDecisions:pendingTotal,experimentReviews:rows.filter(r=>r.reviewClass==='review_small_experiment').length,
    paused:rows.filter(r=>r.reviewClass==='review_stop').length,
    inconclusiveResearchHours:Number(rows.reduce((s,r)=>s+r.inconclusiveHours,0).toFixed(2))},
  manualSelectionRequired:true,commercialValueScore:null,
  notice:'仅比较当前候选榜单前50条，不代表全市场机会。先处理未回填决策与明确证据门槛，不按虚构收益排序；本周建议仅用于人工选择，不自动启动实验或支出。历史投入来自人工自报。'};
}
