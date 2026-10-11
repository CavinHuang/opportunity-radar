// v2.9 Phase B: promotion campaigns over the existing v2.8 content workflow.
// A campaign groups contents; drafts, review/approval, scheduling and manual
// publication registration stay in service.mjs — nothing is auto-published and
// the campaign layer never rewrites content records behind the owner's back.
import {randomUUID} from 'node:crypto';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const CAMPAIGN_STATUSES=['active','completed','cancelled'];
// Metrics attributed per campaign through contentId → content.campaignId. Only
// actual===true ledger entries count; an unrecorded metric stays null (unknown),
// never zero — matching the experiment-decision honesty rules.
const ACTUAL_METRICS=['impressions','visits','trials','activation','income','refund','transaction_fee','service_cost','cash_cost'];
const nonNegative=(v,name,max=10000000)=>{const n=Number(v);if(!Number.isFinite(n)||n<0||n>max)throw fail('BAD_REQUEST',name+' 必须是 0 到 '+max+' 之间的数字');return n;};

function getProject(store,projectId){
 const project=store.get('projects',projectId);
 if(!project)throw fail('NOT_FOUND','项目不存在',404);
 return project;
}
function assertProjectActive(project){
 if(['paused','stopped','archived'].includes(project.status))throw fail('PROJECT_NOT_ACTIVE','项目当前不可更改宣发计划',409);
}
function getCampaign(store,projectId,campaignId){
 const campaign=store.get('campaigns',campaignId);
 if(!campaign||campaign.projectId!==projectId)throw fail('NOT_FOUND','宣发活动不存在',404);
 return campaign;
}
function assertCurrentRevision(data,campaign){
 if(data.expected_revision!==campaign.revision)throw fail('REVISION_CONFLICT','宣发活动已被其他操作修改，请刷新后重试',409);
}
// Campaign timing is day-level owner intent, stored as YYYY-MM-DD like owner task due dates.
function parseDay(value,label){
 const v=String(value??'').trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw fail('BAD_REQUEST',label+' 必须是有效的 YYYY-MM-DD 日期');
 return v;
}
function normalizeChannels(input){
 if(!Array.isArray(input)||input.length===0||input.length>10)throw fail('BAD_REQUEST','请至少配置一个宣发渠道（最多 10 个）');
 const channels=[...new Set(input.map(x=>clean(x,80)))];
 if(channels.some(x=>!x))throw fail('BAD_REQUEST','渠道名称不能为空');
 return channels;
}
function normalizeBudget(input,previous){
 const budget={cash:previous?.cash??0,hours:previous?.hours??0};
 if(input&&typeof input==='object'&&!Array.isArray(input)){
  if(input.cash!==undefined)budget.cash=nonNegative(input.cash,'活动现金预算');
  if(input.hours!==undefined)budget.hours=nonNegative(input.hours,'活动时间预算');
 }
 return budget;
}
function campaignFields(data,previous={}){
 const name=clean(data.name??previous.name,160);
 if(!name)throw fail('BAD_REQUEST','活动名称不能为空');
 const goal=clean(data.goal??previous.goal,800);
 if(!goal)throw fail('BAD_REQUEST','活动目标不能为空');
 const channels=data.channels!==undefined?normalizeChannels(data.channels):previous.channels;
 const startAt=data.startAt!==undefined?(data.startAt?parseDay(data.startAt,'开始日期'):null):(previous.startAt??null);
 const endAt=data.endAt!==undefined?(data.endAt?parseDay(data.endAt,'结束日期'):null):(previous.endAt??null);
 if(startAt&&endAt&&endAt<startAt)throw fail('BAD_REQUEST','结束日期不能早于开始日期');
 const budget=data.budget!==undefined?normalizeBudget(data.budget,previous.budget):normalizeBudget(undefined,previous.budget);
 const notes=clean(data.notes??previous.notes??'',2000);
 return {name,goal,channels,startAt,endAt,budget,notes};
}

