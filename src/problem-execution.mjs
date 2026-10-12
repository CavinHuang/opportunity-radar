import {randomUUID} from 'node:crypto';
import {problemExperimentDesigns} from './problem-experiments.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(v,n=1200)=>String(v??'').trim().slice(0,n);
function context(store,problemId,planId,designId){
 const d=problemExperimentDesigns(store,problemId,planId).designs.find(x=>x.id===designId);
 if(!d)throw fail('DESIGN_NOT_FOUND','未找到该问题的实验草稿',404);
 return d;
}
export function experimentExecutionBoard(store,problemId,planId,designId){
 const design=context(store,problemId,planId,designId);
 const records=store.list('problem_experiment_records').filter(x=>x.designId===designId).sort((a,b)=>(a.at||'').localeCompare(b.at||''));
 const actualCost=records.reduce((sum,x)=>sum+x.cost,0);
 return {design,records,actualCost,remainingBudget:Math.max(0,design.budgetLimit-actualCost),
  notice:'所有结果由用户录入，未经独立验证；预算为记录上限，不会触发支付或自动执行'};
}
export function recordExperimentResult(store,problemId,planId,designId,data={}){
 const board=experimentExecutionBoard(store,problemId,planId,designId);
 if(board.design.status==='closed')throw fail('EXPERIMENT_CLOSED','实验已经结案',409);
 const step=clean(data.step),behavior=clean(data.behavior),outcome=clean(data.outcome),evidenceUrl=clean(data.evidenceUrl,500),participant=clean(data.participant,120);
 const cost=Number(data.cost);
 if(step.length<8||behavior.length<10||outcome.length<10||!participant)throw fail('INCOMPLETE_RESULT','必须填写步骤、参与者匿名标识、真实行为和观察结果');
 if(!Number.isFinite(cost)||cost<0||Math.round(cost*100)!==cost*100)throw fail('INVALID_COST','成本必须是非负数，最多两位小数');
 if(Math.round((board.actualCost+cost)*100)>Math.round(board.design.budgetLimit*100))throw fail('BUDGET_EXCEEDED','记录成本将超出实验预算上限',409);
 if(evidenceUrl){let url;try{url=new URL(evidenceUrl)}catch{}if(url?.protocol!=='https:')throw fail('INVALID_EVIDENCE_URL','只能引用 HTTPS 证据链接');}
 const row=store.put('problem_experiment_records',{id:randomUUID(),problemId,planId,designId,step,participant,behavior,outcome,cost,evidenceUrl,at:new Date().toISOString()});
 store.event('problem.experiment.result_recorded',problemId,'owner',{designId,recordId:row.id,cost});
 return row;
}
export function closeExperiment(store,problemId,planId,designId,{decision,reason,expected_revision}={}){
 const board=experimentExecutionBoard(store,problemId,planId,designId);
 if(board.design.status==='closed')throw fail('EXPERIMENT_CLOSED','实验已经结案',409);
 if(board.design.revision!==expected_revision)throw fail('REVISION_CONFLICT','实验设计版本已变更',409);
 if(!['continue','iterate','stop'].includes(decision))throw fail('INVALID_DECISION','请选择继续、调整或停止');
 const note=clean(reason);if(note.length<12)throw fail('REASON_REQUIRED','需要至少12字的证据和结论');
 if(decision==='continue'&&!board.records.length)throw fail('NO_RESULTS','没有真实执行记录，不得建议继续',409);
 const updated=store.put('problem_experiment_designs',{...board.design,status:'closed',decision,decisionReason:note,actualCost:board.actualCost,closedAt:new Date().toISOString()},board.design.revision);
 store.event('problem.experiment.closed',problemId,'owner',{designId,decision,actualCost:board.actualCost});
 return updated;
}
