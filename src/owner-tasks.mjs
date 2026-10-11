import {randomUUID} from 'node:crypto';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const states=new Set(['todo','doing','blocked','done']);
const priorities=new Set(['low','normal','high']);
const priorityRank={high:0,normal:1,low:2};
export function projectOwnerTasks(store,projectId){
 if(!store.get('projects',projectId))throw fail('NOT_FOUND','项目不存在',404);
 return store.list('owner_tasks').filter(t=>t.projectId===projectId).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
}
export function upsertOwnerTask(store,projectId,data){
 const project=store.get('projects',projectId);
 if(!project)throw fail('NOT_FOUND','项目不存在',404);
 if(['stopped','archived','paused'].includes(project.status))throw fail('PROJECT_NOT_ACTIVE','项目当前不可更改任务',409);
 const old=data.id?store.get('owner_tasks',data.id):null;
 if(data.id&&(!old||old.projectId!==projectId))throw fail('NOT_FOUND','任务不存在',404);
 if(old&&data.expected_revision!==old.revision)throw fail('REVISION_CONFLICT','任务被其他操作修改',409);
 const title=clean(data.title??old?.title,160);
 if(!title)throw fail('BAD_REQUEST','任务标题不能为空');
 const state=data.state??old?.state??'todo';
 if(!states.has(state))throw fail('BAD_REQUEST','无效任务状态');
 const priority=data.priority??old?.priority??'normal';
 if(!priorities.has(priority))throw fail('BAD_REQUEST','无效优先级');
 const blockedReason=clean(data.blockedReason??old?.blockedReason,500);
 if(state==='blocked'&&!blockedReason)throw fail('BAD_REQUEST','阻塞任务必须填写阻塞原因，便于追溯');
 const milestoneId=data.milestoneId??old?.milestoneId??null;
 if(milestoneId&&!store.list('milestones').some(m=>m.id===milestoneId&&m.projectId===projectId))throw fail('BAD_REQUEST','无效里程碑');
 const dueDate=data.dueDate??old?.dueDate??null;
 if(dueDate&&(typeof dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate+'T00:00:00Z'))||new Date(dueDate+'T00:00:00Z').toISOString().slice(0,10)!==dueDate))throw fail('BAD_REQUEST','日期必须是有效 YYYY-MM-DD');
 const dependencies=data.dependencies??old?.dependencies??[];
 if(!Array.isArray(dependencies)||new Set(dependencies).size!==dependencies.length||dependencies.some(id=>id===data.id||!store.get('owner_tasks',id)||store.get('owner_tasks',id).projectId!==projectId))throw fail('BAD_REQUEST','任务依赖无效');
 // Archived prerequisites no longer constrain completion: archiving removes a task from
 // the board and from the dependency fence, so dependants can never be deadlocked.
 if(state==='done'&&dependencies.some(id=>{const d=store.get('owner_tasks',id);return !d.archivedAt&&d.state!=='done';}))throw fail('DEPENDENCY_UNMET','前置任务尚未完成',409);
 const graph=new Map(projectOwnerTasks(store,projectId).map(t=>[t.id,t.dependencies||[]]));
 graph.set(data.id||'__new__',dependencies);
 const visiting=new Set(),visited=new Set();
 const walk=id=>{if(visiting.has(id))throw fail('DEPENDENCY_CYCLE','任务依赖不能形成环',409);if(visited.has(id))return;visiting.add(id);for(const dep of graph.get(id)||[])walk(dep);visiting.delete(id);visited.add(id);};
 for(const id of graph.keys())walk(id);
 const at=new Date().toISOString();
 // v2.9 field: stateChangedAt records when the current state started. Legacy records keep
 // working without it; read models fall back to the audit event log and stay honest.
 const stateChangedAt=old?(old.state===state?(old.stateChangedAt??null):at):at;
 const saved=store.put('owner_tasks',{...old,id:old?.id||randomUUID(),projectId,title,description:clean(data.description??old?.description,2000),state,priority,blockedReason:state==='blocked'?blockedReason:null,owner:clean(data.owner??old?.owner??'本人',80),dueDate,milestoneId,dependencies,stateChangedAt,createdAt:old?.createdAt||at},old?.revision);
 store.event(old?'owner_task.updated':'owner_task.created',saved.id,'owner',{state,title:saved.title,previousState:old?.state||null,owner:saved.owner,dueDate:saved.dueDate,dependencies:saved.dependencies,priority:saved.priority,blockedReason:saved.blockedReason||null,revision:saved.revision},projectId);
 return saved;
}
export function archiveOwnerTask(store,projectId,taskId,data={}){
 const project=store.get('projects',projectId);
 if(!project)throw fail('NOT_FOUND','项目不存在',404);
 if(['stopped','archived','paused'].includes(project.status))throw fail('PROJECT_NOT_ACTIVE','项目当前不可更改任务',409);
 const task=store.get('owner_tasks',taskId);
 if(!task||task.projectId!==projectId)throw fail('NOT_FOUND','任务不存在',404);
 if(data.expected_revision!==task.revision)throw fail('REVISION_CONFLICT','任务被其他操作修改',409);
 if(task.archivedAt)return task; // archiving twice keeps the first timestamp
 const saved=store.put('owner_tasks',{...task,archivedAt:new Date().toISOString()},task.revision);
 store.event('owner_task.archived',saved.id,'owner',{title:saved.title,state:saved.state,previousState:task.state},projectId);
 return saved;
}
export function unarchiveOwnerTask(store,projectId,taskId,data={}){
 const project=store.get('projects',projectId);
 if(!project)throw fail('NOT_FOUND','项目不存在',404);
 if(['stopped','archived','paused'].includes(project.status))throw fail('PROJECT_NOT_ACTIVE','项目当前不可更改任务',409);
 const task=store.get('owner_tasks',taskId);
 if(!task||task.projectId!==projectId)throw fail('NOT_FOUND','任务不存在',404);
 if(data.expected_revision!==task.revision)throw fail('REVISION_CONFLICT','任务被其他操作修改',409);
 if(!task.archivedAt)return task;
 const saved=store.put('owner_tasks',{...task,archivedAt:null},task.revision);
 store.event('owner_task.unarchived',saved.id,'owner',{title:saved.title,state:saved.state,previousState:'archived'},projectId);
 return saved;
}
export function ownerTaskHistory(store,projectId,taskId,{limit=30}={}){
 const task=store.get('owner_tasks',taskId);
 if(!task||task.projectId!==projectId)throw fail('NOT_FOUND','任务不存在',404);
 const n=Number(limit);if(!Number.isInteger(n)||n<1||n>100)throw fail('BAD_REQUEST','limit must be 1–100');
 return store.db.prepare("SELECT seq,project_id,kind,entity_id,actor,detail,created_at FROM events WHERE project_id=? AND entity_id=? AND kind LIKE 'owner_task.%' ORDER BY seq DESC LIMIT ?").all(projectId,taskId,n).map(e=>({...e,detail:JSON.parse(e.detail)}));
}

