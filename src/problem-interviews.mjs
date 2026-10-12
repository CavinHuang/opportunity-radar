import {randomUUID} from 'node:crypto';
import {verificationContext} from './problem-verification.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(v,n=800)=>String(v??'').trim().slice(0,n);
export function interviewBoard(store,id){
 const review=store.get('problem_verifications',id);
 if(!review||review.decision!=='worth_interviewing')throw fail('VERIFICATION_REQUIRED','先完成人工问题核查并确认值得访谈',409);
 const context=verificationContext(store,id);
 if(context.fingerprint!==review.fingerprint)throw fail('STALE_EVIDENCE','来源变化，需重新确认一手问题证据',409);
 const plans=store.list('problem_interview_plans').filter(x=>x.problemId===id).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
 return {candidate:{id,title:context.candidate.title},plans:plans.map(p=>({...p,observations:store.list('problem_interview_observations').filter(x=>x.planId===p.id)})),notice:'访谈记录是人工输入，不等于已证明市场规模；决策仍需用户确认'};
}
export function createInterviewPlan(store,id,data={}){
 const board=interviewBoard(store,id);
 if(board.plans.some(x=>x.status==='active'))throw fail('ACTIVE_PLAN_EXISTS','此问题已有正在执行的验证方案',409);
 const audience=clean(data.audience,240),hypothesis=clean(data.hypothesis),falsifier=clean(data.falsifier),questions=clean(data.questions,1200);
 if([audience,hypothesis,falsifier,questions].some(x=>x.length<10))throw fail('INCOMPLETE_PLAN','目标用户、假设、停止条件、访谈问题均需至少10字');
 const minInterviews=Number(data.minInterviews);
 if(!Number.isInteger(minInterviews)||minInterviews<1||minInterviews>20)throw fail('BAD_SAMPLE','访谈目标需为1至20人；不是市场规模估计');
 const item=store.put('problem_interview_plans',{id:randomUUID(),problemId:id,audience,hypothesis,falsifier,questions,minInterviews,status:'active',createdAt:new Date().toISOString(),verificationRevision:store.get('problem_verifications',id).revision});
 store.event('problem.interview.plan.created',id,'owner',{planId:item.id});return item;
}
export function addInterviewObservation(store,id,planId,data={}){
 const board=interviewBoard(store,id),plan=board.plans.find(x=>x.id===planId);
 if(!plan||plan.status!=='active')throw fail('PLAN_NOT_ACTIVE','验证方案不存在或已结束',409);
 const participant=clean(data.participant,120),scenario=clean(data.scenario,600),actualBehavior=clean(data.actualBehavior,800),contradiction=clean(data.contradiction,800),sourceUrl=clean(data.sourceUrl,400);
 if(!participant||scenario.length<10||actualBehavior.length<10||contradiction.length<8)throw fail('INCOMPLETE_OBSERVATION','需要匿名标识、真实场景、实际行为和反证记录');
 if(sourceUrl){let url;try{url=new URL(sourceUrl)}catch{}if(url?.protocol!=='https:')throw fail('BAD_SOURCE','证据链接须使用HTTPS');}
 const item=store.put('problem_interview_observations',{id:randomUUID(),planId,problemId:id,participant,scenario,actualBehavior,contradiction,sourceUrl,at:new Date().toISOString()});
 store.event('problem.interview.observed',id,'owner',{planId,observationId:item.id});return item;
}
export function decideInterviewPlan(store,id,planId,{decision,reason,expected_revision}={}){
 const board=interviewBoard(store,id),plan=board.plans.find(x=>x.id===planId);
 if(!plan||plan.status!=='active')throw fail('PLAN_NOT_ACTIVE','验证方案不存在或已经结案',409);
 if(plan.revision!==expected_revision)throw fail('REVISION_CONFLICT','计划已被更新，请刷新',409);
 if(!['continue_research','low_cost_test','stop'].includes(decision))throw fail('BAD_DECISION','决策必须是继续调查、低成本实验或停止');
 const note=clean(reason);if(note.length<12)throw fail('REASON_REQUIRED','记录支持或反驳假设的具体依据，至少12字');
 if(decision==='low_cost_test'&&plan.observations.length<plan.minInterviews)throw fail('INSUFFICIENT_INTERVIEWS','未达到自己设定的访谈目标，不可升级为低成本实验');
 const row=store.put('problem_interview_plans',{...plan,observations:undefined,status:'closed',decision,decisionReason:note,closedAt:new Date().toISOString()},plan.revision);
 store.event('problem.interview.decided',id,'owner',{planId,decision,observations:plan.observations.length});
 return row;
}
