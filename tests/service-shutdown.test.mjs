import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServiceShutdown} from '../src/service-shutdown.mjs';

test('SIGTERM/SIGINT share one idempotent stop-before-close sequence',()=>{
 const calls=[];
 const scheduler={stop(){calls.push('scheduler.stop')}};
 const productionGuard={stop(){calls.push('productionGuard.stop')}};
 const server={close(cb){calls.push('server.close');cb();}};
 const shutdown=createServiceShutdown({server,scheduler,productionGuard});
 assert.equal(shutdown(),true);
 assert.equal(shutdown(),false);
 assert.deepEqual(calls,['scheduler.stop','productionGuard.stop','server.close']);
});
test('shutdown reports HTTP close errors and never retries writes',()=>{
 const calls=[];
 const error=new Error('close failed');
 const shutdown=createServiceShutdown({
  scheduler:{stop(){calls.push('scheduler')}},
  productionGuard:{stop(){calls.push('guard')}},
  server:{close(cb){calls.push('close');cb(error)}},
  onCloseError:e=>{assert.equal(e,error);calls.push('error')}
 });
 assert.equal(shutdown(),true);
 assert.equal(shutdown(),false);
 assert.deepEqual(calls,['scheduler','guard','close','error']);
});

async function testActualSignal(signal){
 const temp=mkdtempSync(join(tmpdir(),'radar-shutdown-'+signal.toLowerCase()+'-'));
 const src=resolve(new URL('../src/server.mjs',import.meta.url).pathname);
 const child=spawn(process.execPath,[src],{
  cwd:resolve(new URL('..',import.meta.url).pathname),
  env:{...process.env,RADAR_OWNER_TOKEN:'signal-test-owner',
   RADAR_DB:join(temp,'db.sqlite'),RADAR_HOST:'127.0.0.1',RADAR_PORT:'0'},
  stdio:['ignore','pipe','pipe']
 });
 let stdout='',stderr='';
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',part=>{stdout+=part;});
 child.stderr.on('data',part=>{stderr+=part;});
 let finished=false;
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Startup timed out: '+stdout+' '+stderr)),8000);
   child.stdout.on('data',function onData(){
    if(stdout.includes('Opportunity Radar running at')){
     clearTimeout(timer);child.stdout.off('data',onData);resolve();
    }
   });
   child.once('error',e=>{clearTimeout(timer);reject(e);});
   child.once('exit',(code,sg)=>{if(!stdout.includes('Opportunity Radar running at')){
    clearTimeout(timer);reject(new Error('Early process exit '+code+' '+sg+' '+stderr));
   }});
  });
  assert.equal(child.kill(signal),true);
  const ended=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Shutdown timed out')),6000);
   child.once('exit',(code,sig)=>{clearTimeout(timer);resolve({code,sig});});
  });
  finished=true;
  assert.equal(ended.code,0,'signal='+signal+' stdout='+stdout+' stderr='+stderr);
  assert.equal(ended.sig,null);
 }finally{
  if(!finished&&child.exitCode===null)child.kill('SIGKILL');
  rmSync(temp,{recursive:true,force:true});
 }
}
test('live SQLite-backed HTTP service stops cleanly for Docker SIGTERM and CLI SIGINT',
 {skip:process.platform==='win32'},async()=>{
  await testActualSignal('SIGTERM');
  await testActualSignal('SIGINT');
 });
