import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const entities = ['opportunities','projects','tasks','milestones','evidence','submissions','decisions','contents','ledger','sources','feeds','validation_plans','validation_observations','product_feedback','discovery_reviews','owner_tasks','growth_channels','growth_campaigns','growth_metrics','opportunity_reviews','campaigns'];
/** Highest schema version this build understands, stamped via PRAGMA user_version.
 * Version 0 means "written before versioning existed" — every migration below is
 * incremental and idempotent, so old databases upgrade in place without losing rows. */
export const SCHEMA_VERSION=1;
const migrations=[
 // v1 · baseline versioned schema. Older files already have these tables; the
 // signature column and the project event index are added only when missing.
 {version:1,run(db){
   if(!db.prepare('PRAGMA table_info(idem)').all().some(col=>col.name==='signature')) db.exec('ALTER TABLE idem ADD COLUMN signature TEXT');
   db.exec('CREATE INDEX IF NOT EXISTS events_project_seq ON events(project_id,seq)');
 }}];
function runMigrations(db){
  const from=Number(db.prepare('PRAGMA user_version').get().user_version||0);
  if(from>SCHEMA_VERSION)throw Object.assign(
    new Error(`数据库 schema 版本 v${from} 比当前应用支持的 v${SCHEMA_VERSION} 更新；请先升级应用，再用它打开这份只识别到 v${SCHEMA_VERSION} 的数据库`),
    {code:'SCHEMA_TOO_NEW',status:500});
  const applied=[];
  for(const migration of migrations){
    if(migration.version<=from)continue;
    migration.run(db);
    db.exec(`PRAGMA user_version=${Number(migration.version)}`);
    applied.push(migration.version);
  }
  return {from,to:from>SCHEMA_VERSION?from:Math.max(from,SCHEMA_VERSION),applied};
}
export function openDatabase(path=':memory:') {
  if(path!==':memory:') mkdirSync(dirname(path), {recursive:true});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  db.exec(`CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(kind,id));
  CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, kind TEXT NOT NULL, entity_id TEXT, actor TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS idem (actor TEXT NOT NULL, key TEXT NOT NULL, response TEXT NOT NULL, signature TEXT, PRIMARY KEY(actor,key));`);
  // A refused open (e.g. SCHEMA_TOO_NEW) must not leak the handle: Windows
  // cannot delete or replace a file that is still open.
  const schema=(()=>{try{return runMigrations(db)}catch(e){try{db.close()}catch{/* report the original error */}throw e}})();
  function ensureKind(kind){ if(!entities.includes(kind)) throw Object.assign(new Error('invalid collection'),{code:'BAD_REQUEST'}); }
  const q = {
    get(db,kind,id){ensureKind(kind);const r=db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id); return r?JSON.parse(r.json):null;},
    list(db,kind){ensureKind(kind);return db.prepare('SELECT json FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(x=>JSON.parse(x.json));},
    put(db,kind,item,expected){ensureKind(kind); const row=db.prepare('SELECT revision FROM records WHERE kind=? AND id=?').get(kind,item.id);
      if(expected!==undefined && (row?.revision??0)!==expected) throw Object.assign(new Error('数据已被其他操作更新，请刷新后重试'),{code:'REVISION_CONFLICT',status:409});
      const revision=(row?.revision??0)+1; const copy={...item,revision,updatedAt:new Date().toISOString()};
      db.prepare('INSERT INTO records(kind,id,json,revision) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,revision=excluded.revision').run(kind,item.id,JSON.stringify(copy),revision);
      return copy;
    },
    event(db,kind,entityId,actor,detail,projectId=null){const at=new Date().toISOString(); const result=db.prepare('INSERT INTO events(project_id,kind,entity_id,actor,detail,created_at) VALUES(?,?,?,?,?,?)').run(projectId,kind,entityId,actor,JSON.stringify(detail),at); return Number(result.lastInsertRowid);},
    events(db,after=0,projectId){const rows=projectId?db.prepare('SELECT * FROM events WHERE seq>? AND (project_id=? OR project_id IS NULL) ORDER BY seq LIMIT 100').all(after,projectId):db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 100').all(after);return rows.map(r=>({...r,detail:JSON.parse(r.detail)}));},
    transaction(db,fn){db.exec('BEGIN IMMEDIATE');try {const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},
    idempotent(db,actor,key,fn,signature){if(!key || typeof key!=='string') throw Object.assign(new Error('idempotency_key is required'),{code:'BAD_REQUEST',status:400});return q.transaction(db,()=>{
      const old=db.prepare('SELECT response,signature FROM idem WHERE actor=? AND key=?').get(actor,key);
      if(old){if(!signature||old.signature!==signature)throw Object.assign(new Error('同一幂等键不能用于不同的请求'),{code:'IDEMPOTENCY_CONFLICT',status:409});return JSON.parse(old.response);}
      const value=fn();db.prepare('INSERT INTO idem(actor,key,response,signature) VALUES(?,?,?,?)').run(actor,key,JSON.stringify(value),signature||null);return value;
    });}
  };
  return {db,schema,sqliteVersion:String(db.prepare('select sqlite_version() as v').get().v),...Object.fromEntries(Object.entries(q).map(([k,v])=>[k,(...args)=>v(db,...args)])),close:()=>db.close()};
}
