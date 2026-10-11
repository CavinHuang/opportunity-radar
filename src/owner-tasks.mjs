import {randomUUID} from 'node:crypto';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const states=new Set(['todo','doing','blocked','done']);
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
 const milestoneId=data.milestoneId??old?.milestoneId??null;
 if(milestoneId&&!store.list('milestones').some(m=>m.id===milestoneId&&m.projectId===projectId))throw fail('BAD_REQUEST','无效里程碑');
 const dueDate=data.dueDate??old?.dueDate??null;
 if(dueDate&&(typeof dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate+'T00:00:00Z'))||new Date(dueDate+'T00:00:00Z').toISOString().slice(0,10)!==dueDate))throw fail('BAD_REQUEST','日期必须是有效 YYYY-MM-DD');
 const dependencies=data.dependencies??old?.dependencies??[];
 if(!Array.isArray(dependencies)||new Set(dependencies).size!==dependencies.length||dependencies.some(id=>id===data.id||!store.get('owner_tasks',id)||store.get('owner_tasks',id).projectId!==projectId))throw fail('BAD_REQUEST','任务依赖无效');
 if(state==='done'&&dependencies.some(id=>store.get('owner_tasks',id).state!=='done'))throw fail('DEPENDENCY_UNMET','前置任务尚未完成',409);
 const saved=store.put('owner_tasks',{...old,id:old?.id||randomUUID(),projectId,title,description:clean(data.description??old?.description,2000),state,owner:clean(data.owner??old?.owner??'本人',80),dueDate,milestoneId,dependencies,createdAt:old?.createdAt||new Date().toISOString()},old?.revision);
 store.event(old?'owner_task.updated':'owner_task.created',saved.id,'owner',{state,title:saved.title},projectId);
 return saved;
}
