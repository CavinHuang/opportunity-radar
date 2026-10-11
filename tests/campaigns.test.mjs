import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {createCampaign,adjustCampaign,cancelCampaign,completeCampaign,recordRetrospective,campaignOverview,publicationCalendar} from '../src/campaign.mjs';

function setup(){
 const db=openDatabase();
 const s=createService(db);
 const o=s.createOpportunity({title:'Consumer pain',problem:'Repeated manual effort',market:'China',sources:[{url:'https://example.com/pain',quote:'real quote'}]});
 const p=s.startExperiment({opportunityId:o.id,goal:'test consumer intent',hypothesis:'people want this',criteria:['core task works'],stopCondition:'stop after budget exhaustion',hours:10,cash:0});
 return {db,s,o,p};
}
// ISO string carrying the machine-local offset, as scheduleContent requires.
function localIso(date){
 const pad=n=>String(n).padStart(2,'0');
 const off=-date.getTimezoneOffset();
 const sign=off>=0?'+':'-';const abs=Math.abs(off);
 return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
}

test('campaign creation validates project, name, goal, channels, range and budget',()=>{
 const {db,s,p}=setup();try{
  assert.throws(()=>createCampaign(db,'missing-project',{name:'X',goal:'Y',channels:['blog']}),e=>e.code==='NOT_FOUND');
  assert.throws(()=>createCampaign(db,p.id,{goal:'Y',channels:['blog']}),e=>e.code==='BAD_REQUEST'); // missing name
  assert.throws(()=>createCampaign(db,p.id,{name:'X',channels:['blog']}),e=>e.code==='BAD_REQUEST'); // missing goal
  assert.throws(()=>createCampaign(db,p.id,{name:'X',goal:'Y',channels:[]}),e=>e.code==='BAD_REQUEST'); // no channel
  assert.throws(()=>createCampaign(db,p.id,{name:'X',goal:'Y',channels:['   ']}),e=>e.code==='BAD_REQUEST'); // blank channel
  assert.throws(()=>createCampaign(db,p.id,{name:'X',goal:'Y',channels:['blog'],startAt:'2026-10-20',endAt:'2026-10-01'}),e=>e.code==='BAD_REQUEST'); // end before start
  assert.throws(()=>createCampaign(db,p.id,{name:'X',goal:'Y',channels:['blog'],endAt:'2026/10/20'}),e=>e.code==='BAD_REQUEST'); // invalid date
  assert.throws(()=>createCampaign(db,p.id,{name:'X',goal:'Y',channels:['blog'],budget:{cash:-5}}),e=>e.code==='BAD_REQUEST');
  const c=createCampaign(db,p.id,{name:'首发试用心声征集',goal:'收集 5 条真实试用反馈',channels:['blog','community','blog'],startAt:'2026-10-12',endAt:'2026-10-25',budget:{cash:200,hours:4},notes:'首轮宣发'});
  assert.equal(c.status,'active');
  assert.deepEqual(c.channels,['blog','community']); // deduplicated, order kept
  assert.equal(c.budget.cash,200);assert.equal(c.budget.hours,4);
  assert.equal(c.cancelReason,null);assert.equal(c.retrospective,null);
  assert.ok(db.events(0,p.id).some(x=>x.kind==='campaign.created'));
  // paused projects reject campaign writes
  s.ownerDecision(p.id,{action:'pause',reason:'budget pause'});
  assert.throws(()=>createCampaign(db,p.id,{name:'X',goal:'Y',channels:['blog']}),e=>e.code==='PROJECT_NOT_ACTIVE');
  assert.throws(()=>adjustCampaign(db,p.id,c.id,{goal:'Y',expected_revision:c.revision}),e=>e.code==='PROJECT_NOT_ACTIVE');
 }finally{db.close();}
});

