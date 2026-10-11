import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {backupDatabase,verifyBackup,restoreDatabase,inspectRadarDatabase,readinessSummary,pruneEvents} from '../src/data-safety.mjs';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'radar-data-v18-'));
 const dbfile=join(dir,'primary.sqlite');
 const store=openDatabase(dbfile),service=createService(store);
 const opp=service.createOpportunity({title:'Genuine local portability test',problem:'Product backup is needed to protect local research data',market:'Global'});
 const source=store.put('sources',{id:'source-testing',title:'A consumer forum headline',url:'https://forum.example/test/123',
  status:'saved',author:'anonymous',description:'An actual fixture, not a verified consumer.',createdAt:new Date().toISOString()});
 const feed=store.put('feeds',{id:'feed-testing',title:'Private installed feed',url:'https://forum.example/rss',market:'Global',
  keywords:[],enabled:true,intervalMinutes:360,lastSuccessAt:new Date().toISOString()});
 const observation=store.put('validation_observations',{id:'sensitive-record',opportunityId:opp.id,
  note:'PRIVATE_FAKE_INTERVIEW_CONTENT',participantRef:'anonymous-01'});
 return {dir,dbfile,store,service,opp,source,feed,observation,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('SQLite WAL snapshot contains all records with a verified manifest while the app is running',()=>{
 const x=fixture();try{
  const output=join(x.dir,'private','research-2026.sqlite');
  const saved=backupDatabase({database:x.dbfile,output});
  assert.equal(saved.path,output);
  assert.ok(existsSync(saved.manifest));
  const checked=verifyBackup({input:output});
  assert.equal(checked.integrity,'ok');
  assert.equal(checked.sha256,saved.sha256);
  assert.equal(checked.counts.opportunities,1);
  assert.equal(checked.counts.sources,1);
  assert.equal(checked.counts.validation_observations,1);
  const fresh=readFileSync(output);
  assert.ok(fresh.includes(Buffer.from('PRIVATE_FAKE_INTERVIEW_CONTENT')),'Plain SQLite backup must explicitly be treated as sensitive');
  assert.throws(()=>backupDatabase({database:x.dbfile,output}),{code:'BACKUP_EXISTS'});
  assert.ok(statSync(output).size>1000);
 }finally{x.close();}
});
test('restoring is non-destructive: backup goes to a new database, existing live data remains intact',()=>{
 const x=fixture();try{
  const backup=join(x.dir,'data-backup.sqlite');
  backupDatabase({database:x.dbfile,output:backup});
  assert.throws(()=>restoreDatabase({input:backup,destination:join(x.dir,'restored.sqlite')}),{code:'CONFIRM_REQUIRED'});
  assert.throws(()=>restoreDatabase({input:backup,destination:x.dbfile,confirmed:true}),{code:'RESTORE_EXISTS'});
  const p=join(x.dir,'restored.sqlite');
  const result=restoreDatabase({input:backup,destination:p,confirmed:true});
  assert.equal(result.destination,p);
  assert.equal(result.verifiedRecords,4);
  assert.throws(()=>restoreDatabase({input:backup,destination:p,confirmed:true}),{code:'RESTORE_EXISTS'});
  const restored=openDatabase(p);
  try{
   assert.equal(restored.list('opportunities')[0].id,x.opp.id);
   assert.equal(restored.list('sources')[0].id,x.source.id);
   assert.equal(restored.list('feeds')[0].id,x.feed.id);
   assert.equal(restored.list('validation_observations')[0].note,'PRIVATE_FAKE_INTERVIEW_CONTENT');
   const service=createService(restored);
   assert.equal(service.brief().allCount,1);
  }finally{restored.close();}
  assert.equal(x.store.list('opportunities')[0].id,x.opp.id);
 }finally{x.close();}
});
test('tampered database or manifest is rejected before a restore target can be created',()=>{
 const x=fixture();try{
  const backup=join(x.dir,'backup.sqlite'),target=join(x.dir,'recovered.sqlite');
  backupDatabase({database:x.dbfile,output:backup});
  const sidecar=backup+'.manifest.json';
  const manifest=JSON.parse(readFileSync(sidecar,'utf8'));
  manifest.sha256='0'.repeat(64);
  writeFileSync(sidecar,JSON.stringify(manifest));
  assert.throws(()=>verifyBackup({input:backup}),{code:'BACKUP_CHECKSUM_MISMATCH'});
  assert.throws(()=>restoreDatabase({input:backup,destination:target,confirmed:true}),{code:'BACKUP_CHECKSUM_MISMATCH'});
  assert.ok(!existsSync(target));
 }finally{x.close();}
});
test('backup refuses unexpected sources and incomplete application schemas',()=>{
 const x=fixture();try{
  assert.throws(()=>backupDatabase({database:x.dbfile,output:x.dbfile}),{code:'UNSAFE_DESTINATION'});
  const junk=join(x.dir,'junk.sqlite');
  writeFileSync(junk,'garbage');
  assert.throws(()=>inspectRadarDatabase(junk));
  const absent=join(x.dir,'absent.sqlite');
  assert.throws(()=>inspectRadarDatabase(absent),{code:'DATA_NOT_FOUND'});
 }finally{x.close();}
});
test('first-launch readiness reports gaps as work to do, never confirms nonexistent backup or demand',()=>{
 const x=fixture();try{
  const first=readinessSummary(x.store,{ownerProtected:true});
  assert.equal(first.ownerProtected,true);
  assert.equal(first.counts.enabledFeeds,1);
  assert.equal(first.counts.previouslySuccessfulFeeds,1);
  assert.equal(first.counts.publicSignals,1);
  assert.equal(first.counts.opportunities,1);
  assert.equal(first.checks.find(x=>x.id==='backup').ok,null);
  assert.match(first.warnings.join(' '),/not proof/);
  assert.ok(!JSON.stringify(first).includes('PRIVATE_FAKE_INTERVIEW_CONTENT'));
 }finally{x.close();}
});
test('separate Node CLI validates on-disk records, takes snapshot and restores after reboot-like reopen',()=>{
 const x=fixture();
 try{
  const backup=join(x.dir,'cli-backup.sqlite'),recovery=join(x.dir,'new-primary.sqlite');
  const invoke=(args)=>spawnSync(process.execPath,['src/data-cli.mjs',...args],{cwd:process.cwd(),encoding:'utf8',timeout:12000});
  let run=invoke(['doctor','--db',x.dbfile]);
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(run.stdout).totalRecords,4);
  run=invoke(['backup','--db',x.dbfile,'--output',backup]);
  assert.equal(run.status,0,run.stderr);
  assert.ok(JSON.parse(run.stdout).sha256);
  run=invoke(['verify','--input',backup]);
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(run.stdout).counts.opportunities,1);
  run=invoke(['restore','--input',backup,'--destination',recovery,'--confirm']);
  assert.equal(run.status,0,run.stderr);
  assert.ok(existsSync(recovery));
  const stored=openDatabase(recovery);
  try{assert.equal(stored.get('opportunities',x.opp.id).title,x.opp.title);}finally{stored.close();}
 }finally{x.close();}
});

