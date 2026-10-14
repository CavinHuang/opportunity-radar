import {opportunityScanCandidates} from './opportunity-scan.mjs';
import {HOME_DISCOVERY_MAX_SIGNALS} from './opportunity-brief.mjs';

// Every homepage follow-up must resolve the same current candidate population.
// Identity, source dismissals and current production rule eligibility are still
// recomputed; saved AI output alone cannot authorize a stale candidate.
export function homeDiscoveryCandidates(store){
 return opportunityScanCandidates(store,{limit:50,maxSignals:HOME_DISCOVERY_MAX_SIGNALS,productDiscovery:true});
}