export function createCampaign(store,projectId,data){
 const project=getProject(store,projectId);
 assertProjectActive(project);
 const fields=campaignFields(data);
 const item=store.put('campaigns',{id:randomUUID(),projectId,...fields,status:'active',
  cancelReason:null,retrospective:null,openedAt:now(),closedAt:null,createdAt:now()});
 store.event('campaign.created',item.id,'owner',{name:item.name,status:item.status,channels:item.channels,startAt:item.startAt,endAt:item.endAt,budget:item.budget},projectId);
 return item;
}

export function adjustCampaign(store,projectId,campaignId,data){
 const project=getProject(store,projectId);
 assertProjectActive(project);
 const campaign=getCampaign(store,projectId,campaignId);
 assertCurrentRevision(data,campaign);
 if(campaign.status!=='active')throw fail('CAMPAIGN_CLOSED','已取消或已完成的活动不能调整',409);
 const fields=campaignFields(data,campaign);
 const saved=store.put('campaigns',{...campaign,...fields},campaign.revision);
 store.event('campaign.adjusted',saved.id,'owner',{name:saved.name,channels:saved.channels,startAt:saved.startAt,endAt:saved.endAt,budget:saved.budget,revision:saved.revision},projectId);
 return saved;
}

export function cancelCampaign(store,projectId,campaignId,data){
 const project=getProject(store,projectId);
 assertProjectActive(project);
 const campaign=getCampaign(store,projectId,campaignId);
 assertCurrentRevision(data,campaign);
 if(campaign.status!=='active')throw fail('CAMPAIGN_CLOSED','活动已经取消或完成',409);
 const reason=clean(data.reason,800);
 if(reason.length<8)throw fail('BAD_REQUEST','取消原因至少 8 个字，便于日后复盘追溯');
 const saved=store.put('campaigns',{...campaign,status:'cancelled',cancelReason:reason,closedAt:now()},campaign.revision);
 store.event('campaign.cancelled',saved.id,'owner',{reason},projectId);
 return saved;
}

export function completeCampaign(store,projectId,campaignId,data){
 const project=getProject(store,projectId);
 assertProjectActive(project);
 const campaign=getCampaign(store,projectId,campaignId);
 assertCurrentRevision(data,campaign);
 if(campaign.status!=='active')throw fail('CAMPAIGN_CLOSED','活动已经取消或完成',409);
 const note=clean(data.note,800);
 const saved=store.put('campaigns',{...campaign,status:'completed',closedAt:now(),completionNote:note||null},campaign.revision);
 store.event('campaign.completed',saved.id,'owner',{note:saved.completionNote},projectId);
 return saved;
}

export function recordRetrospective(store,projectId,campaignId,data){
 const project=getProject(store,projectId);
 assertProjectActive(project);
 const campaign=getCampaign(store,projectId,campaignId);
 assertCurrentRevision(data,campaign);
 if(campaign.status==='active')throw fail('CAMPAIGN_ACTIVE','活动仍在进行，先取消或完成后才能撰写复盘',409);
 const summary=clean(data.summary,4000);
 if(summary.length<20)throw fail('BAD_REQUEST','复盘结论至少 20 个字，写清实际发生的结果');
 const lessons=clean(data.lessons,2000);
 const saved=store.put('campaigns',{...campaign,retrospective:{summary,lessons,recordedBy:'owner',recordedAt:now()}},campaign.revision);
 store.event('campaign.retrospective_recorded',saved.id,'owner',{summaryLength:summary.length},projectId);
 return saved;
}

// ---- read models ----
// Overdue/due-day comparisons use the machine-local calendar day, matching how
// the owner reads dates in the UI (same convention as the owner task board).
const pad=n=>String(n).padStart(2,'0');
const localDay=value=>{const x=new Date(value);return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;};

