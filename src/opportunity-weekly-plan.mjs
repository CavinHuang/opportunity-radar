import {opportunityPortfolioReview} from './opportunity-portfolio-review.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(x,n=700)=>String(x??'').trim().slice(0,n);
const money=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100000&&Math.round(x*100)===Math.round(x*100*100)/100;
export function weekMonday(now=new Date()){
 const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
 date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return date.toISOString().slice(0,10);
}
export function weeklyResearchPlan(store,{now=new Date()}={}){
 const weekStart=weekMonday(now),id='week:'+weekStart;
 const plan=store.get('opportunity_weekly_plans',id);
 const portfolio=opportunityPortfolioReview(store);
 const current=new Set(portfolio.rows.map(x=>x.id));
 const items=(plan?.items||[]).map(x=>({...x,available:current.has(x.candidateId)}));
 const priorDate=new Date(weekStart+'T00:00:00Z');priorDate.setUTCDate(priorDate.getUTCDate()-7);
 const prior=store.get('opportunity_weekly_plans','week:'+priorDate.toISOString().slice(0,10));
 const previousTasks=(prior?.items||[]).map(x=>({candidateId:x.candidateId,title:x.title,task:x.task,hours:x.hours,budget:x.budget,available:current.has(x.candidateId)}));
 return {id,weekStart,revision:plan?.revision||0,status:plan?.status||'draft',items,
  review:plan?.review||null,progress:plan?.progress||[],previousTasks,portfolioSuggestions:portfolio.suggested.map(x=>({id:x.id,title:x.title,reason:x.nextAction})),
  notice:'本周计划由用户手动选择；旧候选若不再符合筛选，只保留历史，不自动恢复。时间和预算均为规划/自报数据。'};
}
export function saveWeeklyResearchPlan(store,data={},options={}){
 const board=weeklyResearchPlan(store,options);
 if(board.status==='reviewed')throw fail('WEEK_CLOSED','本周已经复盘，无法覆盖',409);
 if(data.expected_revision!==board.revision)throw fail('REVISION_CONFLICT','计划已被更新',409);
 if(!Array.isArray(data.items)||data.items.length>3)throw fail('INVALID_SELECTION','每周最多选择三个机会');
 const candidates=opportunityPortfolioReview(store).rows;
 const available=new Map(candidates.filter(x=>x.reviewClass!=='review_stop').map(x=>[x.id,x]));
 const seen=new Set(),items=[];
 for(const entry of data.items){
  if(!entry||typeof entry.candidateId!=='string'||!available.has(entry.candidateId)||seen.has(entry.candidateId))throw fail('INVALID_CANDIDATE','不能选择不存在、重复或已停止的机会',409);
  seen.add(entry.candidateId);
  const hours=Number(entry.hours),budget=Number(entry.budget),task=clean(entry.task);
  if(!Number.isFinite(hours)||hours<=0||hours>80||!Number.isFinite(budget)||budget<0||budget>100000||!Number.isInteger(Math.round(budget*100))||task.length<10)throw fail('INVALID_PLAN','每项需填写10字以上任务、有效小时数与非负预算');
  items.push({candidateId:entry.candidateId,title:available.get(entry.candidateId).title,task,hours,budget});
 }
 return store.transaction(()=>{
  const fresh=weeklyResearchPlan(store,options);
  if(fresh.revision!==data.expected_revision||fresh.status==='reviewed')throw fail('REVISION_CONFLICT','计划已被并发更新',409);
  const previous=store.get('opportunity_weekly_plans',board.id);
  if(previous?.progress?.length){
   const before=new Map((previous.items||[]).map(x=>[x.candidateId,x]));
   if(items.length!==before.size||items.some(x=>JSON.stringify(x)!==JSON.stringify(before.get(x.candidateId))))
    throw fail('PROGRESS_EXISTS','已有执行记录的计划不可改写任务，请先复盘',409);
  }
  const row=store.put('opportunity_weekly_plans',{id:board.id,weekStart:board.weekStart,items,status:'planned',review:null,
   progress:previous?.progress||[],updatedAt:new Date().toISOString()},board.revision);
  store.event('opportunity.weekly_plan.saved',board.id,'owner',{count:items.length,revision:row.revision});
  return row;
 });
}
export function reviewWeeklyResearchPlan(store,data={},options={}){
 const board=weeklyResearchPlan(store,options);
 if(board.status!=='planned'||!board.items.length)throw fail('NO_WEEK_PLAN','先保存本周计划',409);
 if(data.expected_revision!==board.revision)throw fail('REVISION_CONFLICT','计划版本已更新',409);
 const note=clean(data.notes),results=data.results;
 if(note.length<12||!Array.isArray(results)||results.length!==board.items.length)throw fail('INCOMPLETE_REVIEW','需填写总结与每项实际结果');
 const seen=new Set(),finished=[];
 for(const result of results){
  const item=board.items.find(x=>x.candidateId===result?.candidateId);
  if(!item||seen.has(item.candidateId)||!['completed','inconclusive','blocked'].includes(result.status))throw fail('INVALID_REVIEW','复盘项与计划不一致');
  seen.add(item.candidateId);
  const actualHours=Number(result.actualHours),actualCost=Number(result.actualCost),observation=clean(result.observation);
  if(!Number.isFinite(actualHours)||actualHours<0||actualHours>1000||!Number.isFinite(actualCost)||actualCost<0||actualCost>100000||observation.length<10)throw fail('INVALID_REVIEW','请填写实际投入与不少于10字的观察结果');
  finished.push({candidateId:item.candidateId,status:result.status,actualHours,actualCost,observation});
 }
 return store.transaction(()=>{
  const fresh=weeklyResearchPlan(store,options);
  if(fresh.revision!==data.expected_revision||fresh.status!=='planned')throw fail('REVISION_CONFLICT','计划复盘已变化',409);
  const row=store.put('opportunity_weekly_plans',{...store.get('opportunity_weekly_plans',board.id),status:'reviewed',review:{notes:note,results:finished,at:new Date().toISOString()}},board.revision);
  store.event('opportunity.weekly_plan.reviewed',board.id,'owner',{revision:row.revision,count:finished.length});
  return row;
 });
}
