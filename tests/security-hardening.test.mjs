import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'radar-hardening-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
// RADAR_OWNER_TOKEN is deliberately NOT set: this suite exercises the tokenless
// local mode, which is exactly where the DNS-rebinding guard matters.
const {createServer,closeStore}=await import('../src/server.mjs');

/** Raw HTTP request so the Host header can be set independently of the actual
 * connection target (fetch normalizes it, which would hide the attack). */
const raw=(port,path,{method='GET',host,origin,body,headers={}}={})=>new Promise((resolve,reject)=>{
  const payload=body===undefined?null:JSON.stringify(body);
  const req=http.request({host:'127.0.0.1',port,path,method,headers:{
    host:host||`127.0.0.1:${port}`,
    ...(origin?{origin}:{}),
    ...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),
    ...headers,
  }},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{let parsed=null;try{parsed=b?JSON.parse(b):null;}catch{parsed=null;}resolve({status:res.statusCode,body:parsed,raw:b});});});
  req.on('error',reject);if(payload)req.write(payload);req.end();
});

test('DNS rebinding guard and owner Idempotency-Key dedup on creation endpoints',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 try{
  // --- DNS rebinding guard (no owner token configured) ---
  assert.equal((await raw(port,'/api/health')).status,200);
  const rebound=await raw(port,'/api/dashboard',{host:'attacker.example'});
  assert.equal(rebound.status,403);assert.equal(rebound.body.error,'HOST_DENIED');
  // The rebinding hole: Host and Origin both carry the attacker hostname, so the
  // old Origin===Host check passed while the page talked to the local API.
  const post=await raw(port,'/api/opportunities',{method:'POST',host:'attacker.example',origin:'http://attacker.example',body:{title:'x',problem:'y',market:'z'}});
  assert.equal(post.status,403);assert.equal(post.body.error,'HOST_DENIED');
  assert.equal((await raw(port,'/api/dashboard',{host:`localhost:${port}`})).status,200);
  process.env.RADAR_ALLOWED_HOSTS='attacker.example';
  assert.equal((await raw(port,'/api/dashboard',{host:'attacker.example'})).status,200);
  delete process.env.RADAR_ALLOWED_HOSTS;
  assert.equal((await raw(port,'/api/dashboard',{host:'attacker.example'})).status,403);

  // --- Owner idempotency: header present → dedup; absent → unchanged behavior ---
  const key={'Idempotency-Key':'create-once-1'};
  const opp={title:'幂等键验证机会',problem:'重复提交不应产生两条记录',market:'中国大陆',sources:[{url:'https://example.com/idem'}]};
  const first=await raw(port,'/api/opportunities',{method:'POST',body:opp,headers:key});
  assert.equal(first.status,201);
  const second=await raw(port,'/api/opportunities',{method:'POST',body:opp,headers:key});
  assert.equal(second.status,201);assert.equal(second.body.item.id,first.body.item.id);
  const conflict=await raw(port,'/api/opportunities',{method:'POST',body:{...opp,title:'同一幂等键不能携带不同内容'},headers:key});
  assert.equal(conflict.status,409);assert.equal(conflict.body.error,'IDEMPOTENCY_CONFLICT');
  const listing=await raw(port,'/api/opportunities');
  assert.equal(listing.body.items.filter(x=>x.title==='幂等键验证机会').length,1);
  const third=await raw(port,'/api/opportunities',{method:'POST',body:{...opp,title:'无幂等键一'}});
  const fourth=await raw(port,'/api/opportunities',{method:'POST',body:{...opp,title:'无幂等键二'}});
  assert.equal(third.status,201);assert.equal(fourth.status,201);
  assert.notEqual(third.body.item.id,fourth.body.item.id);
  const overlong=await raw(port,'/api/opportunities',{method:'POST',body:opp,headers:{'Idempotency-Key':'k'.repeat(201)}});
  assert.equal(overlong.status,400);
 }finally{
  await new Promise(r=>server.close(r));
  closeStore();
  rmSync(dir,{recursive:true,force:true});
 }
});
