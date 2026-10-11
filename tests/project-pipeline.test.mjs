import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPipeline} from '../src/project-pipeline.mjs';

const base=()=>({status:'research',baselines:[{revision:2}],tasks:[],milestones:[{acceptanceState:'pending'},{acceptanceState:'pending'}],submissions:[],decisions:[],contents:[]});
test('a chosen project starts with an actionable kickoff without invented progress',()=>{
 const p=projectPipeline(base());
 assert.equal(p.progressLabel,'0/2 里程碑已人工验收');
 assert.equal(p.nextActions[0].kind,'kickoff');
 assert.equal(p.launchReady,false);
});
test('stale tasks excluded, pending delivery and decisions take priority',()=>{
 const p=base();p.tasks=[{status:'submitted',baselineRevision:1},{status:'rework',baselineRevision:2}];
 p.submissions=[{acceptanceState:'pending',baselineRevision:2}];p.decisions=[{status:'pending'}];
 const r=projectPipeline(p);
 assert.equal(r.totalTasks,1);assert.equal(r.taskCounts.rework,1);
 assert.deepEqual(r.nextActions.slice(0,2).map(x=>x.kind),['decision','acceptance']);
});
test('launch requires all milestones accepted and manual content approval',()=>{
 const p=base();p.milestones.forEach(m=>m.acceptanceState='accepted');
 p.contents=[{reviewState:'draft'},{reviewState:'approved',revision:2,approvedRevision:2}];
 const r=projectPipeline(p);
 assert.equal(r.launchReady,true);
 assert.equal(r.nextActions[0].kind,'publish');
 p.contents=[{reviewState:'published',revision:3,approvedRevision:2}];
 assert.equal(projectPipeline(p).nextActions[0].kind,'draft');
 assert.equal(projectPipeline(p).nextActions.at(-1).kind,'measure');
});
test('paused project does not suggest starting external work',()=>{
 const p=base();p.status='paused';p.tasks=[{status:'open',baselineRevision:2}];
 const r=projectPipeline(p);
 assert.deepEqual(r.nextActions.map(x=>x.kind),['project_state']);
});
test('archived owner tasks stop counting and overdue ones surface first (v2.9)',()=>{
 const p=base();
 p.ownerTasks=[
  {state:'todo',dueDate:'2020-01-01',archivedAt:null},
  {state:'todo',dueDate:'2099-01-01',archivedAt:null},
  {state:'doing',dueDate:null,archivedAt:null},
  {state:'blocked',dueDate:'2020-01-01',archivedAt:'2026-10-01T00:00:00.000Z'},
  {state:'done',dueDate:'2020-01-01',archivedAt:null}
 ];
 const r=projectPipeline(p);
 assert.equal(r.ownerTaskTotal,4); // archived task excluded
 assert.deepEqual(Object.values(r.ownerTaskCounts),[2,1,0,1]);
 assert.equal(r.ownerOverdue,1);
 assert.equal(r.nextActions[0].kind,'owner_overdue');
 assert.equal(r.nextActions[0].tab,'tasks');
});
test('scheduled publications surface due and overdue reminders; cancelled campaigns stop reminding (v2.9 Phase B)',()=>{
 const nowMs=Date.now();
 // keep the due-today probe on the same local calendar day even near midnight
 while(new Date(nowMs+60000).getDate()!==new Date(nowMs).getDate())nowMs+=60000;
 const at=ms=>new Date(ms).toISOString();
 const p=base();
 p.campaigns=[{id:'c1',name:'已取消',status:'cancelled'},{id:'c2',name:'进行中',status:'active'}];
 p.contents=[
  {id:'a',title:'逾期',plannedAt:at(nowMs-2*3600000),reviewState:'approved',campaignId:'c2'},
  {id:'b',title:'已取消活动的逾期内容',plannedAt:at(nowMs-3*3600000),reviewState:'approved',campaignId:'c1'},
  {id:'c',title:'已登记发布',plannedAt:at(nowMs-5*3600000),reviewState:'published',campaignId:'c2'}
 ];
 const r=projectPipeline(p,{now:new Date(nowMs)});
 assert.deepEqual(r.publicationReminders,{dueToday:0,overdue:1,campaignOverEnd:0}); // cancelled campaign excluded, published excluded
 assert.ok(r.nextActions.some(x=>x.kind==='publish_overdue'&&x.tab==='launch'));
 // launch-gated project: the due reminder takes precedence over the generic publish hint
 const p2=base();p2.milestones.forEach(m=>m.acceptanceState='accepted');
 p2.contents=[{id:'d',title:'今日',plannedAt:at(nowMs+60000),reviewState:'approved',campaignId:null}];
 const r2=projectPipeline(p2,{now:new Date(nowMs)});
 assert.equal(r2.publicationReminders.dueToday,1);
 assert.equal(r2.nextActions[0].kind,'publish_due');
 // a campaign past its planned end date is called out for review
 const p3=base();p3.campaigns=[{id:'c9',name:'过期活动',status:'active',endAt:'2020-01-01'}];
 const r3=projectPipeline(p3,{now:new Date(nowMs)});
 assert.equal(r3.publicationReminders.campaignOverEnd,1);
 assert.ok(r3.nextActions.some(x=>x.kind==='campaign_over_end'&&x.tab==='launch'));
});
