import {createHash} from 'node:crypto';
import {assessRealProblem} from './real-problem.mjs';
import {ruleTrialLedger} from './discovery-rule-approval.mjs';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const trialPredict=(id,r)=>id==='require_workaround'?r.qualified&&r.flags.workaround:id==='review_promotion_block'?r.flags.actor&&r.flags.task&&r.flags.pain:null;
const stableBucket=id=>parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0,8),16)%100;
const rowId='real_problem_rule_shadow';

export function shadowStatus(store){
 const row=store.get('discovery_rule_decisions',rowId);
 return {revision:row?.revision||0,active:row?.active||false,policyId:row?.policyId||null,percentage:row?.percentage||0,
  history:row?.history||[],lastRun:row?.lastRun||null,productionChanged:false};
}
export function setShadowStatus(store,{action,policy_id,percentage,reason,expected_revision}={}){
 const prev=shadowStatus(store),approved=ruleTrialLedger(store);
 if(expected_revision!==prev.revision)throw fail('REVISION_CONFLICT','影子测试状态已被修改',409);
 if(!['start','stop'].includes(action))throw fail('BAD_ACTION','只允许启动或停止');
 const note=String(reason||'').trim();
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','必须填写12到500字符的理由');
 if(action==='start'){
  if(!['require_workaround','review_promotion_block'].includes(policy_id)||approved.selectedTrial!==policy_id)
   throw fail('NOT_APPROVED','只有已审批的候选规则才能进行影子测试',409);
  if(!Number.isInteger(percentage)||percentage<1||percentage>25)throw fail('BAD_PERCENTAGE','比例必须为1到25之间的整数');
 }
 if(action==='stop'&&!prev.active)throw fail('NOT_ACTIVE','影子测试未启动',409);
 return store.transaction(()=>{
  const next=store.put('discovery_rule_decisions',{id:rowId,active:action==='start',policyId:action==='start'?policy_id:null,
   percentage:action==='start'?percentage:0,lastRun:prev.lastRun,
   history:[...prev.history,{action,policyId:action==='start'?policy_id:prev.policyId,reason:note,at:new Date().toISOString()}].slice(-100)},expected_revision);
  store.event('discovery.shadow.changed',rowId,'owner',{action,revision:next.revision});
  return shadowStatus(store);
 });
}
export function evaluateShadow(store,{limit=500}={}){
 if(!Number.isInteger(limit)||limit<1||limit>500)throw fail('BAD_LIMIT','采样上限必须为1到500');
 const state=shadowStatus(store),approval=ruleTrialLedger(store);
 if(!state.active||state.policyId!==approval.selectedTrial) return {active:false,staleApproval:state.active,productionChanged:false,examined:0,selected:0,changes:[]};
 const samples=store.list('sources').filter(s=>s.id&&s.title).slice(0,limit);
 let selected=0,baselineAccepted=0,shadowAccepted=0;
 const changes=[];
 for(const source of samples){
  if(stableBucket(source.id)>=state.percentage)continue;
  const original=assessRealProblem(source);
  const alternative=trialPredict(state.policyId,original);
  selected++;
  baselineAccepted+=Number(original.qualified);
  shadowAccepted+=Number(alternative);
  if(original.qualified!==alternative)changes.push({sourceId:source.id,title:source.title,url:source.url,baseline:original.qualified,shadow:alternative});
 }
 return {active:true,policyId:state.policyId,percentage:state.percentage,examined:samples.length,selected,baselineAccepted,shadowAccepted,
  changedCount:changes.length,changes:changes.slice(0,30),productionChanged:false,
  note:'只读影子比较：按原始线索ID稳定分桶，比例不是随机用户分流；没有修改正式判定或候选机会。'};
}
export function recordShadowSnapshot(store,{expected_revision}={}){
 const state=shadowStatus(store);
 if(expected_revision!==state.revision)throw fail('REVISION_CONFLICT','影子测试状态已变更，请刷新',409);
 const report=evaluateShadow(store);
 if(!report.active)throw fail('NOT_ACTIVE','无有效的已审批影子测试',409);
 return store.transaction(()=>{
  store.put('discovery_rule_decisions',{id:rowId,active:state.active,policyId:state.policyId,percentage:state.percentage,
   lastRun:{...report,at:new Date().toISOString()},
   history:[...state.history,{action:'snapshot',at:new Date().toISOString(),selected:report.selected,changedCount:report.changedCount}].slice(-100)},expected_revision);
  store.event('discovery.shadow.snapshot',rowId,'owner',{selected:report.selected,changedCount:report.changedCount});
  return shadowStatus(store);
 });
}