export function publicationCalendar(contents,campaigns,nowDate=new Date()){
 const nowIso=nowDate.toISOString();
 const today=localDay(nowDate);
 const byId=new Map(campaigns.map(c=>[c.id,c]));
 return (contents||[]).filter(c=>c.plannedAt)
  .map(c=>{
   const campaign=c.campaignId?byId.get(c.campaignId)||null:null;
   const campaignClosed=campaign&&campaign.status!=='active';
   // State precedence: recorded publication first, then lateness against `now`.
   const state=c.reviewState==='published'?'published':c.plannedAt<nowIso?'overdue':localDay(c.plannedAt)===today?'due_today':'upcoming';
   // A cancelled/completed campaign stops nagging but its entries stay visible and labelled.
   // Only due-today and overdue entries actively remind; upcoming ones wait their turn.
   return {contentId:c.id,title:c.title,plannedAt:c.plannedAt,reviewState:c.reviewState,
    campaignId:campaign?.id||null,campaignName:campaign?.name||null,campaignStatus:campaign?.status||null,
    state,reminder:(state==='due_today'||state==='overdue')&&!campaignClosed};
  })
  .sort((a,b)=>a.plannedAt.localeCompare(b.plannedAt));
}

export function campaignOverview(store,project,{now:nowOverride}={}){
 if(!store.get('projects',project.id))throw fail('NOT_FOUND','项目不存在',404);
 const generatedAt=nowOverride?new Date(nowOverride):new Date();
 const campaigns=store.list('campaigns').filter(c=>c.projectId===project.id).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
 const contents=store.list('contents').filter(c=>c.projectId===project.id);
 const ledger=store.list('ledger').filter(x=>x.projectId===project.id);
 const campaignByContent=new Map(contents.map(c=>[c.id,c.campaignId||null]));
 const calendar=publicationCalendar(contents,campaigns,generatedAt);
 const today=localDay(generatedAt);
 const decorated=campaigns.map(c=>{
  const owned=contents.filter(x=>x.campaignId===c.id);
  const contentCounts={total:owned.length,
   drafts:owned.filter(x=>x.reviewState==='draft').length,
   approved:owned.filter(x=>x.reviewState==='approved').length,
   published:owned.filter(x=>x.reviewState==='published').length,
   scheduled:owned.filter(x=>x.plannedAt&&x.reviewState!=='published').length};
  // Actuals come only from actual===true ledger entries attributed via published content.
  const entries=ledger.filter(x=>x.actual===true&&x.contentId&&campaignByContent.get(x.contentId)===c.id);
  const actuals={};
  for(const type of ACTUAL_METRICS){
   const rows=entries.filter(x=>x.type===type);
   actuals[type]=rows.length?rows.reduce((sum,x)=>sum+Number(x.value||0),0):null;
  }
  return {...c,contentCounts,actuals,
   actualsNote:'仅统计 actual=true 且按内容归因到本活动的账本记录；未记录的指标为未知，不当作零，也不代表市场结果。'};
 });
 return {projectId:project.id,generatedAt:generatedAt.toISOString(),today,
  campaigns:decorated,calendar,
  reminders:{
   dueToday:calendar.filter(x=>x.reminder&&x.state==='due_today').length,
   overdue:calendar.filter(x=>x.reminder&&x.state==='overdue').length,
   campaignEndingToday:campaigns.filter(c=>c.status==='active'&&c.endAt===today).length,
   campaignOverEnd:campaigns.filter(c=>c.status==='active'&&c.endAt&&c.endAt<today).length
  },
  notes:[
   '宣发活动只组织内容与记录，不会向任何外部平台自动发布；发布一律由你手动完成并登记真实链接。',
   '到期提醒基于内容排期与本机日历日；缺失或已取消的活动不再提醒，但条目保留可见。',
   '活动复盘由你撰写，系统不推算完成度，也不把登记数据包装成因果结论。'
  ]};
}