test('contents join an active campaign, can leave it, and reject closed campaign targets',()=>{
 const {db,s,p}=setup();try{
  const c1=createCampaign(db,p.id,{name:'活动一',goal:'目标一',channels:['blog']});
  const c2=createCampaign(db,p.id,{name:'活动二',goal:'目标二',channels:['community']});
  const content=s.saveContent(p.id,{title:'T',body:'B',objective:'O',channel:'blog',campaignId:c1.id});
  assert.equal(content.campaignId,c1.id);
  // legacy contents keep working without a campaign (backward compatible)
  const legacy=s.saveContent(p.id,{title:'L',body:'B',objective:'O',channel:'blog'});
  assert.equal(legacy.campaignId,null);
  assert.throws(()=>s.saveContent(p.id,{title:'X',body:'B',objective:'O',channel:'blog',campaignId:'nope'}),e=>e.code==='NOT_FOUND');
  const moved=s.saveContent(p.id,{id:content.id,expected_revision:content.revision,title:'T2',body:'B2',objective:'O',channel:'blog',campaignId:c2.id});
  assert.equal(moved.campaignId,c2.id);
  assert.equal(moved.reviewState,'draft'); // moving campaigns never fakes approval
  const cancelled=cancelCampaign(db,p.id,c2.id,{reason:'取消原因：方向调整',expected_revision:c2.revision});
  assert.equal(cancelled.status,'cancelled');
  // moving away from a cancelled campaign stays possible
  const away=s.saveContent(p.id,{id:content.id,expected_revision:moved.revision,title:'T3',body:'B',objective:'O',channel:'blog',campaignId:c1.id});
  assert.equal(away.campaignId,c1.id);
  // moving INTO a cancelled campaign is rejected
  assert.throws(()=>s.saveContent(p.id,{id:content.id,expected_revision:away.revision,title:'T4',body:'B',objective:'O',channel:'blog',campaignId:c2.id}),e=>e.code==='CAMPAIGN_CLOSED');
  cancelCampaign(db,p.id,c1.id,{reason:'取消原因：预算调整',expected_revision:c1.revision});
  // editing other fields keeps an existing (now closed) assignment instead of silently dropping it
  const kept=s.saveContent(p.id,{id:content.id,expected_revision:away.revision,title:'T5',body:'B',objective:'O',channel:'blog'});
  assert.equal(kept.campaignId,c1.id);
 }finally{db.close();}
});

test('editing campaign content invalidates approval and blocks publication until re-review',()=>{
 const {db,s,p}=setup();try{
  const c=createCampaign(db,p.id,{name:'活动',goal:'目标',channels:['blog']});
  const draft=s.saveContent(p.id,{title:'首发',body:'真实进展',objective:'反馈',channel:'blog',campaignId:c.id});
  assert.throws(()=>s.reviewContent(p.id,draft.id,{action:'publish_record',url:'https://example.com/post'}),e=>e.code==='CONTENT_NOT_APPROVED');
  const approved=s.reviewContent(p.id,draft.id,{action:'approve',factsChecked:true,privacyChecked:true});
  const scheduled=s.scheduleContent(p.id,draft.id,{plannedAt:localIso(new Date(Date.now()+3600000)),expected_revision:approved.revision});
  assert.equal(scheduled.reviewState,'approved');
  assert.equal(scheduled.approvedRevision,scheduled.revision);
  // G07: the write-only scheduledRevision field is gone; the approvedRevision fence remains
  assert.equal(Object.hasOwn(scheduled,'scheduledRevision'),false);
  const edited=s.saveContent(p.id,{id:draft.id,expected_revision:scheduled.revision,title:'改',body:'改',objective:'反馈',channel:'blog'});
  assert.equal(edited.reviewState,'draft');
  assert.equal(edited.approvedRevision,null);
  assert.equal(edited.plannedAt,null);
  assert.ok(edited.versions.some(v=>v.reviewState==='approved')); // basis for the UI re-review hint
  assert.throws(()=>s.reviewContent(p.id,draft.id,{action:'publish_record',url:'https://example.com/post'}),e=>e.code==='CONTENT_NOT_APPROVED');
  s.reviewContent(p.id,draft.id,{action:'approve',factsChecked:true,privacyChecked:true});
  const published=s.reviewContent(p.id,draft.id,{action:'publish_record',url:'https://example.com/post'});
  assert.equal(published.campaignId,c.id); // publication keeps campaign attribution
 }finally{db.close();}
});

test('publication calendar state precedence and reminder rules are deterministic',()=>{
 const fixedNow=new Date(2026,9,20,10,0,0); // local 2026-10-20 10:00
 const at=(day,h,m)=>new Date(2026,9,day,h,m).toISOString();
 const fake=[
  {id:'1',title:'earlier today',plannedAt:at(20,9,0),reviewState:'draft',campaignId:null},
  {id:'2',title:'later today',plannedAt:at(20,18,0),reviewState:'draft',campaignId:null},
  {id:'3',title:'tomorrow',plannedAt:at(21,9,0),reviewState:'draft',campaignId:null},
  {id:'4',title:'published',plannedAt:at(20,8,0),reviewState:'published',campaignId:null}
 ];
 const cal=publicationCalendar(fake,[],fixedNow);
 // sorted by plannedAt, so the published 08:00 entry comes first
 assert.deepEqual(cal.map(x=>x.state),['published','overdue','due_today','upcoming']);
 assert.deepEqual(cal.filter(x=>x.reminder).map(x=>x.contentId),['1','2']);
});

