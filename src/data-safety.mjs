import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,existsSync,lstatSync,linkSync,mkdirSync,openSync,closeSync,readFileSync,readSync,rmSync,statSync,chmodSync,writeFileSync} from 'node:fs';
import {dirname,resolve,basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const fail=(code,message)=>Object.assign(new Error(message),{code});
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const defaultDatabasePath=()=>resolve(process.env.RADAR_DB||join(root,'.data','radar.sqlite'));
const tables=['records','events','idem'];
const fileExists=p=>{try{lstatSync(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const fileSafe=p=>{const stat=lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink())throw fail('UNSAFE_FILE','Database/backup must be a regular non-symlink file');return stat;};
const digestFile=p=>{
 const hash=createHash('sha256'),fd=openSync(p,'r'),block=Buffer.allocUnsafe(1024*1024);
 try{let count;while((count=readSync(fd,block,0,block.length,null))>0)hash.update(block.subarray(0,count));}
 finally{closeSync(fd);}
 return hash.digest('hex');
};
function readonly(path){
 const p=resolve(path);
 if(!fileExists(p))throw fail('DATA_NOT_FOUND','Database not found: '+p);
 fileSafe(p);
 return new DatabaseSync(p,{readOnly:true});
}
function validate(db){
 const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
 for(const name of tables)if(!names.has(name))throw fail('BACKUP_SCHEMA','Backup lacks Radar required table '+name);
 const check=db.prepare('PRAGMA integrity_check').all();
 if(check.length!==1||check[0].integrity_check!=='ok')throw fail('BACKUP_CORRUPT','SQLite integrity check failed');
 const counts={};
 for(const kind of db.prepare('SELECT kind,COUNT(*) AS n FROM records GROUP BY kind').all())
  counts[kind.kind]=kind.n;
 for(const r of db.prepare('SELECT kind,id,json,revision FROM records').iterate()){
  let item;try{item=JSON.parse(r.json)}catch{throw fail('BACKUP_RECORD_CORRUPT','An application record is not JSON');}
  if(item?.id!==r.id||!Number.isInteger(r.revision)||r.revision<1||item.revision!==r.revision)
   throw fail('BACKUP_RECORD_CORRUPT','Application record identity or revision is invalid');
 }
 // Report which schema version the file was written with (0 = pre-versioning
 // database). Informational only: both 0 and any current version stay readable.
 const schemaVersion=Number(db.prepare('PRAGMA user_version').get().user_version||0);
 const sqliteVersion=String(db.prepare('select sqlite_version() as v').get().v);
 return {counts,totalRecords:Object.values(counts).reduce((a,b)=>a+b,0),
   eventCount:db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
   schema:'Radar records/events/idem',integrity:'ok',schemaVersion,sqliteVersion};
}
export function inspectRadarDatabase(path){
 const db=readonly(path);
 try{return validate(db);}finally{db.close();}
}
export function backupDatabase({database=defaultDatabasePath(),output}){
 if(!output)throw fail('BACKUP_PATH_REQUIRED','Specify --output /private/path/backup.sqlite');
 const source=resolve(database),target=resolve(output),manifest=target+'.manifest.json';
 if(source===target)throw fail('UNSAFE_DESTINATION','Backup cannot overwrite its source');
 if(fileExists(target)||fileExists(manifest))throw fail('BACKUP_EXISTS','Refusing to overwrite an existing backup or manifest');
 if(!existsSync(dirname(target)))mkdirSync(dirname(target),{recursive:true,mode:0o700});
 const tmp=join(dirname(target),'.radar-backup-'+randomUUID()+'.sqlite');
 let db,linked=false,manifestLinked=false,manifestTemp=null;
 try{
  inspectRadarDatabase(source);
  db=readonly(source);
  // SQLite itself creates a transactionally consistent snapshot, including WAL contents.
  db.prepare('VACUUM INTO ?').run(tmp);db.close();db=null;
  chmodSync(tmp,0o600);
  const verified=inspectRadarDatabase(tmp);
  const sha256=digestFile(tmp);
  const snapshot={format:'opportunity-radar-sqlite-backup',version:1,
    createdAt:new Date().toISOString(),file:basename(target),bytes:statSync(tmp).size,
    sha256,integrity:verified.integrity,counts:verified.counts,eventCount:verified.eventCount,
    // Engine/schema provenance is recorded so a future restore can tell which
    // application version may read this file; older manifests without the fields
    // keep verifying, the fields are never used as a pass/fail gate.
    schemaVersion:verified.schemaVersion,sqliteVersion:verified.sqliteVersion,
    containsPersonalData:true,
    note:'Unencrypted local copy including private research. Protect and transfer securely. Manifest checksum detects accidental corruption, not malicious modification.'};
  // hard-link is an atomic no-clobber create on the same filesystem.
  linkSync(tmp,target);linked=true;
  manifestTemp=join(dirname(target),'.radar-manifest-'+randomUUID()+'.json');
  const fd=openSync(manifestTemp,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(snapshot,null,2)+'\n');}finally{closeSync(fd);}
  linkSync(manifestTemp,manifest);manifestLinked=true;
  return {path:target,manifest,sha256,bytes:snapshot.bytes,verifiedRecordCount:verified.totalRecords,warning:snapshot.note};
 }catch(e){
  if(manifestLinked)rmSync(manifest,{force:true});
  if(linked)rmSync(target,{force:true});
  throw e;
 }finally{
  db?.close();
  rmSync(tmp,{force:true});
  if(manifestTemp)rmSync(manifestTemp,{force:true});
 }
}
export function verifyBackup({input}){
 if(!input)throw fail('BACKUP_PATH_REQUIRED','Specify --input /path/backup.sqlite');
 const source=resolve(input),sidecar=source+'.manifest.json';
 const size=fileSafe(source).size;
 if(!fileExists(sidecar))throw fail('MANIFEST_MISSING','Backup manifest missing; cannot confirm recorded checksum');
 fileSafe(sidecar);
 let manifest;
 try{manifest=JSON.parse(readFileSync(sidecar,'utf8'))}catch{throw fail('MANIFEST_INVALID','Backup manifest is not valid JSON');}
 if(manifest.format!=='opportunity-radar-sqlite-backup'||manifest.version!==1
   ||manifest.file!==basename(source)||!(/^[a-f0-9]{64}$/.test(manifest.sha256||'')))
  throw fail('MANIFEST_INVALID','Unrecognized backup manifest');
 if(size!==manifest.bytes||digestFile(source)!==manifest.sha256)
  throw fail('BACKUP_CHECKSUM_MISMATCH','Backup bytes do not match saved checksum');
 const data=inspectRadarDatabase(source);
 if(JSON.stringify(data.counts)!==JSON.stringify(manifest.counts)||data.eventCount!==manifest.eventCount)
  throw fail('BACKUP_MANIFEST_MISMATCH','Backup records differ from the manifest');
 return {path:source,bytes:size,sha256:manifest.sha256,...data,
   createdAt:manifest.createdAt,containsPersonalData:true};
}
export function restoreDatabase({input,destination,confirmed=false}){
 if(!confirmed)throw fail('CONFIRM_REQUIRED','Restore needs --confirm and an EMPTY destination path');
 if(!destination)throw fail('DESTINATION_REQUIRED','Choose a NEW path using --destination; existing databases are never overwritten');
 const source=resolve(input),target=resolve(destination),snapshot=verifyBackup({input:source});
 if(source===target||fileExists(target)||fileExists(target+'-wal')||fileExists(target+'-shm'))
  throw fail('RESTORE_EXISTS','Restore requires a new path; stop Radar before switching RADAR_DB');
 mkdirSync(dirname(target),{recursive:true,mode:0o700});
 const tmp=join(dirname(target),'.radar-restore-'+randomUUID()+'.sqlite');
 try{
  copyFileSync(source,tmp);chmodSync(tmp,0o600);
  const copied=inspectRadarDatabase(tmp);
  if(digestFile(tmp)!==snapshot.sha256||copied.totalRecords!==snapshot.totalRecords)
   throw fail('RESTORE_VERIFY_FAILED','Restored temp database does not match verified backup');
  linkSync(tmp,target);
  return {destination:target,verifiedRecords:copied.totalRecords,
    nextStep:'Stop the running Radar server, set RADAR_DB to this NEW path, then restart. The original DB is preserved.'};
 }finally{rmSync(tmp,{force:true});}
}
export function readinessSummary(store,{ownerProtected=false}={}){
 const feeds=store.list('feeds'),enabled=feeds.filter(x=>x.enabled);
 const opportunities=store.list('opportunities');
 const signals=store.list('sources');
 const active=store.list('projects').filter(x=>!['archived','paused','stopped'].includes(x.status));
 const failing=enabled.filter(x=>x.lastError);
 const checks=[
  {id:'source_setup',ok:enabled.length>0,description:enabled.length?'有已启用的来源':'添加并启用至少一个真实 RSS/Atom 来源'},
  {id:'source_connectivity',ok:enabled.some(x=>x.lastSuccessAt),description:enabled.some(x=>x.lastSuccessAt)?'至少一个来源曾成功采集':'手动扫描来源并确认实际成功；测试信号不算连接成功'},
  {id:'signal_review',ok:signals.some(x=>['saved','converted'].includes(x.status)),description:'阅读真实信号并收藏、归档或关联，不能把公开报道当成已经验证的消费者'},
  {id:'research',ok:opportunities.length>0,description:'从有原始 URL 的问题线索建立待验证机会'},
  {id:'backup',ok:null,description:'备份由你自行保存：运行 npm run data -- backup，然后 verify；此页面不能证明离线备份已保存'}
 ];
 return {mode:'local-first',ownerProtected,counts:{configuredFeeds:feeds.length,enabledFeeds:enabled.length,
   previouslySuccessfulFeeds:enabled.filter(x=>x.lastSuccessAt).length,
   failingFeeds:failing.length,publicSignals:signals.length,opportunities:opportunities.length,
   activeExperiments:active.length},checks,
   warnings:['Local SQLite persists data. No backup, uptime or source quality guarantee is inferred from this readiness view.',
     'RSS signals and Owner-entered observations are not proof of independent demand or paying customers.',
     'Backups include potentially private research; use local CLI and secure storage.']};
}