// ---- v2.9 read models: board (kanban), overdue hints and state timeline ----
// Honest-data rules: missing durations are reported as null/unknown, never as 0;
// counts never imply completion percentages and never certify delivery acceptance.
const ACTIVE_STATES=['todo','doing','blocked','done'];
// Overdue is compared on the machine-local calendar day (the owner enters date-only
// deadlines in local intent), not on the UTC day.
const localDay=value=>{const x=new Date(value);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
function lastStateChangeAt(store,task){
 if(task.stateChangedAt)return {at:task.stateChangedAt,source:'record'};
 const rows=store.db.prepare("SELECT created_at,detail FROM events WHERE project_id=? AND entity_id=? AND kind LIKE 'owner_task.%' ORDER BY seq ASC").all(task.projectId,task.id);
 let current=null,at=null;
 for(const r of rows){let d;try{d=JSON.parse(r.detail);}catch{continue;}
  if(typeof d?.state!=='string')continue;
  if(current===null||d.state!==current){current=d.state;at=r.created_at;}
 }
 return at?{at,source:'events'}:{at:null,source:'unknown'};
}
const columnSort=(a,b)=>(priorityRank[a.priority]-priorityRank[b.priority])||
 (a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31')||
 (a.createdAt||'').localeCompare(b.createdAt||'');
export function ownerTaskBoard(store,projectId,{now}={}){
 if(!store.get('projects',projectId))throw fail('NOT_FOUND','项目不存在',404);
 const generatedAt=(now?now():new Date().toISOString());
 const today=localDay(generatedAt);
 const generatedMs=Date.parse(generatedAt);
 const tasks=projectOwnerTasks(store,projectId);
 const decorate=t=>{
  const change=lastStateChangeAt(store,t);
  const depRecords=(t.dependencies||[]).map(id=>tasks.find(x=>x.id===id)).filter(Boolean);
  // Archived prerequisites stopped constraining the moment they were archived.
  const activeDeps=depRecords.filter(d=>!d.archivedAt);
  const archivedDeps=depRecords.filter(d=>d.archivedAt);
  const dependents=tasks.filter(x=>x.id!==t.id&&(x.dependencies||[]).includes(t.id)&&!x.archivedAt).map(x=>x.id);
  const changedMs=change.at?Date.parse(change.at):null;
  // A state-change timestamp in the future (clock skew, restored backup) is unknown, not 0.
  const ageKnown=changedMs!=null&&changedMs<=generatedMs;
  return {
   id:t.id,title:t.title,description:t.description||'',state:t.state,
   priority:t.priority??'normal',
   owner:t.owner||'本人',dueDate:t.dueDate||null,milestoneId:t.milestoneId||null,
   dependencies:t.dependencies||[],dependents,
   archivedDependencies:archivedDeps.map(d=>d.id),
   blockedReason:t.state==='blocked'?(t.blockedReason||null):null,
   archivedAt:t.archivedAt||null,
   executionKind:'human',
   overdue:Boolean(t.dueDate&&t.state!=='done'&&t.dueDate<today),
   stateSince:change.at,
   stateAgeMs:ageKnown?Math.max(0,generatedMs-changedMs):null,
   stateAgeKnown:ageKnown,
   stateAgeSource:ageKnown?change.source:'unknown',
   unblockable:t.state==='blocked'&&activeDeps.every(d=>d.state==='done')&&(activeDeps.length>0||archivedDeps.length>0)
  };
 };
 const active=tasks.filter(t=>!t.archivedAt).map(decorate);
 const archived=tasks.filter(t=>t.archivedAt).map(decorate);
 const columns=Object.fromEntries(ACTIVE_STATES.map(s=>[s,active.filter(t=>t.state===s).sort(columnSort)]));
 const agentTasks=store.list('tasks').filter(x=>x.projectId===projectId).map(x=>({
  id:x.id,title:x.title,status:x.status,milestoneId:x.milestoneId||null,
  baselineRevision:x.baselineRevision||null,
  executionKind:'agent',
  origin:x.origin||(x.ownerKickoff?'owner':'agent'),
  isKickoff:x.ownerKickoff===true,
  leaseExpiresAt:x.lease?.expiresAt||null,
  latestProgress:x.latestProgress||null
 }));
 return {projectId,generatedAt,today,columns,archived,
  overdueCount:active.filter(t=>t.overdue).length,
  unblockableCount:active.filter(t=>t.unblockable).length,
  agentTasks,
  notes:[
   '人工任务看板只反映本机录入的任务安排，不构成研发完成度，也不能替代人工验收结论。',
   '状态持续时间与逾期提示来自本机记录和截止日期；缺失或异常（如未来时间戳）的历史记为未知，不当作零。',
   '逾期判定按本机时区的日历日期与截止日期（YYYY-MM-DD，不含时刻）比较。',
   '已归档的前置任务不再约束依赖任务的完成条件。',
   'Agent 执行任务由外部 Coding Agent 在租约内更新；任务提交与进度汇报均不等于验收通过。'
  ]};
}
export function ownerTaskTimeline(store,projectId,taskId){
 const task=store.get('owner_tasks',taskId);
 if(!task||task.projectId!==projectId)throw fail('NOT_FOUND','任务不存在',404);
 const rows=store.db.prepare("SELECT created_at,detail FROM events WHERE project_id=? AND entity_id=? AND kind LIKE 'owner_task.%' ORDER BY seq ASC").all(projectId,taskId);
 const segments=[];let current=null;
 for(const r of rows){let d;try{d=JSON.parse(r.detail);}catch{continue;}
  if(typeof d?.state!=='string')continue;
  if(!current||current.state!==d.state){
   if(current){
    current.to=r.created_at;
    // Negative spans (clock skew, restored backups) stay unknown instead of being clamped to 0.
    const spanMs=Date.parse(r.created_at)-Date.parse(current.from);
    current.durationMs=spanMs>=0?spanMs:null;
    current.known=spanMs>=0;
   }
   current={state:d.state,from:r.created_at,to:null,durationMs:null,known:true};
   segments.push(current);
  }
 }
 let source='events';
 if(!segments.length){
  source='record';
  const from=task.stateChangedAt||task.createdAt||null;
  segments.push({state:task.state,from,to:null,durationMs:null,known:Boolean(from)});
 }
 return {taskId,projectId,state:task.state,archivedAt:task.archivedAt||null,segments,
  source,
  note:'时间段来自本机审计事件与任务记录；缺失的历史保持未知，不做推算，也不代表验收结论。'};
}
