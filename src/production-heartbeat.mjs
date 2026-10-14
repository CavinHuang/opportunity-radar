import {productionRuleStatus} from './discovery-production-release.mjs';
import {productionMonitorHistory} from './discovery-production-monitor.mjs';

// Dedicated read-only watch identity, never expose study data or owner credentials.
export function productionHeartbeat(store){
 const state=productionRuleStatus(store);
 const transition=state.history.at(-1)||null;
 const latest=productionMonitorHistory(store).latest;
 const alert=store.eventsLatest(80).find(x=>x.kind==='discovery.production_guard.alert')||null;
 return {application:'opportunity-radar',watchVersion:1,
  releaseRevision:state.revision,active:!!state.policyId,rolloutPercent:state.percentage,
  lastTransition:transition?.action||null,lastTransitionAt:transition?.at||null,
  latestMonitorAt:latest?.at||null,latestMonitorReleaseRevision:latest?.releaseRevision??null,
  lastAutoRollback:transition?.action==='rollback'&&(
   String(transition.reason||'').includes('自动')||
   String(transition.reason||'').includes('人工确认的已暴露规则退化'))?
   {revision:state.revision,at:transition.at}:null,
  lastGuardAlert:alert?{code:alert.detail?.code||'UNKNOWN',
   at:alert.created_at||null,releaseRevision:alert.detail?.releaseRevision??null}:null,
  ownerDataIncluded:false};
}
