import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {upsertOwnerTask,projectOwnerTasks,ownerTaskHistory} from '../src/owner-tasks.mjs';
const setup=()=>{
 const db=openDatabase();
 db.put('projects',{id:'p',status:'research',baselines:[{revision:1}]});
 db.put('milestones',{id:'m',projectId:'p',title:'Test'});
 return db;
};
test('owner task CRUD enforces optimistic revision and milestone ownership',()=>{
 const db=setup();try{
  let t=upsertOwnerTask(db,'p',{title:'Interview users',milestoneId:'m',dueDate:'2026-10-20'});
  assert.equal(projectOwnerTasks(db,'p').length,1);
  assert.throws(()=>upsertOwnerTask(db,'p',{...t,title:'Changed',expected_revision:0}),{code:'REVISION_CONFLICT'});
  t=upsertOwnerTask(db,'p',{id:t.id,title:'Changed',state:'doing',expected_revision:t.revision});
  assert.equal(t.state,'doing');
  assert.throws(()=>upsertOwnerTask(db,'p',{title:'Bad',dueDate:'2026-02-30'}),{code:'BAD_REQUEST'});
 }finally{db.close();}
});
test('owner task completion cannot bypass incomplete prerequisites',()=>{
 const db=setup();try{
  const a=upsertOwnerTask(db,'p',{title:'First'});
  const b=upsertOwnerTask(db,'p',{title:'Second',dependencies:[a.id]});
  assert.throws(()=>upsertOwnerTask(db,'p',{id:b.id,state:'done',expected_revision:b.revision}),{code:'DEPENDENCY_UNMET'});
  upsertOwnerTask(db,'p',{id:a.id,state:'done',expected_revision:a.revision});
  assert.equal(upsertOwnerTask(db,'p',{id:b.id,state:'done',expected_revision:b.revision}).state,'done');
 }finally{db.close();}
});
test('paused projects prohibit owner task writes',()=>{
 const db=setup();try{
  const p=db.get('projects','p');db.put('projects',{...p,status:'paused'},p.revision);
  assert.throws(()=>upsertOwnerTask(db,'p',{title:'Nope'}),{code:'PROJECT_NOT_ACTIVE'});
 }finally{db.close();}
});

test('owner task history records state changes and precondition metadata',()=>{
 const db=setup();try{
  const a=upsertOwnerTask(db,'p',{title:'Planning'});
  const b=upsertOwnerTask(db,'p',{title:'Release',dependencies:[a.id]});
  const hist=ownerTaskHistory(db,'p',b.id);
  assert.equal(hist.length,1);
  assert.equal(hist[0].kind,'owner_task.created');
  assert.deepEqual(hist[0].detail.dependencies,[a.id]);
 }finally{db.close();}
});

test('dependency cycles are rejected without changing task revision',()=>{
 const db=setup();try{
  const first=upsertOwnerTask(db,'p',{title:'One'});
  const second=upsertOwnerTask(db,'p',{title:'Two',dependencies:[first.id]});
  assert.throws(()=>upsertOwnerTask(db,'p',{id:first.id,expected_revision:first.revision,dependencies:[second.id]}),{code:'DEPENDENCY_CYCLE'});
  assert.equal(db.get('owner_tasks',first.id).revision,first.revision);
 }finally{db.close();}
});