test('calendar reminders stop for cancelled campaigns but entries stay visible',()=>{
 const {db,s,p}=setup();try{
  const c=createCampaign(db,p.id,{name:'活动',goal:'目标',channels:['blog']});
  const mk=title=>s.saveContent(p.id,{title,body:'真实内容',objective:'反馈',channel:'blog',campaignId:c.id});
  const unassigned=s.saveContent(p.id,{title:'无活动',body:'真实内容',objective:'反馈',channel:'blog'});
  const a=mk('逾期内容'),b=mk('今日内容'),d=mk('未来内容'),e2=mk('已发布内容');
  const rev={};
  for(const [key,x] of Object.entries({a,b,d,e2,unassigned}))rev[key]=s.reviewContent(p.id,x.id,{action:'approve',factsChecked:true,privacyChecked:true});
  s.scheduleContent(p.id,a.id,{plannedAt:localIso(new Date(Date.now()+2*3600000)),expected_revision:rev.a.revision});
  const dueDate=new Date(Date.now()+120000);
  if(dueDate.getHours()===0&&dueDate.getMinutes()<=1)dueDate.setMinutes(2); // never cross local midnight
  s.scheduleContent(p.id,b.id,{plannedAt:localIso(dueDate),expected_revision:rev.b.revision});
  s.scheduleContent(p.id,d.id,{plannedAt:localIso(new Date(Date.now()+72*3600000)),expected_revision:rev.d.revision});
  s.scheduleContent(p.id,e2.id,{plannedAt:localIso(new Date(Date.now()+72*3600000)),expected_revision:rev.e2.revision});
  s.scheduleContent(p.id,unassigned.id,{plannedAt:localIso(new Date(Date.now()+2*3600000)),expected_revision:rev.unassigned.revision});
  s.reviewContent(p.id,e2.id,{action:'publish_record',url:'https://example.com/published'});
  const entry=(overview,x)=>overview.calendar.find(e=>e.contentId===x.id);
  // observation 1: one minute before b's planned time → b is due today
  const beforeDue=new Date(dueDate.getTime()-60000);
  const o1=campaignOverview(db,s.getFullProject(p.id),{now:beforeDue});
  assert.equal(entry(o1,b).state,'due_today');
  assert.equal(entry(o1,e2).state,'published');
  assert.equal(entry(o1,d).state,'upcoming');
  assert.equal(entry(o1,unassigned).campaignName,null);
  // observation 2: four hours ahead → a, b and the unassigned content are overdue
  const observeAt=new Date(Date.now()+4*3600000);
  const o2=campaignOverview(db,s.getFullProject(p.id),{now:observeAt});
  assert.equal(entry(o2,a).state,'overdue');assert.equal(entry(o2,a).reminder,true);
  assert.equal(entry(o2,b).state,'overdue');
  assert.equal(entry(o2,e2).reminder,false);
  assert.equal(o2.reminders.overdue,3); // a + b + unassigned
  assert.equal(o2.campaigns[0].contentCounts.scheduled,3);
  // cancelling stops reminders but keeps entries visible and labelled
  cancelCampaign(db,p.id,c.id,{reason:'取消原因：暂缓整个宣发计划',expected_revision:c.revision});
  const o3=campaignOverview(db,s.getFullProject(p.id),{now:observeAt});
  assert.equal(entry(o3,a).reminder,false);
  assert.equal(entry(o3,a).campaignStatus,'cancelled');
  assert.equal(entry(o3,a).state,'overdue'); // still visible, just not nagging
  assert.equal(o3.reminders.overdue,1); // only the unassigned content still reminds
  assert.equal(o3.reminders.dueToday,0);
 }finally{db.close();}
});

