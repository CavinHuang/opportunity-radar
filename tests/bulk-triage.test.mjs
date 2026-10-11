import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'radar-bulk-triage-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
process.env.RADAR_OWNER_TOKEN='bulk-owner';
process.env.RADAR_AGENT_TOKEN='bulk-agent';
const {createServer,closeStore}=await import('../src/server.mjs');

test('bulk triage changes valid signals, skips converted/missing with reasons, and is auth-gated',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'bulk-owner'};
 const call=async(path,method='GET',body,headers=owner)=>{const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  const seed=async(title)=>(await call('/api/signals/manual','POST',{title,description:'走查合成信号，非真实消费者',url:'https://example.org/bulk/'+encodeURIComponent(title),market:'中国大陆'})).data.item.id;
  const s1=await seed('bulk-one'),s2=await seed('bulk-two'),s3=await seed('bulk-three'),s4=await seed('bulk-four');

  // 鉴权负例：无 owner key 一律 401（bulk 在 owner API 区内）。
  const noAuth=await call('/api/signals/bulk-triage','POST',{ids:[s1],status:'dismissed'},{});
  assert.equal(noAuth.status,401);
  // 参数负例。
  assert.equal((await call('/api/signals/bulk-triage','POST',{ids:[],status:'dismissed'})).status,400);
  assert.equal((await call('/api/signals/bulk-triage','POST',{ids:[s1],status:'archived'})).status,400);

  // s3 转换为机会后，批量忽略应跳过它而不是报错中断。
  const opp=await call('/api/opportunities','POST',{title:'已转换走查',problem:'p',market:'m',sources:[{url:'https://example.org/bulk/conv'}]});
  const conv=await call('/api/signals/'+s3+'/import','POST',{title:'已转换走查',problem:'p',market:'m'});
  assert.equal(conv.status,201);

  const r=await call('/api/signals/bulk-triage','POST',{ids:[s1,s2,s3,'missing-id',s1],status:'dismissed'});
  assert.equal(r.status,200);
  assert.equal(r.data.changed.length,2);
  assert.ok(r.data.changed.every(x=>x.status==='dismissed'));
  const skipCodes=Object.fromEntries(r.data.skipped.map(x=>[x.id,x.code]));
  assert.equal(skipCodes[s3],'SIGNAL_CONVERTED');
  assert.equal(skipCodes['missing-id'],'NOT_FOUND');
  const after=await call('/api/signals?status=dismissed');
  assert.ok(after.data.items.filter(x=>x.id===s1||x.id===s2).length===2);
  const stillNew=await call('/api/signals?status=new');
  assert.ok(stillNew.data.items.some(x=>x.id===s4),'未选中的信号不受影响');

  // 同批重复 ID 去重；已处于目标状态的信号逐条跳过并说明。
  const redo=await call('/api/signals/bulk-triage','POST',{ids:[s1,s1],status:'dismissed'});
  assert.equal(redo.data.changed.length,0);
  assert.equal(redo.data.skipped[0].code,'ALREADY_IN_STATUS');

  // 恢复（new）同样可用。
  const undo=await call('/api/signals/bulk-triage','POST',{ids:[s2],status:'new'});
  assert.equal(undo.data.changed.length,1);
  assert.equal(undo.data.changed[0].status,'new');
 }finally{
  await new Promise(r=>server.close(r));
  closeStore();
  rmSync(dir,{recursive:true,force:true});
 }
});
