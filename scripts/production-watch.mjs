#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {releaseTarget} from './verify-release.mjs';
const SHA=/^[0-9a-f]{40}$/i;
const fail=(code)=>Object.assign(new Error(code),{code});
const recent=(at,now)=>{const date=Date.parse(at||'');return Number.isFinite(date)&&date<=now&&now-date<=86400000;};

/**
 * Independent liveness signal for a live canary. A healthy /api/health only
 * proves the HTTP process answers; a stalled in-process guard is detected by
 * its last durable monitor snapshot. These timestamps are operational hints,
 * not evidence that every source was inspected or every request was exposed.
 */
export function assessRolloutHeartbeat(heartbeat,{now=Date.now(),
 maxMonitorAgeMs=25*60_000,rolloutWarmupMs=3*60_000,clockSkewMs=2*60_000}={}){
 if(!heartbeat?.active)return {ok:true,status:'inactive',code:'OK',monitorAgeSeconds:null};
 if(!Number.isInteger(heartbeat.releaseRevision)||heartbeat.releaseRevision<1)
  return {ok:false,status:'unverified',code:'GUARD_REVISION_INVALID',monitorAgeSeconds:null};
 const transition=Date.parse(heartbeat.lastTransitionAt||'');
 if(heartbeat.lastTransition!=='release'||!Number.isFinite(transition)||
    transition>now+clockSkewMs)
  return {ok:false,status:'unverified',code:'GUARD_LAUNCH_UNVERIFIED',monitorAgeSeconds:null};
 const warming=now>=transition-clockSkewMs&&now-transition<=rolloutWarmupMs;
 if(heartbeat.latestMonitorReleaseRevision!==heartbeat.releaseRevision)
  return {ok:warming,status:warming?'warming':'unverified',
   code:warming?'GUARD_WARMING':'GUARD_RELEASE_MISMATCH',monitorAgeSeconds:null};
 const monitor=Date.parse(heartbeat.latestMonitorAt||'');
 if(!Number.isFinite(monitor))
  return {ok:warming,status:warming?'warming':'missing',
   code:warming?'GUARD_WARMING':'GUARD_SNAPSHOT_MISSING',monitorAgeSeconds:null};
 const delta=now-monitor;
 if(delta< -clockSkewMs)
  return {ok:false,status:'unverified',code:'GUARD_CLOCK_SKEW',monitorAgeSeconds:null};
 if(monitor<transition-clockSkewMs)
  return {ok:false,status:'unverified',code:'GUARD_SNAPSHOT_PRE_RELEASE',monitorAgeSeconds:null};
 if(delta>maxMonitorAgeMs)
  return {ok:false,status:'stale',code:'GUARD_SNAPSHOT_STALE',
   monitorAgeSeconds:Math.max(0,Math.round(delta/1000))};
 return {ok:true,status:'recent',code:'OK',
  monitorAgeSeconds:Math.max(0,Math.round(delta/1000))};
}

async function jsonGET(fetchImpl,url,header,timeoutMs){
 let response;
 try{response=await fetchImpl(url,{method:'GET',redirect:'error',
  signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json',...(header||{})}});}
 catch{throw fail('FETCH_FAILED');}
 if(response?.status!==200)throw fail('HTTP_'+(response?.status??'NO_RESPONSE'));
 if(!String(response.headers?.get('content-type')||'').includes('application/json'))throw fail('NOT_JSON');
 try{return await response.json();}catch{throw fail('INVALID_JSON');}
}
// Read-only, host-safe probe. Never include secrets or private research in output.
export async function probeProduction({url,expectedSha,watchToken,fetchImpl=fetch,
 allowHttpLoopback=false,timeoutMs=8000,now=Date.now()}={}){
 const result={state:'healthy',code:'OK',monitoring:'health_only',
  versionVerified:false,releaseCommit:null,rollout:null,rollbackAlert:null,
  guardStatus:'unavailable',guardMonitorAgeSeconds:null};
 let origin;
 try{origin=releaseTarget(url,{allowHttpLoopback});}catch(e){return {...result,state:'down',code:e.code||'BAD_TARGET'};}
 if(expectedSha&&(!SHA.test(expectedSha)))return {...result,state:'down',code:'BAD_EXPECTED_SHA'};
 try{
  const release=await jsonGET(fetchImpl,origin+'/api/release',null,timeoutMs);
  if(release?.application!=='opportunity-radar'||release.identified!==true||
     !SHA.test(release.commit||''))throw fail('INVALID_RELEASE_ID');
  result.releaseCommit=release.commit;
  if(expectedSha&&expectedSha.toLowerCase()!==release.commit)throw fail('RELEASE_MISMATCH');
  const health=await jsonGET(fetchImpl,origin+'/api/health',null,timeoutMs);
  if(health?.ok!==true||health.mode!=='local-first')throw fail('UNHEALTHY');
  result.versionVerified=true;
  if(!watchToken)return result;
  if(typeof watchToken!=='string'||watchToken.length<32)throw fail('INVALID_WATCH_TOKEN');
  const hb=await jsonGET(fetchImpl,origin+'/api/operations/watch',{'X-Radar-Watch-Key':watchToken},timeoutMs);
  if(hb?.application!=='opportunity-radar'||hb.watchVersion!==1||
      !Number.isInteger(hb.releaseRevision)||typeof hb.active!=='boolean'||
      hb.ownerDataIncluded!==false)throw fail('INVALID_WATCH_RESPONSE');
  result.monitoring='health_and_rollback';
  result.rollout={active:hb.active,percentage:hb.rolloutPercent,
   releaseRevision:hb.releaseRevision,lastTransition:hb.lastTransition};
  if(hb.lastGuardAlert&&recent(hb.lastGuardAlert.at,now)&&
   ['APPROVAL_REVOKED','REVIEWED_REGRESSION'].includes(hb.lastGuardAlert.code)&&
   Number.isInteger(hb.lastGuardAlert.releaseRevision)&&hb.lastGuardAlert.releaseRevision>=1){
   result.rollbackAlert={code:hb.lastGuardAlert.code,at:hb.lastGuardAlert.at,
    releaseRevision:hb.lastGuardAlert.releaseRevision};
  }
  const guard=assessRolloutHeartbeat(hb,{now});
  result.guardStatus=guard.status;
  result.guardMonitorAgeSeconds=guard.monitorAgeSeconds;
  if(!guard.ok){result.state='down';result.code=guard.code;}
  else if(guard.status==='warming')result.code=guard.code;
  return result;
 }catch(e){
  return {...result,state:'down',code:e.code||'PROBE_FAILED',monitoring:watchToken?'watch_unavailable':result.monitoring};
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const data=await probeProduction({url:process.env.RADAR_PRODUCTION_URL,
  expectedSha:process.env.RADAR_EXPECTED_DEPLOY_SHA||undefined,
  watchToken:process.env.RADAR_WATCH_TOKEN||undefined});
 const out=process.env.RADAR_WATCH_REPORT||'';
 if(out)writeFileSync(out,JSON.stringify(data)+'\n');
 process.stdout.write(JSON.stringify(data)+'\n');
 // Alert management handles reported failures; a down probe is not silently a green check.
 if(data.state==='down')process.exitCode=2;
}