test('campaign lifecycle: adjust fence, cancel reason, completion freeze and retrospective rules',()=>{
 const {db,s,p}=setup();try{
  const c=createCampaign(db,p.id,{name:'活动',goal:'目标',channels:['blog'],budget:{hours:2}});
  assert.throws(()=>adjustCampaign(db,p.id,c.id,{goal:'新目标',expected_revision:99}),e=>e.code==='REVISION_CONFLICT');
  const adjusted=adjustCampaign(db,p.id,c.id,{goal:'调整后的目标',budget:{cash:100},expected_revision:c.revision});
  assert.equal(adjusted.goal,'调整后的目标');
  assert.equal(adjusted.budget.cash,100);assert.equal(adjusted.budget.hours,2); // untouched field survives
  assert.throws(()=>cancelCampaign(db,p.id,c.id,{reason:'太短',expected_revision:adjusted.revision}),e=>e.code==='BAD_REQUEST');
  assert.throws(()=>cancelCampaign(db,p.id,c.id,{reason:'取消原因足够长',expected_revision:1}),e=>e.code==='REVISION_CONFLICT');
  assert.throws(()=>recordRetrospective(db,p.id,c.id,{summary:'这份复盘写于活动仍在进行时，不允许',expected_revision:adjusted.revision}),e=>e.code==='CAMPAIGN_ACTIVE');
  const content=s.saveContent(p.id,{title:'T',body:'B',objective:'O',channel:'blog',campaignId:c.id});
  const beforeCancel=db.get('contents',content.id);
  const cancelled=cancelCampaign(db,p.id,c.id,{reason:'取消原因：暂缓宣发',expected_revision:adjusted.revision});
  assert.equal(cancelled.status,'cancelled');
  assert.ok(cancelled.cancelReason.includes('暂缓'));
  assert.ok(cancelled.closedAt);
  // cancelling never rewrites content records
  const after=db.get('contents',content.id);
  assert.equal(after.revision,beforeCancel.revision);
  assert.deepEqual(after,beforeCancel);
  assert.throws(()=>cancelCampaign(db,p.id,c.id,{reason:'再次取消不允许',expected_revision:cancelled.revision}),e=>e.code==='CAMPAIGN_CLOSED');
  assert.throws(()=>adjustCampaign(db,p.id,c.id,{goal:'x',expected_revision:cancelled.revision}),e=>e.code==='CAMPAIGN_CLOSED');
  assert.throws(()=>recordRetrospective(db,p.id,c.id,{summary:'太短',expected_revision:cancelled.revision}),e=>e.code==='BAD_REQUEST');
  assert.throws(()=>recordRetrospective(db,p.id,c.id,{summary:'结论',expected_revision:cancelled.revision}),e=>e.code==='BAD_REQUEST');
  const retro=recordRetrospective(db,p.id,c.id,{summary:'活动取消：预算转向产品打磨，已写内容保留待后续使用',lessons:'先验证再宣发',expected_revision:cancelled.revision});
  assert.equal(retro.retrospective.summary.includes('预算转向'),true);
  assert.equal(retro.retrospective.recordedBy,'owner');
  assert.ok(db.events(0,p.id).some(x=>x.kind==='campaign.retrospective_recorded'));
 }finally{db.close();}
});

test('completion freezes the campaign; actuals aggregate only real ledger attributed through published content',()=>{
 const {db,s,p}=setup();try{
  const c=createCampaign(db,p.id,{name:'活动',goal:'目标',channels:['blog']});
  const other=createCampaign(db,p.id,{name:'另一活动',goal:'目标',channels:['blog']});
  const a=s.saveContent(p.id,{title:'A',body:'B',objective:'O',channel:'blog',campaignId:c.id});
  const b=s.saveContent(p.id,{title:'B',body:'B',objective:'O',channel:'blog',campaignId:other.id});
  for(const x of [a,b]){
   s.reviewContent(p.id,x.id,{action:'approve',factsChecked:true,privacyChecked:true});
   s.reviewContent(p.id,x.id,{action:'publish_record',url:'https://example.com/'+x.id});
  }
  s.addLedger(p.id,{type:'visits',value:8,contentId:a.id,actual:true});
  s.addLedger(p.id,{type:'income',value:100,contentId:a.id,actual:true});
  s.addLedger(p.id,{type:'income',value:500,contentId:a.id,actual:false}); // forecast → excluded
  s.addLedger(p.id,{type:'trials',value:3,contentId:b.id,actual:true});   // other campaign → excluded
  const completed=completeCampaign(db,p.id,c.id,{expected_revision:c.revision,note:'数据已登记'});
  assert.equal(completed.status,'completed');
  assert.ok(completed.closedAt);
  assert.equal(completed.completionNote,'数据已登记');
  assert.throws(()=>completeCampaign(db,p.id,c.id,{expected_revision:completed.revision}),e=>e.code==='CAMPAIGN_CLOSED');
  assert.throws(()=>adjustCampaign(db,p.id,c.id,{goal:'x',expected_revision:completed.revision}),e=>e.code==='CAMPAIGN_CLOSED');
  const overview=campaignOverview(db,s.getFullProject(p.id));
  const mine=overview.campaigns.find(x=>x.id===c.id);
  assert.equal(mine.actuals.visits,8);
  assert.equal(mine.actuals.income,100);
  assert.equal(mine.actuals.refund,null); // unrecorded metric stays unknown, never zero
  assert.equal(mine.actuals.trials,null);
  assert.equal(mine.contentCounts.published,1);
  assert.equal(mine.contentCounts.total,1);
  assert.ok(db.events(0,p.id).some(x=>x.kind==='campaign.completed'));
  // retrospective remains possible after completion
  const retro=recordRetrospective(db,p.id,c.id,{summary:'活动完成：收集到 8 次访问与首笔收入，转化路径待改进',lessons:'',expected_revision:completed.revision});
  assert.ok(retro.retrospective.summary);
 }finally{db.close();}
});
