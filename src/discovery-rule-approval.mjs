import {replayDiscoveryRules} from './discovery-rule-replay.mjs';
const id='real_problem_rule_trials';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
export function ruleTrialLedger(store){
 const row=store.get('discovery_rule_decisions',id);
 return {revision:row?.revision||0,selectedTrial:row?.selectedTrial||null,history:row?.history||[],liveRuleChanged:false,
  note:'此账本仅管理候选规则的试验审批，不修改线上发现规则。'};
}
export function decideRuleTrial(store,{action,policy_id,reason,expected_revision}={}){
 const previous=ruleTrialLedger(store);
 if(expected_revision!==previous.revision)throw fail('REVISION_CONFLICT','审批记录已更新，请刷新后操作',409);
 if(!['approve_trial','reject','rollback_trial'].includes(action))throw fail('BAD_ACTION','无效操作');
 const note=String(reason||'').trim();
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','理由需要 12 至 500 个字符');
 const replay=replayDiscoveryRules(store);
 const policy=replay.policies.find(x=>x.id===policy_id);
 if(!policy)throw fail('BAD_POLICY','候选规则不存在');
 if(action==='approve_trial'){
  if(replay.sampleSize<20)throw fail('INSUFFICIENT_EVIDENCE','至少需要20条有效人工标注才能批准试验',409);
  if(policy.delta.falseNegative>0||policy.delta.falsePositive>0)
   throw fail('REGRESSION_DETECTED','候选规则在已标注样本上造成误报或漏报增加，拒绝审批',409);
 }
 if(action==='rollback_trial'&&previous.selectedTrial!==policy_id)
  throw fail('TRIAL_NOT_ACTIVE','只能撤销当前批准的试验候选规则',409);
 const nextSelection=action==='approve_trial'?policy_id:action==='rollback_trial'?null:previous.selectedTrial;
 const history=[...previous.history,{action,policyId:policy_id,reason:note,at:new Date().toISOString(),
  sampleSize:replay.sampleSize,delta:policy.delta,priorSelectedTrial:previous.selectedTrial,nextSelectedTrial:nextSelection}];
 // Atomic version fence; store records are versioned. Never touch live classification config.
 const result=store.put('discovery_rule_decisions',{id,selectedTrial:nextSelection,history},expected_revision);
 store.event('discovery.rule_trial.decision',id,'owner',{action,policyId:policy_id,revision:result.revision});
 return ruleTrialLedger(store);
}
