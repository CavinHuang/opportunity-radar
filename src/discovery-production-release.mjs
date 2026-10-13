import {createHash} from 'node:crypto';
import {releasePreflight,releasePreflightHistory} from './discovery-release-preflight.mjs';
import {ruleTrialLedger} from './discovery-rule-approval.mjs';
import {assessRealProblem} from './real-problem.mjs';
const key='real_problem_production_release';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const bucket=id=>parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0,8),16)%100;
export function productionRuleStatus(store){
 const row=store.get('discovery_rule_decisions',key);
 return {revision:row?.revision||0,policyId:row?.policyId||null,percentage:row?.percentage||0,
   baseline:'real_problem_v1',history:row?.history||[],scope:'opportunity_scan_candidates_only'};
}
export function selectProductionProblem(store,source){
 const baseline=assessRealProblem(source);
 const release=productionRuleStatus(store);
 if(release.policyId!=='require_workaround'||ruleTrialLedger(store).selectedTrial!==release.policyId||bucket(source.id)>=release.percentage)return {...baseline,productionVariant:'real_problem_v1'};
 return {...baseline,qualified:baseline.qualified&&baseline.flags.workaround,productionVariant:'require_workaround_v1'};
}
export function changeProductionRule(store,{action,policy_id,percentage,evidence_hash,reason,expected_revision}={}){
 const note=String(reason||'').trim(),prev=productionRuleStatus(store);
 if(expected_revision!==prev.revision)throw fail('REVISION_CONFLICT','生产规则状态已变化',409);
 if(!['release','rollback'].includes(action))throw fail('BAD_ACTION','只支持发布或回滚');
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','需要12到500字符的操作理由');
 if(action==='release'){
  // Initial production rollout intentionally supports only a *stricter* filter.
  if(policy_id!=='require_workaround')throw fail('UNSAFE_VARIANT','初始生产发布仅支持更严格的替代做法规则',409);
  if(!Number.isInteger(percentage)||percentage<1||percentage>5)throw fail('BAD_PERCENTAGE','生产灰度比例只能为1到5%',409);
  const current=releasePreflight(store),history=releasePreflightHistory(store);
  const saved=history.records.at(-1);
  if(!current.ready||!saved||saved.policyId!==policy_id||saved.evidenceHash!==current.evidenceHash||evidence_hash!==saved.evidenceHash)
   throw fail('STALE_PREFLIGHT','上线证据缺失或已变化，请重新验收',409);
  if(prev.policyId)throw fail('ALREADY_RELEASED','生产规则已发布，请先回滚',409);
 }else if(!prev.policyId)throw fail('NOT_RELEASED','当前没有可回滚的生产规则',409);
 return store.transaction(()=>{
  const next=store.put('discovery_rule_decisions',{id:key,policyId:action==='release'?policy_id:null,
   percentage:action==='release'?percentage:0,history:[...prev.history,{action,policyId:action==='release'?policy_id:prev.policyId,
    percentage:action==='release'?percentage:prev.percentage,evidenceHash:action==='release'?evidence_hash:null,reason:note,at:new Date().toISOString()}].slice(-100)},expected_revision);
  store.event('discovery.production_rule.changed',key,'owner',{action,revision:next.revision});
  return productionRuleStatus(store);
 });
}
