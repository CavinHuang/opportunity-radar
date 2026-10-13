import {createHash} from 'node:crypto';
import {ruleTrialLedger} from './discovery-rule-approval.mjs';
import {shadowStatus} from './discovery-shadow.mjs';
import {replayDiscoveryRules} from './discovery-rule-replay.mjs';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const key='real_problem_release_preflight';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

export function releasePreflight(store){
 const approval=ruleTrialLedger(store),shadow=shadowStatus(store),replay=replayDiscoveryRules(store);
 const policy=replay.policies.find(p=>p.id===approval.selectedTrial);
 const runs=shadow.snapshots.filter(s=>s.policyId===approval.selectedTrial);
 const latest=runs.at(-1)||null;
 const checks={
  approved:Boolean(policy),
  shadowRecorded:Boolean(latest),
  shadowMatchesApproval:Boolean(latest&&latest.policyId===approval.selectedTrial),
  noObservedRegression:Boolean(policy&&policy.delta.falsePositive<=0&&policy.delta.falseNegative<=0&&latest&&
   latest.deltaFalsePositive<=0&&latest.deltaFalseNegative<=0&&!latest.autoStopped),
  sampleEnough:replay.sampleSize>=20&&Boolean(latest&&latest.reviewed>=5),
  shadowStopped:!shadow.active
 };
 const blockers=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
 const evidence={policyId:approval.selectedTrial,approvalRevision:approval.revision,shadowRevision:shadow.revision,
  replaySample:replay.sampleSize,ruleDelta:policy?.delta||null,shadowAt:latest?.at||null,
  shadowReviewed:latest?.reviewed||0,shadowDelta:latest?{falsePositive:latest.deltaFalsePositive,falseNegative:latest.deltaFalseNegative}:null,
  shadowAutoStopped:Boolean(latest?.autoStopped)};
 return {ready:blockers.length===0,checks,blockers,evidence,evidenceHash:digest(evidence),
  productionChanged:false,notice:'仅为上线前材料的保守一致性核查。人工挑选样本不能证明推广效果；不会自动切换生产规则。'};
}
export function releasePreflightHistory(store){
 const r=store.get('discovery_rule_decisions',key);
 return {revision:r?.revision||0,records:r?.records||[],productionChanged:false};
}
export function captureReleasePreflight(store,{reason,expected_revision}={}){
 const prev=releasePreflightHistory(store);
 if(expected_revision!==prev.revision)throw fail('REVISION_CONFLICT','验收记录已修改',409);
 const note=String(reason||'').trim();
 if(note.length<12||note.length>500)throw fail('REASON_REQUIRED','验收说明需要12到500字符');
 const report=releasePreflight(store);
 if(!report.ready)throw fail('PREFLIGHT_BLOCKED','上线前检查未全部通过：'+report.blockers.join(','),409);
 return store.transaction(()=>{
  // Versions and the evidence digest are saved as an immutable snapshot; never enable live rules.
  const record={...report.evidence,evidenceHash:report.evidenceHash,reason:note,capturedAt:new Date().toISOString(),
   status:'candidate_only_not_released'};
  const result=store.put('discovery_rule_decisions',{id:key,records:[...prev.records,record].slice(-50)},expected_revision);
  store.event('discovery.release.preflight',key,'owner',{policyId:record.policyId,hash:record.evidenceHash,revision:result.revision});
  return releasePreflightHistory(store);
 });
}
