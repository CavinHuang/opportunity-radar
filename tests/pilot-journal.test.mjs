import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {saveRunReceipt,listRunReceipts,receiptSummary} from '../src/pilot-journal.mjs';
import {parseTimeoutMinutes} from '../src/pilot-supervisor.mjs';

test('pilot timeout configuration has a bounded default and rejects unsafe values',()=>{
 assert.equal(parseTimeoutMinutes(undefined),90);
 assert.equal(parseTimeoutMinutes('35'),35);
 for(const value of ['0','241','1.5','Infinity','what','-4'])assert.throws(()=>parseTimeoutMinutes(value),{code:'BAD_TIMEOUT'});
});
test('private journal allows only safe metadata and restricts permissions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-private-receipts-'));
 try{
  const item={id:randomUUID(),projectId:'project-001',taskId:'task-001',provider:'codex',
   status:'local_process_exited_zero',startedAt:'2026-10-10T11:00:00Z',endedAt:'2026-10-10T11:01:00Z',
   headBefore:'a'.repeat(40),headAfter:'b'.repeat(40),changedFileCount:3,
   prompt:'MY PRIVATE INTERVIEW',bearer:'SECRET_AGENT_TOKEN',environment:{RADAR_OWNER_TOKEN:'OWNER_PRIVATE'}};
  const path=saveRunReceipt(item,{dir});
  const raw=readFileSync(path,'utf8');
  assert.ok(!raw.includes('PRIVATE'));
  assert.ok(!raw.includes('SECRET'));
  // POSIX mode bits are not enforced by Windows filesystems (0o600 reads back as 0o666);
  // the chmod-0600 security requirement itself stays in force and is asserted on POSIX.
  if(process.platform!=='win32'){
    assert.equal((lstatSync(path).mode&0o777),0o600);
    assert.equal((lstatSync(dir).mode&0o777),0o700);
  }
  const records=listRunReceipts({projectId:'project-001',dir});
  assert.equal(records.length,1);
  assert.equal(records[0].status,'local_process_exited_zero');
  assert.equal(records[0].changedFileCount,3);
  assert.equal(records[0].manualReviewRequired,true);
  assert.equal(listRunReceipts({projectId:'another-project',dir}).length,0);
  assert.equal(receiptSummary(item).deliverySubmitted,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('missing journal yields an empty read-only status without creating files',()=>{
 const dir=join(tmpdir(),'radar-nonexistent-journal-'+randomUUID());
 assert.deepEqual(listRunReceipts({projectId:'project',dir}),[]);
});
