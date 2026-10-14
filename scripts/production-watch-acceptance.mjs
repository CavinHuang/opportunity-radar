#!/usr/bin/env node
import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const SHA=/^[0-9a-f]{40}$/i;
const approved=new Set(['recent','inactive']);
export function evaluateProductionAcceptance(report,{manual=false,requireRollback=true,requirePin=true,pinnedSha}={}){
 if(!report||!['healthy','down'].includes(report.state))
  return {status:'failed',passed:false,code:'NO_PROBE_EVIDENCE'};
 if(report.state==='down')
  return {status:'failed',passed:false,code:report.code||'PROBE_FAILED'};
 if(report.versionVerified!==true||!SHA.test(report.releaseCommit||''))
  return {status:'failed',passed:false,code:'NO_VERIFIED_RELEASE'};
 if(manual&&requirePin&&(!pinnedSha||!SHA.test(pinnedSha)))
  return {status:'failed',passed:false,code:'MISSING_DEPLOY_PIN'};
 if(manual&&requirePin&&report.releaseCommit.toLowerCase()!==pinnedSha.toLowerCase())
  return {status:'failed',passed:false,code:'DEPLOY_PIN_MISMATCH'};
 if(report.monitoring==='health_and_rollback'&&
   !approved.has(report.guardStatus||'unavailable')){
  if(manual&&requireRollback)
   return {status:'failed',passed:false,code:report.guardStatus==='warming'?
    'LIVE_GUARD_WARMING':'LIVE_GUARD_NOT_VERIFIED'};
  return {status:'limited',passed:true,code:'ROLLBACK_MONITOR_NOT_CONFIRMED'};
 }
 if(report.monitoring!=='health_and_rollback'){
  if(manual&&requireRollback)
   return {status:'failed',passed:false,code:'ROLLBACK_MONITOR_NOT_VERIFIED'};
  return {status:'limited',passed:true,code:'PUBLIC_HEALTH_ONLY'};
 }
 if(manual&&(!requireRollback||!requirePin))
  return {status:'limited',passed:true,code:'OPERATOR_REDUCED_ACCEPTANCE_CHECKS'};
 return {status:manual?'accepted':'observed',passed:true,
  code:manual?'MANUAL_ACCEPTANCE_VERIFIED':'PRODUCTION_WATCH_HEALTHY'};
}
export function summarizeProductionReadiness({hasOrigin=false,hasPin=false,hasWatchToken=false}={}){
 return {status:!hasOrigin?'not_configured':!hasPin||!hasWatchToken?'partially_configured':'credentials_present_unverified',
  configured:{origin:!!hasOrigin,pinnedSha:!!hasPin,protectedWatchToken:!!hasWatchToken},
  liveVerified:false,
  note:'Configuration presence alone is NOT proof that the site is deployed, live, or watched. Inspect a real manually dispatched or scheduled watch result.'};
}
export function markdownEvidence(report,assessment){
 const safeCode=String(assessment.code||'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,80);
 const commit=SHA.test(report?.releaseCommit||'')?report.releaseCommit:'not verified';
 const monitoring=['health_only','health_and_rollback','watch_unavailable'].includes(report?.monitoring)?
  report.monitoring:'unavailable';
 const status=String(assessment.status||'failed').replace(/[^a-z_]/g,'');
 return [
  '## Opportunity Radar · independent production watch',
  '',
  '| Check | Observed |','|---|---|',
  '| Result | '+status+' |',
  '| Diagnostic | `'+safeCode+'` |',
  '| Deployed SHA | `'+commit+'` |',
  '| Monitoring capability | `'+monitoring+'` |',
  '| Active rollout watch | `'+String(report?.guardStatus||'unavailable').replace(/[^a-z_]/g,'')+'` |',
  '| HTTP release verified | '+(report?.versionVerified===true?'yes':'no')+' |',
  '',
  'This is a **read-only external HTTP observation**, not proof of deployed source code authenticity, data integrity, or valid human labels.',
  'A green configuration-presence check does **not** count as production acceptance.'
 ].join('\n')+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const report=JSON.parse(readFileSync(process.env.RADAR_WATCH_REPORT||'watch-result.json','utf8'));
  const manual=process.env.GITHUB_EVENT_NAME==='workflow_dispatch';
  const assessment=evaluateProductionAcceptance(report,{
   manual,requireRollback:process.env.RADAR_REQUIRE_ROLLBACK!=='false',
   requirePin:process.env.RADAR_REQUIRE_PIN!=='false',
   pinnedSha:process.env.RADAR_EXPECTED_DEPLOY_SHA||undefined});
  const summary=markdownEvidence(report,assessment);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  process.stdout.write(JSON.stringify(assessment)+'\n');
  if(!assessment.passed)process.exitCode=1;
 }catch{
  process.stderr.write('NO_PROBE_EVIDENCE\n');
  process.exitCode=1;
 }
}
