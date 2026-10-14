#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {releaseTarget} from './verify-release.mjs';
const SHA=/^[0-9a-f]{40}$/i;
const fail=(code)=>Object.assign(new Error(code),{code});
const recent=(at,now)=>{const date=Date.parse(at||'');return Number.isFinite(date)&&date<=now&&now-date<=86400000;};
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
  versionVerified:false,releaseCommit:null,rollout:null,rollbackAlert:null};
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
   ['APPROVAL_REVOKED','REVIEWED_REGRESSION'].includes(hb.lastGuardAlert.code)){
   result.rollbackAlert={code:hb.lastGuardAlert.code,at:hb.lastGuardAlert.at,
    releaseRevision:hb.lastGuardAlert.releaseRevision};
  }
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
