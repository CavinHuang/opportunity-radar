import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'radar-task-board-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
process.env.RADAR_OWNER_TOKEN='board-owner-secret';
process.env.RADAR_AGENT_TOKEN='board-agent-secret';
const {createServer,closeDatabase}=await import('../src/server.mjs');

test('task board, timeline and archive routes enforce owner auth and round-trip',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'board-owner-secret'};
 const agent={'Content-Type':'application/json',Authorization:'Bearer board-agent-secret'};
 const call=async(path,method='GET',body,headers=owner)=>{
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 };
 try{
  const opp=await call('/api/opportunities','POST',{title:'Task board flow',problem:'Repeated manual work',market:'China'});
  assert.equal(opp.status,201);
  const proj=await call('/api/experiments','POST',{opportunityId:opp.data.item.id,goal:'validate flow',hypothesis:'people want it',criteria:['core flow works'],stopCondition:'stop after budget'});
  assert.equal(proj.status,201);const pid=proj.data.project.id;
  const kickoff=await call('/api/projects/'+pid+'/kickoff','POST',{});
  assert.equal(kickoff.status,200);
  // permission negatives: agent tokens and missing owner keys cannot read or write tasks
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks/board','GET',undefined,{})).status,401);
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks/board','GET',undefined,agent)).status,401);
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks','POST',{title:'Nope'},agent)).status,401);
  // create with priority + milestone; blocking without a reason is rejected
  const project=await call('/api/projects/'+pid);
  const created=await call('/api/projects/'+pid+'/owner-tasks','POST',{title:'准备用户访谈',priority:'high',dueDate:'2027-06-01',milestoneId:project.data.milestones[0].id});
  assert.equal(created.status,200);
  const task=created.data.item;
  assert.equal(task.priority,'high');
  assert.equal(task.milestoneId,project.data.milestones[0].id);
  assert.equal(typeof task.stateChangedAt,'string');
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks','POST',{title:'Silent block',state:'blocked'})).status,400);
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks','POST',{title:'Bad priority',priority:'urgent'})).status,400);
  // board separates human and agent tasks and never reports unknown state age as zero
  const board=await call('/api/projects/'+pid+'/owner-tasks/board');
  assert.equal(board.status,200);
  assert.equal(board.data.columns.todo.length,1);
  const human=board.data.columns.todo[0];
  assert.equal(human.executionKind,'human');
  assert.equal(human.stateAgeKnown,true);
  assert.ok(human.stateAgeMs>=0);
  assert.equal(board.data.agentTasks.length,1);
  assert.equal(board.data.agentTasks[0].executionKind,'agent');
  assert.equal(board.data.agentTasks[0].isKickoff,true);
  assert.equal(board.data.agentTasks[0].origin,'owner');
  assert.ok(Array.isArray(board.data.notes)&&board.data.notes.length>=3);
  // timeline comes from the audit log
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks/'+task.id+'/timeline','GET',undefined,{})).status,401);
  const timeline=await call('/api/projects/'+pid+'/owner-tasks/'+task.id+'/timeline');
  assert.equal(timeline.status,200);
  assert.equal(timeline.data.source,'events');
  assert.equal(timeline.data.segments.length,1);
  assert.equal(timeline.data.segments[0].state,'todo');
  assert.equal(timeline.data.segments[0].durationMs,null); // ongoing segment
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks/unknown/timeline')).status,404);
  // archive requires the current revision and hides the task from columns
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks/'+task.id+'/archive','POST',{expected_revision:task.revision-1})).status,409);
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks/'+task.id+'/archive','POST',{expected_revision:task.revision},agent)).status,401);
  const archived=await call('/api/projects/'+pid+'/owner-tasks/'+task.id+'/archive','POST',{expected_revision:task.revision});
  assert.equal(archived.status,200);
  assert.equal(typeof archived.data.item.archivedAt,'string');
  const boardAfter=await call('/api/projects/'+pid+'/owner-tasks/board');
  assert.equal(boardAfter.data.columns.todo.length,0);
  assert.equal(boardAfter.data.archived.length,1);
  // unarchive restores the task without rewriting its history
  const restored=await call('/api/projects/'+pid+'/owner-tasks/'+task.id+'/unarchive','POST',{expected_revision:archived.data.item.revision});
  assert.equal(restored.status,200);
  assert.equal(restored.data.item.archivedAt,null);
  assert.equal((await call('/api/projects/'+pid+'/owner-tasks/unknown/archive','POST',{expected_revision:1})).status,404);
 }finally{
  await new Promise(r=>server.close(r));
  closeDatabase(); // release the SQLite handle so Windows can delete the temp dir
  rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
