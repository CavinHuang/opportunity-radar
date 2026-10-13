import {captureProductionMonitor,productionMonitorHistory} from './discovery-production-monitor.mjs';
import {productionRuleStatus,changeProductionRule} from './discovery-production-release.mjs';
import {ruleTrialLedger} from './discovery-rule-approval.mjs';

export function createProductionGuard(store,{clock=Date.now,logger=console,intervalMs=60_000,reviewEveryMs=15*60_000}={}){
 let timer=null,running=false,stopped=false;
 function due(now){
  const last=productionMonitorHistory(store).latest?.at;
  return !last||!Number.isFinite(Date.parse(last))||now-Date.parse(last)>=reviewEveryMs;
 }
 function tick(){
  if(stopped||running)return {skipped:'stopped_or_running'};
  running=true;
  try{
   const release=productionRuleStatus(store);
   if(!release.policyId)return {skipped:'no_release'};
   const approval=ruleTrialLedger(store);
   if(approval.selectedTrial!==release.policyId){
    const rolled=changeProductionRule(store,{action:'rollback',reason:'原规则审批已撤销，自动恢复基线并记录告警',expected_revision:release.revision});
    store.event('discovery.production_guard.alert','real_problem_production_release','system',
      {code:'APPROVAL_REVOKED',at:new Date(clock()).toISOString(),releaseRevision:rolled.revision});
    logger.warn?.('[Radar production guard] revoked approval: baseline restored');
    return {autoRollback:true,reason:'APPROVAL_REVOKED'};
   }
   if(!due(clock()))return {skipped:'not_due'};
   const previous=productionMonitorHistory(store);
   const result=captureProductionMonitor(store,{
    reason:'系统周期巡检：核对现有人工标注与正式规则差异',
    expected_revision:previous.revision,expected_release_revision:release.revision
   });
   if(result.snapshot.autoRollback){
    store.event('discovery.production_guard.alert','real_problem_production_release','system',
      {code:'REVIEWED_REGRESSION',at:new Date(clock()).toISOString(),reviewed:result.snapshot.reviewed,
       deltaFalseNegative:result.snapshot.falseNegativeDelta,deltaFalsePositive:result.snapshot.falsePositiveDelta});
    logger.warn?.('[Radar production guard] reviewed regression: baseline restored');
   }
   return {checked:true,autoRollback:result.snapshot.autoRollback,reviewed:result.snapshot.reviewed};
  }catch(e){
   logger.error?.('[Radar production guard] '+e.message);
   return {error:e.code||'GUARD_FAILED'};
  }finally{running=false;}
 }
 return {
  tick,
  start(){if(timer)return;stopped=false;timer=setInterval(tick,intervalMs);timer.unref?.();queueMicrotask(tick);},
  stop(){stopped=true;if(timer)clearInterval(timer);timer=null;},
  get running(){return running;}
 };
}
