import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {upsertOwnerTask,projectOwnerTasks,ownerTaskHistory,archiveOwnerTask,unarchiveOwnerTask,ownerTaskBoard,ownerTaskTimeline} from '../src/owner-tasks.mjs';
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

test('owner tasks accept priorities and require a reason when blocking',()=>{
 const db=setup();try{
  const legacy=upsertOwnerTask(db,'p',{title:'Default priority'});
  assert.equal(legacy.priority,'normal');
  assert.equal(typeof legacy.stateChangedAt,'string');
  const high=upsertOwnerTask(db,'p',{title:'Urgent prep',priority:'high'});
  assert.equal(high.priority,'high');
  assert.throws(()=>upsertOwnerTask(db,'p',{title:'Bad',priority:'urgent'}),{code:'BAD_REQUEST'});
  assert.throws(()=>upsertOwnerTask(db,'p',{title:'Blocked silently',state:'blocked'}),{code:'BAD_REQUEST'});
  const blocked=upsertOwnerTask(db,'p',{title:'Blocked honestly',state:'blocked',blockedReason:'等待访谈档期'});
  assert.equal(blocked.blockedReason,'等待访谈档期');
  const edited=upsertOwnerTask(db,'p',{id:blocked.id,title:'Blocked honestly v2',expected_revision:blocked.revision});
  assert.equal(edited.blockedReason,'等待访谈档期');
  const unblocked=upsertOwnerTask(db,'p',{id:edited.id,state:'doing',expected_revision:edited.revision});
  assert.equal(unblocked.blockedReason,null);
  assert.equal(unblocked.stateChangedAt!==null,true);
 }finally{db.close();}
});