test('prune-events reports first, deletes only old audit events on confirm, and never touches records',()=>{
 const x=fixture();
 try{
  x.store.db.exec("INSERT INTO events(project_id,kind,entity_id,actor,detail,created_at) VALUES('p','test.old','e-old','test','{}','2020-01-01T00:00:00.000Z')");
  x.store.event('test.recent','e-new','test',{},null);
  assert.throws(()=>pruneEvents({database:x.dbfile}),{code:'BEFORE_REQUIRED'});
  assert.throws(()=>pruneEvents({database:x.dbfile,before:'not-a-date'}),{code:'BAD_BEFORE'});
  assert.throws(()=>pruneEvents({database:x.dbfile,before:'2099-01-01'}),{code:'BAD_BEFORE'});
  const dry=pruneEvents({database:x.dbfile,before:'90d'});
  assert.equal(dry.confirmed,false);
  assert.equal(dry.wouldDelete,1);
  const recordsBefore=inspectRadarDatabase(x.dbfile).totalRecords;
  const done=pruneEvents({database:x.dbfile,before:'90d',confirmed:true});
  assert.equal(done.confirmed,true);
  assert.equal(done.deleted,1);
  assert.equal(inspectRadarDatabase(x.dbfile).totalRecords,recordsBefore,'records and idem are never pruned');
  const oldLeft=x.store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE created_at<'2021-01-01'").get().n;
  assert.equal(oldLeft,0);
 }finally{x.close();}
});
