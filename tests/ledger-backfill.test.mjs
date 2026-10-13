import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';

test('ledger→growth backfill never resurrects retracted entries',()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-backfill-'));
 const file=join(dir,'db.sqlite');
 try{
  const db=openDatabase(file);
  // 模拟镜像功能上线前的遗留数据：已撤回的实际账本条目，从未生成过镜像行。
  db.put('ledger',{id:'legacy-1',projectId:'p1',type:'income',value:99,unit:'count',source:'manual',
   actual:true,at:'2026-09-01T10:00:00.000Z',createdAt:'2026-09-01T10:00:00.000Z',
   retractedAt:'2026-09-02T10:00:00.000Z',retractReason:'误录后撤回'});
  db.close();
  // 重新打开数据库触发一次性回填：撤回状态不得被复活为 active 增长数据。
  const db2=openDatabase(file);
  try{
   assert.equal(db2.list('growth_metrics').filter(x=>x.status==='active'&&x.dedupKey==='ledger:legacy-1').length,0);
  }finally{db2.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
