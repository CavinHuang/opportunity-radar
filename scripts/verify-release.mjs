#!/usr/bin/env node
// Read-only release attestation: no owner credentials, no database mutations.
import {pathToFileURL} from 'node:url';

const sha=/^[0-9a-f]{40}$/i;
const loopback=new Set(['127.0.0.1','[::1]','localhost']);
const fail=(code,message)=>Object.assign(new Error(message),{code});

export function releaseTarget(url,{allowHttpLoopback=false}={}){
 let u;
 try{u=new URL(url);}catch{throw fail('BAD_URL','Provide an absolute HTTPS production URL');}
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!u.hostname)
  throw fail('BAD_URL','Supply only the site origin, without credentials, path, query or hash');
 if(u.protocol==='https:')return u.origin;
 if(u.protocol==='http:'&&allowHttpLoopback&&loopback.has(u.hostname))return u.origin;
 throw fail('INSECURE_URL','Only HTTPS production URLs are allowed');
}
export async function verifyRelease({url,expectedSha,allowHttpLoopback=false,fetchImpl=fetch,timeoutMs=8000}={}){
 if(typeof expectedSha!=='string'||!sha.test(expectedSha))
  throw fail('BAD_EXPECTED_SHA','Use the complete 40-character expected Git commit SHA');
 const origin=releaseTarget(url,{allowHttpLoopback});
 const get=async(path)=>{
  let response;
  try{response=await fetchImpl(origin+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:path==='/app.js'?'application/javascript':'application/json'}});}
  catch{throw fail('FETCH_FAILED','Cannot reach '+path+' without redirect or timeout');}
  if(!response||response.status!==200)throw fail('HTTP_STATUS','Expected HTTP 200 from '+path+', got '+(response?.status??'no response'));
  const type=String(response.headers?.get('content-type')||'').toLowerCase();
  if(path==='/app.js'){
   if(!type.includes('javascript'))throw fail('BAD_FRONTEND','The deployed frontend does not serve application JavaScript');
   await response.body?.cancel?.();
   return true;
  }
  if(!type.includes('application/json'))throw fail('BAD_RESPONSE','Expected JSON from '+path);
  try{return await response.json();}catch{throw fail('BAD_RESPONSE','Invalid JSON at '+path);}
 };
 const release=await get('/api/release');
 if(release?.application!=='opportunity-radar'||release?.identified!==true||typeof release?.version!=='string')
  throw fail('NO_RELEASE_ID','Production deployment does not expose a valid release identity');
 if(release.commit!==expectedSha.toLowerCase())
  throw fail('RELEASE_MISMATCH','Deployed commit does not match the expected Git commit SHA');
 const health=await get('/api/health');
 if(health?.ok!==true||health?.mode!=='local-first')throw fail('UNHEALTHY','Deployment did not pass its public health probe');
 await get('/app.js');
 return {verified:true,origin,commit:release.commit,version:release.version,
  checks:['release_sha_match','health_ok','frontend_served'],
  scope:'Public read-only HTTP checks only; no owner data, database backup or service logs were examined.'};
}
function parseArgs(argv){
 const options={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];
  if(key==='--allow-http-loopback'){options.allowHttpLoopback=true;continue;}
  if(key==='--url'&&argv[i+1]){options.url=argv[++i];continue;}
  if(key==='--expected-sha'&&argv[i+1]){options.expectedSha=argv[++i];continue;}
  throw fail('BAD_ARGUMENT','Unknown or incomplete argument: '+key);
 }
 return options;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const report=await verifyRelease(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
 }catch(e){
  process.stderr.write((e.code||'VERIFICATION_FAILED')+': '+e.message+'\n');
  process.exitCode=1;
 }
}
