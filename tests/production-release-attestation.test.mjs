import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {releaseMetadata} from '../src/release-metadata.mjs';
import {releaseTarget,verifyRelease} from '../scripts/verify-release.mjs';

const SHA='a'.repeat(40);
const fakeFetch=async(url,opts)=>{
 assert.equal(opts.method,'GET');
 assert.equal(opts.redirect,'error');
 const path=new URL(url).pathname;
 if(path==='/api/release')return Response.json({application:'opportunity-radar',version:'2.23.0',commit:SHA,identified:true});
 if(path==='/api/health')return Response.json({ok:true,mode:'local-first'});
 if(path==='/app.js')return new Response('const ok=true;', {headers:{'Content-Type':'application/javascript'}});
 return new Response('not found',{status:404});
};
test('release metadata never echoes secrets or invalid environment',()=>{
 const good=releaseMetadata({releaseSha:' '+SHA.toUpperCase()+' '});
 assert.equal(good.commit,SHA);
 assert.equal(good.identified,true);
 assert.equal(typeof good.version,'string');
 assert.equal(releaseMetadata({releaseSha:'abc;RADAR_OWNER_TOKEN=secret'}).commit,null);
 assert.equal(releaseMetadata({releaseSha:null}).identified,false);
 assert.ok(!JSON.stringify(good).includes('secret'));
});
test('probe rejects insecure, credential-bearing, redirected and wrong-target URLs before writing',async()=>{
 assert.throws(()=>releaseTarget('http://production.example'),{code:'INSECURE_URL'});
 assert.throws(()=>releaseTarget('https://user:password@production.example'),{code:'BAD_URL'});
 assert.throws(()=>releaseTarget('https://production.example/foo'),{code:'BAD_URL'});
 assert.throws(()=>releaseTarget('https://production.example/?token=secret'),{code:'BAD_URL'});
 assert.throws(()=>releaseTarget('http://evil.example',{allowHttpLoopback:true}),{code:'INSECURE_URL'});
 assert.equal(releaseTarget('http://127.0.0.1:4177',{allowHttpLoopback:true}),'http://127.0.0.1:4177');
 await assert.rejects(verifyRelease({url:'https://production.example',expectedSha:'bad',fetchImpl:fakeFetch}),{code:'BAD_EXPECTED_SHA'});
 await assert.rejects(verifyRelease({url:'https://production.example',expectedSha:'b'.repeat(40),fetchImpl:fakeFetch}),{code:'RELEASE_MISMATCH'});
 await assert.rejects(verifyRelease({url:'https://production.example',expectedSha:SHA,fetchImpl:async()=>{throw Error('redirect denied')}}),{code:'FETCH_FAILED'});
});
test('probe refuses health success without valid deployed identity and frontend',async()=>{
 const noSha=async(url,opts)=>{
  if(new URL(url).pathname==='/api/release')return Response.json({application:'opportunity-radar',version:'2.23.0',commit:null,identified:false});
  return fakeFetch(url,opts);
 };
 await assert.rejects(verifyRelease({url:'https://production.example',expectedSha:SHA,fetchImpl:noSha}),{code:'NO_RELEASE_ID'});
 const noFrontend=async(url,opts)=>{
  if(new URL(url).pathname==='/app.js')return new Response('no',{headers:{'Content-Type':'text/html'}});
  return fakeFetch(url,opts);
 };
 await assert.rejects(verifyRelease({url:'https://production.example',expectedSha:SHA,fetchImpl:noFrontend}),{code:'BAD_FRONTEND'});
 const pass=await verifyRelease({url:'https://production.example',expectedSha:SHA,fetchImpl:fakeFetch});
 assert.deepEqual(pass.checks,['release_sha_match','health_ok','frontend_served']);
 assert.equal(pass.verified,true);
});
test('real localhost HTTP server exposes only sanitized release fingerprint and keeps owner API gated',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-release-'));
 const previous={db:process.env.RADAR_DB,token:process.env.RADAR_OWNER_TOKEN,sha:process.env.RADAR_RELEASE_SHA};
 process.env.RADAR_DB=join(directory,'app.sqlite');
 process.env.RADAR_OWNER_TOKEN='private-test-only-owner';
 process.env.RADAR_RELEASE_SHA=SHA;
 const {createServer,closeStore}=await import('../src/server.mjs');
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const pub=await fetch(base+'/api/release');
  assert.equal(pub.status,200);
  const data=await pub.json();
  assert.equal(data.commit,SHA);
  assert.equal(data.identified,true);
  assert.ok(!JSON.stringify(data).includes('private-test-only-owner'));
  assert.equal((await fetch(base+'/api/opportunities')).status,401);
  const report=await verifyRelease({url:base,expectedSha:SHA,allowHttpLoopback:true});
  assert.equal(report.verified,true);
  assert.equal(report.commit,SHA);
  process.env.RADAR_RELEASE_SHA='';
  assert.equal((await (await fetch(base+'/api/release')).json()).identified,false);
  await assert.rejects(verifyRelease({url:base,expectedSha:SHA,allowHttpLoopback:true}),{code:'NO_RELEASE_ID'});
 }finally{
  await new Promise(resolve=>server.close(resolve));
  closeStore();
  for(const [key,value] of [['RADAR_DB',previous.db],['RADAR_OWNER_TOKEN',previous.token],['RADAR_RELEASE_SHA',previous.sha]]){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  rmSync(directory,{recursive:true,force:true});
 }
});
