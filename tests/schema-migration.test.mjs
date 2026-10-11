import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDatabase,SCHEMA_VERSION} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {backupDatabase,verifyBackup,restoreDatabase,inspectRadarDatabase} from '../src/data-safety.mjs';

const legacyJson=JSON.stringify({id:'legacy-opp-1',title:'老版本创建的机会',problem:'旧版本数据库里真实保存的记录',market:'中国大陆',status:'candidate',revision:3,createdAt:'2026-01-01T00:00:00Z'});
/** Build a database exactly the way pre-versioning builds did: base tables only,
 * no signature column, no user_version stamp, no event index. */
function makeLegacyDatabase(file){
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(kind,id));
  CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, kind TEXT NOT NULL, entity_id TEXT, actor TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE idem (actor TEXT NOT NULL, key TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor,key));`);
  db.prepare('INSERT INTO records(kind,id,json,revision) VALUES(?,?,?,?)').run('opportunities','legacy-opp-1',legacyJson,3);
  db.prepare('INSERT INTO events(project_id,kind,entity_id,actor,detail,created_at) VALUES(?,?,?,?,?,?)')
    .run(null,'opportunity.created','legacy-opp-1','owner',JSON.stringify({title:'老版本创建的机会'}),'2026-01-01T00:00:00Z');
  db.prepare('INSERT INTO idem(actor,key,response) VALUES(?,?,?)').run('agent:external','legacy-key',JSON.stringify({legacy:true}));
  db.close();
}

test('pre-versioning database migrates in place: rows survive byte-identical, idempotency keeps working',()=>{
  const dir=mkdtempSync(join(tmpdir(),'radar-migrate-'));
  const file=join(dir,'legacy.sqlite');
  try{
    makeLegacyDatabase(file);
    const before=new DatabaseSync(file,{readOnly:true});
    const beforeRecords=before.prepare('SELECT kind,id,json,revision FROM records ORDER BY id').all();
    const beforeEvents=before.prepare('SELECT kind,entity_id,actor,detail FROM events').all();
    before.close();

    const store=openDatabase(file);
    try{
      assert.deepEqual(store.schema,{from:0,to:SCHEMA_VERSION,applied:[SCHEMA_VERSION]});
      assert.equal(store.schema.to,1);
      assert.ok(/^\d+\.\d+\.\d+$/.test(store.sqliteVersion.split('.').slice(0,3).join('.'))&&store.sqliteVersion.length>0);
      // Old rows are readable and unchanged.
      const legacy=store.get('opportunities','legacy-opp-1');
      assert.equal(legacy.title,'老版本创建的机会');
      assert.equal(legacy.revision,3);
      assert.deepEqual(store.list('opportunities').map(x=>x.id),['legacy-opp-1']);
      const migrated=new DatabaseSync(file,{readOnly:true});
      assert.deepEqual(migrated.prepare('SELECT kind,id,json,revision FROM records ORDER BY id').all(),beforeRecords);
      assert.deepEqual(migrated.prepare('SELECT kind,entity_id,actor,detail FROM events').all(),beforeEvents);
      // Migration artifacts exist: signature column, version stamp, event index.
      assert.ok(migrated.prepare('PRAGMA table_info(idem)').all().some(col=>col.name==='signature'));
      assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
      assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='events_project_seq'").get());
      migrated.close();
      // Old event rows stream through the normal cursor API.
      assert.equal(store.events(0).length,1);
      // Legacy idempotency entries were written without a signature; replaying the
      // same key with a signature must refuse rather than trust an unverified row.
      assert.throws(()=>store.idempotent('agent:external','legacy-key',()=>({hijacked:true}),'newsig'),{code:'IDEMPOTENCY_CONFLICT'});
      // New keys work with signature-protected replay.
      const value=store.idempotent('agent:external','new-key',()=>({ok:true}),'sig-1');
      const replay=store.idempotent('agent:external','new-key',()=>{throw new Error('must not re-run')},'sig-1');
      assert.deepEqual(value,{ok:true});
      assert.deepEqual(replay,{ok:true});
      assert.throws(()=>store.idempotent('agent:external','new-key',()=>({}),'sig-2'),{code:'IDEMPOTENCY_CONFLICT'});
      // The business layer keeps functioning on the migrated database.
      const service=createService(store);
      const opp=service.createOpportunity({title:'迁移后新建',problem:'迁移后的真实问题记录',market:'中国大陆'});
      assert.equal(store.list('opportunities').length,2);
      assert.equal(opp.revision,1);
    }finally{store.close();}

    // Re-opening a migrated file runs no migrations again.
    const second=openDatabase(file);
    try{assert.deepEqual(second.schema,{from:SCHEMA_VERSION,to:SCHEMA_VERSION,applied:[]});}
    finally{second.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a database written by a NEWER schema is refused instead of being misread',()=>{
  const dir=mkdtempSync(join(tmpdir(),'radar-schema-future-'));
  const file=join(dir,'future.sqlite');
  try{
    const store=openDatabase(file);store.close();
    const raw=new DatabaseSync(file);raw.exec(`PRAGMA user_version=${SCHEMA_VERSION+5}`);raw.close();
    assert.throws(()=>openDatabase(file),e=>e.code==='SCHEMA_TOO_NEW'&&/升级/.test(e.message));
    // The refusal is read-only in effect: the file is left untouched.
    const check=new DatabaseSync(file,{readOnly:true});
    assert.equal(check.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION+5);
    check.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('integrity doctor reports schema and engine version; backups carry them and stay backward compatible',()=>{
  const dir=mkdtempSync(join(tmpdir(),'radar-integrity-'));
  const file=join(dir,'primary.sqlite'),backup=join(dir,'backup.sqlite'),restored=join(dir,'restored.sqlite');
  try{
    const store=openDatabase(file);
    const service=createService(store);
    service.createOpportunity({title:'完整性验证机会',problem:'备份必须保留 schema 版本信息',market:'中国大陆'});
    store.close();

    const inspected=inspectRadarDatabase(file);
    assert.equal(inspected.integrity,'ok');
    assert.equal(inspected.schemaVersion,SCHEMA_VERSION);
    assert.ok(inspected.sqliteVersion&&/^\d+\./.test(inspected.sqliteVersion));
    assert.equal(inspected.totalRecords,1);

    const saved=backupDatabase({database:file,output:backup});
    assert.ok(saved.sha256);
    const manifest=JSON.parse(readFileSync(backup+'.manifest.json','utf8'));
    assert.equal(manifest.schemaVersion,SCHEMA_VERSION);
    assert.ok(manifest.sqliteVersion);
    const verified=verifyBackup({input:backup});
    assert.equal(verified.schemaVersion,SCHEMA_VERSION);
    assert.equal(verified.sqliteVersion,inspected.sqliteVersion);

    // Older manifests that predate the provenance fields must keep verifying.
    const stripped={...manifest};delete stripped.schemaVersion;delete stripped.sqliteVersion;
    writeFileSync(backup+'.manifest.json',JSON.stringify(stripped));
    const legacyVerified=verifyBackup({input:backup});
    assert.equal(legacyVerified.totalRecords,1);

    // Restore into a new file, then open it as a fresh application would.
    restoreDatabase({input:backup,destination:restored,confirmed:true});
    writeFileSync(backup+'.manifest.json',JSON.stringify(manifest)); // restore original sidecar not required, restore already done
    const reopened=openDatabase(restored);
    try{
      assert.deepEqual(reopened.schema,{from:SCHEMA_VERSION,to:SCHEMA_VERSION,applied:[]});
      assert.equal(reopened.list('opportunities')[0].title,'完整性验证机会');
    }finally{reopened.close();}

    // Cross-process CLI doctor exposes the same versions for operators.
    const run=spawnSync(process.execPath,['src/data-cli.mjs','doctor','--db',file],{cwd:process.cwd(),encoding:'utf8',timeout:15000});
    assert.equal(run.status,0,run.stderr);
    const doctor=JSON.parse(run.stdout);
    assert.equal(doctor.schemaVersion,SCHEMA_VERSION);
    assert.equal(doctor.sqliteVersion,inspected.sqliteVersion);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
