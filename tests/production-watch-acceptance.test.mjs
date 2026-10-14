import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProductionAcceptance,summarizeProductionReadiness,markdownEvidence} from '../scripts/production-watch-acceptance.mjs';

const COMMIT='a'.repeat(40);
const good={state:'healthy',code:'OK',monitoring:'health_and_rollback',versionVerified:true,
 releaseCommit:COMMIT,guardStatus:'inactive',rollbackAlert:null};
test('production readiness presence is not live verification',()=>{
 const missing=summarizeProductionReadiness();
 assert.equal(missing.status,'not_configured');
 assert.equal(missing.liveVerified,false);
 const partial=summarizeProductionReadiness({hasOrigin:true,hasPin:true});
 assert.equal(partial.status,'partially_configured');
 const present=summarizeProductionReadiness({hasOrigin:true,hasPin:true,hasWatchToken:true});
 assert.equal(present.status,'credentials_present_unverified');
 assert.equal(present.liveVerified,false);
 assert.ok(!JSON.stringify(present).includes(COMMIT));
});
test('manual acceptance requires pinned SHA and live protected watcher',()=>{
 assert.deepEqual(evaluateProductionAcceptance(good,{manual:true,requireRollback:true,requirePin:true,pinnedSha:COMMIT}),
 {status:'accepted',passed:true,code:'MANUAL_ACCEPTANCE_VERIFIED'});
 assert.equal(evaluateProductionAcceptance(good,{manual:true,pinnedSha:undefined}).code,'MISSING_DEPLOY_PIN');
 assert.equal(evaluateProductionAcceptance(good,{manual:true,pinnedSha:'b'.repeat(40)}).code,'DEPLOY_PIN_MISMATCH');
 assert.equal(evaluateProductionAcceptance({...good,monitoring:'health_only'},{
  manual:true,pinnedSha:COMMIT}).code,'ROLLBACK_MONITOR_NOT_VERIFIED');
 assert.equal(evaluateProductionAcceptance({...good,state:'down',code:'GUARD_SNAPSHOT_STALE'},{
  manual:true,pinnedSha:COMMIT}).code,'GUARD_SNAPSHOT_STALE');
 assert.equal(evaluateProductionAcceptance({...good,guardStatus:'warming'},{
  manual:true,pinnedSha:COMMIT}).code,'LIVE_GUARD_WARMING');
 assert.equal(evaluateProductionAcceptance({...good,versionVerified:false},{manual:true,pinnedSha:COMMIT}).code,
  'NO_VERIFIED_RELEASE');
});
test('explicitly reduced manual checks are successful only as limited, never fully accepted',()=>{
 assert.equal(evaluateProductionAcceptance(good,{manual:true,requirePin:false,pinnedSha:undefined}).status,'limited');
 assert.equal(evaluateProductionAcceptance(good,{manual:true,requireRollback:false,pinnedSha:COMMIT}).status,'limited');
 assert.equal(evaluateProductionAcceptance({...good,monitoring:'health_only'},{
  manual:true,requireRollback:false,pinnedSha:COMMIT}).status,'limited');
 const scheduled=evaluateProductionAcceptance({...good,monitoring:'health_only'},{
  manual:false});
 assert.equal(scheduled.passed,true);
 assert.equal(scheduled.status,'limited');
 const periodic=evaluateProductionAcceptance(good,{manual:false});
 assert.equal(periodic.status,'observed');
});
test('report summary includes only bounded status fields, not token, private URL or research records',()=>{
 const result=evaluateProductionAcceptance(good,{manual:true,pinnedSha:COMMIT});
 const summary=markdownEvidence({...good,ownerSecret:'owner-private-token',url:'https://secret.example/a',
  rawPost:'Please keep this private'},result);
 assert.match(summary,/accepted/);
 assert.match(summary,new RegExp(COMMIT));
 assert.ok(!summary.includes('owner-private-token'));
 assert.ok(!summary.includes('secret.example'));
 assert.ok(!summary.includes('Please keep this private'));
 assert.equal(evaluateProductionAcceptance({},{}).code,'NO_PROBE_EVIDENCE');
 assert.equal(evaluateProductionAcceptance(null,{}).passed,false);
});
