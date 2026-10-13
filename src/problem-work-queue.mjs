import {opportunityScanCandidates} from './opportunity-scan.mjs';
import {decisionReviewCenter} from './problem-decision-center.mjs';
const time=x=>Date.parse(x||'')||0;
/** One honest next action per eligible problem; no invented validations. */
export function problemWorkQueue(store,{today=new Date().toISOString().slice(0,10),limit=12}={}){
 const candidates=opportunityScanCandidates(store,{limit:50}).items;
 const latest=store.get('home_opportunity_scans','latest');
 const visible=new Set(latest?.status==='filtered'?(latest.items||[]).map(x=>x.id):[]);
 const pending=[],inProgress=[];
 // 核查记录优先按键匹配；键不命中时按稳定信号交集匹配（候选聚类合并后记录换锚）。
 // 命中的条目一律以记录自身 ID 为动作锚点，窗口变化不影响后续核查/访谈/实验入口。
 const findVerification=(id,signalIds=[])=>{
  const direct=store.get('problem_verifications',id);
  if(direct)return direct;
  if(!signalIds.length)return null;
  return store.list('problem_verifications').find(v=>(v.signalIds||[]).some(s=>signalIds.includes(s)))||null;
 };
 const describe=(displayId,title,sourceUrls,candidateSignalIds=[],actionId=displayId)=>{
  const decision=store.get('home_opportunity_decisions',displayId);
  if(decision?.action==='dismiss')return;
  const verification=findVerification(displayId,candidateSignalIds);
  if(!verification){
    if(visible.has(displayId))pending.push({id:displayId,title,stage:'verify',action:'verify-problem',label:'核查原帖和真实问题',reason:'还没有人工核实一手经历与实际影响',sourceUrls});
    return;
  }
  if(verification.decision==='not_a_real_problem')return;
  const sourceUrlsOut=sourceUrls.length?sourceUrls:(verification.signalIds||[]).map(s=>store.get('sources',s)?.url).filter(Boolean);
  if(verification.decision==='needs_more_evidence'){
    inProgress.push({id:actionId,title,stage:'evidence',action:'verify-problem',label:'补充缺失证据',reason:'人工标记仍需取证',sourceUrls:sourceUrlsOut});return;
  }
  const plans=store.list('problem_interview_plans').filter(x=>x.problemId===verification.id).sort((a,b)=>time(b.createdAt)-time(a.createdAt));
  const active=plans.find(x=>x.status==='active');
  if(active){
   const count=store.list('problem_interview_observations').filter(x=>x.planId===active.id).length;
   inProgress.push({id:actionId,title,stage:'interview',action:count>=active.minInterviews?'interview-decision':'problem-interviews',label:count>=active.minInterviews?'复盘访谈并作出决策':'继续记录访谈',reason:`已记录 ${count}/${active.minInterviews} 次访谈`,sourceUrls:sourceUrlsOut});return;
  }
  const approved=plans.find(x=>x.decision==='low_cost_test');
  if(approved){
   const design=store.list('problem_experiment_designs').find(x=>x.planId===approved.id);
   if(!design)inProgress.push({id:actionId,title,stage:'design',action:'experiment-design',label:'设计最小验证实验',reason:'访谈已批准低成本验证，但实验尚未设计',sourceUrls:sourceUrlsOut});
   else if(design.status!=='closed'){
    const count=store.list('problem_experiment_records').filter(x=>x.designId===design.id).length;
    inProgress.push({id:actionId,title,stage:'experiment',action:count?'experiment-close':'experiment-execute',label:count?'复盘实验结果':'记录真实实验行为',reason:count?`已有 ${count} 条实际执行记录`:'尚无实验执行记录',sourceUrls:sourceUrlsOut});
   }
  }else if(!plans.length||plans[0].decision==='continue_research'){
    inProgress.push({id:actionId,title,stage:'interview',action:'problem-interviews',label:'建立或继续访谈',reason:'原帖已经人工核查，可继续验证问题',sourceUrls:sourceUrlsOut});
  }
 };
 const windowSignals=new Set(candidates.flatMap(c=>c.signalIds||[]));
 for(const c of candidates)describe(c.id,c.title,c.sourceUrls,c.signalIds);
 // 窗口外兜底：核查后滑出候选窗口、且信号未被任何窗口候选承接的记录，
 // 仍按保存的锚点与标题展示，工作台不再静默丢项。
 const anchored=new Set([...pending,...inProgress].map(x=>x.id));
 for(const v of store.list('problem_verifications')){
  if(anchored.has(v.id))continue;
  if((v.signalIds||[]).some(s=>windowSignals.has(s)))continue;
  describe(v.id,v.title||v.id,[],v.signalIds);
 }
 const reviews=decisionReviewCenter(store).items;
 const conclusions=reviews.map(x=>({id:x.id,problemId:x.problemId,decision:x.review?.nextStep||x.decision,assessment:x.review?.assessment||null,revisitAt:x.review?.revisitAt||null,reason:x.review?.reason||x.reason,actualCost:x.actualCost,currency:x.currency,recordCount:x.recordCount})).sort((a,b)=>String(a.revisitAt||'9999').localeCompare(String(b.revisitAt||'9999')));
 const due=conclusions.filter(x=>x.revisitAt&&x.revisitAt<=today);
 return {discover:{items:pending.slice(0,limit),count:pending.length},validate:{items:inProgress.slice(0,limit),count:inProgress.length},conclude:{items:conclusions.slice(0,limit),count:conclusions.length,dueCount:due.length},notice:'只统计真实已有记录；未配置 AI 或没有合格问题时不会生成虚假任务'};
}