test('archiving hides a task from board columns while history stays restorable',()=>{
 const db=setup();try{
  const t=upsertOwnerTask(db,'p',{title:'Old idea'});
  assert.throws(()=>archiveOwnerTask(db,'p',t.id,{expected_revision:0}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>archiveOwnerTask(db,'p','missing',{expected_revision:1}),{code:'NOT_FOUND'});
  assert.throws(()=>archiveOwnerTask(db,'p',t.id,{}),{code:'REVISION_CONFLICT'});
  const archived=archiveOwnerTask(db,'p',t.id,{expected_revision:t.revision});
  assert.equal(typeof archived.archivedAt,'string');
  const again=archiveOwnerTask(db,'p',t.id,{expected_revision:archived.revision});
  assert.equal(again.archivedAt,archived.archivedAt);
  let board=ownerTaskBoard(db,'p');
  assert.equal(board.columns.todo.length,0);
  assert.equal(board.archived.length,1);
  assert.equal(board.archived[0].archivedAt,archived.archivedAt);
  assert.equal(board.archived[0].executionKind,'human');
  const restored=unarchiveOwnerTask(db,'p',t.id,{expected_revision:archived.revision});
  assert.equal(restored.archivedAt,null);
  board=ownerTaskBoard(db,'p');
  assert.equal(board.columns.todo.length,1);
  assert.equal(board.archived.length,0);
 }finally{db.close();}
});

test('board flags overdue tasks and reports legacy state age as unknown, never zero',()=>{
 const db=setup();try{
  const fixedNow=()=>'2027-03-01T08:00:00.000Z';
  const late=upsertOwnerTask(db,'p',{title:'Late interview',dueDate:'2027-02-01'});
  const future=upsertOwnerTask(db,'p',{title:'Future prep',dueDate:'2027-06-01'});
  const finished=upsertOwnerTask(db,'p',{title:'Finished late',dueDate:'2027-02-01',state:'done'});
  db.put('owner_tasks',{id:'legacy',projectId:'p',title:'Legacy task',state:'doing',dependencies:[],createdAt:'2026-01-01T00:00:00.000Z'});
  const board=ownerTaskBoard(db,'p',{now:fixedNow});
  const lateView=board.columns.todo.find(t=>t.id===late.id);
  assert.equal(lateView.overdue,true);
  assert.equal(board.columns.todo.find(t=>t.id===future.id).overdue,false);
  assert.equal(board.columns.done.find(t=>t.id===finished.id).overdue,false);
  assert.equal(board.overdueCount,1);
  assert.equal(lateView.stateAgeKnown,true);
  assert.ok(lateView.stateAgeMs>0);
  const legacyView=board.columns.doing.find(t=>t.id==='legacy');
  assert.equal(legacyView.stateAgeKnown,false);
  assert.equal(legacyView.stateAgeMs,null);
  assert.equal(legacyView.stateAgeSource,'unknown');
  assert.ok(board.notes.some(x=>x.includes('未知')));
 }finally{db.close();}
});

test('blocked tasks expose an unblock hint only when every prerequisite is done',()=>{
 const db=setup();try{
  const first=upsertOwnerTask(db,'p',{title:'First',state:'done'});
  const second=upsertOwnerTask(db,'p',{title:'Second',dependencies:[first.id]});
  const free=upsertOwnerTask(db,'p',{title:'Free blocked',state:'blocked',blockedReason:'no reason path'});
  const chained=upsertOwnerTask(db,'p',{title:'Chained blocked',state:'blocked',blockedReason:'waiting',dependencies:[second.id]});
  let board=ownerTaskBoard(db,'p');
  assert.equal(board.columns.blocked.find(t=>t.id===free.id).unblockable,false);
  assert.equal(board.columns.blocked.find(t=>t.id===chained.id).unblockable,false);
  assert.equal(board.unblockableCount,0);
  upsertOwnerTask(db,'p',{id:second.id,state:'done',expected_revision:second.revision});
  board=ownerTaskBoard(db,'p');
  assert.equal(board.columns.blocked.find(t=>t.id===chained.id).unblockable,true);
  assert.equal(board.unblockableCount,1);
 }finally{db.close();}
});

test('timeline reconstructs state segments from the audit log and stays honest for legacy tasks',()=>{
 const db=setup();try{
  const t=upsertOwnerTask(db,'p',{title:'Tracked'});
  const doing=upsertOwnerTask(db,'p',{id:t.id,state:'doing',expected_revision:t.revision});
  upsertOwnerTask(db,'p',{id:t.id,state:'blocked',blockedReason:'等待外部结果',expected_revision:doing.revision});
  const tl=ownerTaskTimeline(db,'p',t.id);
  assert.equal(tl.source,'events');
  assert.equal(tl.segments.length,3);
  assert.equal(tl.segments[0].state,'todo');
  assert.equal(typeof tl.segments[0].durationMs,'number');
  assert.equal(tl.segments[0].known,true);
  assert.notEqual(tl.segments[0].to,null);
  assert.equal(tl.segments[2].state,'blocked');
  assert.equal(tl.segments[2].to,null);
  assert.equal(tl.segments[2].durationMs,null);
  assert.ok(tl.note.includes('未知'));
  assert.throws(()=>ownerTaskTimeline(db,'p','nope'),{code:'NOT_FOUND'});
  db.put('owner_tasks',{id:'legacy',projectId:'p',title:'Legacy',state:'doing',dependencies:[],createdAt:'2026-05-01T00:00:00.000Z'});
  const legacyTl=ownerTaskTimeline(db,'p','legacy');
  assert.equal(legacyTl.source,'record');
  assert.equal(legacyTl.segments.length,1);
  assert.equal(legacyTl.segments[0].from,'2026-05-01T00:00:00.000Z');
  assert.equal(legacyTl.segments[0].durationMs,null);
 }finally{db.close();}
});

test('board keeps human and agent execution kinds explicitly separate',()=>{
 const db=setup();try{
  upsertOwnerTask(db,'p',{title:'Human planning'});
  db.put('tasks',{id:'k',projectId:'p',title:'Kickoff delivery',status:'open',dependencies:[],ownerKickoff:true,origin:'owner',baselineRevision:1,lease:null});
  db.put('tasks',{id:'a',projectId:'p',title:'Agent subtask',status:'in_progress',dependencies:[],lease:{token:'x',holder:'agent:external',generation:1,expiresAt:'2026-10-11T00:00:00.000Z'}});
  const board=ownerTaskBoard(db,'p');
  const human=board.columns.todo.find(t=>t.executionKind==='human');
  assert.ok(human);
  assert.equal(board.agentTasks.length,2);
  const kickoff=board.agentTasks.find(x=>x.id==='k');
  assert.equal(kickoff.executionKind,'agent');
  assert.equal(kickoff.origin,'owner');
  assert.equal(kickoff.isKickoff,true);
  const agentTask=board.agentTasks.find(x=>x.id==='a');
  assert.equal(agentTask.executionKind,'agent');
  assert.equal(agentTask.origin,'agent');
  assert.equal(agentTask.isKickoff,false);
  assert.equal(agentTask.leaseExpiresAt,'2026-10-11T00:00:00.000Z');
  assert.ok(board.notes.some(x=>x.includes('验收')));
 }finally{db.close();}
});

test('archived prerequisites stop gating completion, unblock hints and stay visible on dependants',()=>{
 const db=setup();try{
  const blocker=upsertOwnerTask(db,'p',{title:'永远不会完成的前置'});
  const dependent=upsertOwnerTask(db,'p',{title:'依赖任务',dependencies:[blocker.id]});
  assert.throws(()=>upsertOwnerTask(db,'p',{id:dependent.id,state:'done',expected_revision:dependent.revision}),{code:'DEPENDENCY_UNMET'});
  const archived=archiveOwnerTask(db,'p',blocker.id,{expected_revision:blocker.revision});
  // archiving lifts the fence: the dependant can now complete
  const done=upsertOwnerTask(db,'p',{id:dependent.id,state:'done',expected_revision:dependent.revision});
  assert.equal(done.state,'done');
  // a task blocked only on archived prerequisites reads as unblockable
  const blocked=upsertOwnerTask(db,'p',{title:'被归档前置卡住',state:'blocked',blockedReason:'等待归档前置',dependencies:[archived.id]});
  const board=ownerTaskBoard(db,'p');
  const blockedView=board.columns.blocked.find(t=>t.id===blocked.id);
  assert.equal(blockedView.unblockable,true);
  assert.deepEqual(blockedView.archivedDependencies,[archived.id]);
  const doneView=board.columns.done.find(t=>t.id===dependent.id);
  assert.deepEqual(doneView.archivedDependencies,[archived.id]);
  assert.ok(board.notes.some(x=>x.includes('已归档的前置任务不再约束')));
 }finally{db.close();}
});

test('state age and segment durations treat future timestamps as unknown, not zero',()=>{
 const db=setup();try{
  const fixedNow=()=>'2027-03-01T08:00:00.000Z';
  db.put('owner_tasks',{id:'skewed',projectId:'p',title:'时钟回拨任务',state:'doing',dependencies:[],createdAt:'2026-01-01T00:00:00.000Z',stateChangedAt:'2027-06-01T00:00:00.000Z'});
  const board=ownerTaskBoard(db,'p',{now:fixedNow});
  const skewView=board.columns.doing.find(t=>t.id==='skewed');
  assert.equal(skewView.stateSince,'2027-06-01T00:00:00.000Z');
  assert.equal(skewView.stateAgeKnown,false);
  assert.equal(skewView.stateAgeMs,null);
  assert.equal(skewView.stateAgeSource,'unknown');
  // negative event spans (second event predates the first) keep duration unknown
  db.put('owner_tasks',{id:'skew-seg',projectId:'p',title:'时间线倾斜任务',state:'doing',dependencies:[],createdAt:'2026-01-01T00:00:00.000Z'});
  const insert=db.db.prepare("INSERT INTO events(project_id,kind,entity_id,actor,detail,created_at) VALUES(?,?,?,?,?,?)");
  insert.run('p','owner_task.created','skew-seg','owner',JSON.stringify({state:'todo'}),'2027-01-02T00:00:00.000Z');
  insert.run('p','owner_task.updated','skew-seg','owner',JSON.stringify({state:'doing',previousState:'todo'}),'2026-01-01T00:00:00.000Z');
  const tl=ownerTaskTimeline(db,'p','skew-seg');
  assert.equal(tl.segments.length,2);
  assert.equal(tl.segments[0].from,'2027-01-02T00:00:00.000Z');
  assert.equal(tl.segments[0].to,'2026-01-01T00:00:00.000Z');
  assert.equal(tl.segments[0].durationMs,null);
  assert.equal(tl.segments[0].known,false);
  assert.equal(tl.segments[1].state,'doing');
  assert.equal(tl.segments[1].durationMs,null);
 }finally{db.close();}
});

test('overdue compares the machine-local calendar day against the date-only dueDate',()=>{
 const db=setup();try{
  const fixedNow=()=>'2027-03-01T20:00:00.000Z'; // already the next day in UTC+8, still Feb 28 in UTC-12
  const day=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  const base=new Date('2027-03-01T20:00:00.000Z');
  const prevDay=day(new Date(base.getTime()-86400000));
  const nextDay=day(new Date(base.getTime()+86400000));
  const late=upsertOwnerTask(db,'p',{title:'昨日到期',dueDate:prevDay});
  const todayTask=upsertOwnerTask(db,'p',{title:'今天到期',dueDate:day(base)});
  const future=upsertOwnerTask(db,'p',{title:'明天到期',dueDate:nextDay});
  const board=ownerTaskBoard(db,'p',{now:fixedNow});
  assert.equal(board.columns.todo.find(t=>t.id===late.id).overdue,true);
  assert.equal(board.columns.todo.find(t=>t.id===todayTask.id).overdue,false);
  assert.equal(board.columns.todo.find(t=>t.id===future.id).overdue,false);
  assert.equal(board.overdueCount,1);
  assert.equal(board.today,day(base));
  assert.ok(board.notes.some(x=>x.includes('本机时区')));
 }finally{db.close();}
});
