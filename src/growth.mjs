// Phase C · Growth data and effect attribution.
// Design rules enforced here:
// - Missing data is Unknown (null), never zero. Only explicitly recorded zeros are zero.
// - Conversion rates are shown only after numerator/denominator caliber checks
//   (same scope + window, numerator downstream of denominator, counts only).
// - Provenance distinguishes manual_entry / external_import / api_fetch / verified.
// - Revisions and retractions preserve original rows; nothing is silently rewritten.
// - Channel/campaign/content links are recorded associations, never causal attribution.
import { randomUUID, createHash } from 'node:crypto';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const now=()=>new Date().toISOString();
const clean=(v,max)=>String(v??'').trim().slice(0,max);
const round4=n=>Math.round(n*10000)/10000;

export const COUNT_METRICS=['impressions','visits','interest','trials','activation','retention'];
export const MONEY_METRICS=['income','refund','cost'];
export const GROWTH_METRICS=[...COUNT_METRICS,...MONEY_METRICS];
// Funnel stage order for caliber checks; money metrics never take part in rates.
export const FUNNEL_STAGES={impressions:1,visits:2,interest:3,trials:4,activation:5,retention:6};
export const ADJACENT_PAIRS=[['impressions','visits'],['visits','interest'],['interest','trials'],['trials','activation'],['activation','retention']];
export const PROVENANCES=['manual_entry','external_import','api_fetch'];
export const PROVENANCE_VERIFIED='verified';
const unitOf=metric=>MONEY_METRICS.includes(metric)?'CNY':'count';

function requireProject(store,projectId){
 const project=store.get('projects',projectId);
 if(!project)throw fail('NOT_FOUND','项目不存在',404);
 return project;
}
function requireChannel(store,projectId,channelId){
 const channel=channelId?store.get('growth_channels',channelId):null;
 if(!channel||channel.projectId!==projectId)throw fail('NOT_FOUND','增长渠道不存在',404);
 return channel;
}
function requireCampaign(store,projectId,campaignId,channelId){
 if(!campaignId)return null;
 const campaign=store.get('growth_campaigns',campaignId);
 if(!campaign||campaign.projectId!==projectId)throw fail('NOT_FOUND','增长活动不存在',404);
 if(channelId&&campaign.channelId!==channelId)throw fail('BAD_REQUEST','活动不属于所选渠道，已拒绝混用口径');
 return campaign;
}
function requirePublishedContent(store,projectId,contentId){
 if(!contentId)return null;
 const content=store.get('contents',contentId);
 if(!content||content.projectId!==projectId||content.reviewState!=='published')
  throw fail('BAD_CAMPAIGN_REF','只能关联当前项目已登记发布的内容',409);
 return content;
}
function parseIsoTime(value,label){
 const s=String(value??'').trim();
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)||!/(Z|[+-]\d{2}:\d{2})$/.test(s))
  throw fail('BAD_REQUEST',label+'必须包含具体日期、时间和时区');
 const ms=Date.parse(s);
 if(!Number.isFinite(ms))throw fail('BAD_REQUEST',label+'不是有效时间');
 return new Date(ms).toISOString();
}
function parseMetricValue(value){
 // Missing or mistyped values must never coerce into an explicit zero
 // (Number(null)/Number('')/Number(false) are all 0). Absent data stays absent.
 if(typeof value==='number'){
  if(!Number.isFinite(value)||value<0||value>1e12)throw fail('BAD_REQUEST','指标数值必须是不小于 0 的数字');
  return round4(value);
 }
 if(typeof value==='string'){
  const s=value.trim();
  if(!s||!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(s))throw fail('BAD_REQUEST','指标数值必须是数字；缺失的数据请直接不录入，不会按零处理');
  const n=Number(s);
  if(!Number.isFinite(n)||n<0||n>1e12)throw fail('BAD_REQUEST','指标数值必须是不小于 0 的数字');
  return round4(n);
 }
 throw fail('BAD_REQUEST','指标数值缺失或类型无效；缺失的数据请直接不录入，系统会显示为未知，不会当作零');
}
function cleanSourceRef(value,{required=false}={}){
 const s=clean(value,300);
 if(!s){
  if(required)throw fail('BAD_REQUEST','外部导入或 API 获取的数据必须填写可追溯来源（sourceRef）');
  return null;
 }
 if(/^https?:\/\//i.test(s)){
  let url;try{url=new URL(s)}catch{throw fail('BAD_REQUEST','来源引用必须是有效的 HTTPS 地址或明确的文件/记录编号');}
  if(url.protocol!=='https:')throw fail('BAD_REQUEST','来源链接必须是 HTTPS 地址');
  url.hash='';return url.href;
 }
 return s;
}

const fingerprintOf=entry=>createHash('sha256').update([
 entry.projectId,entry.channelId,entry.campaignId||'',entry.contentId||'',entry.metric,
 String(entry.value),entry.occurredAt,entry.sourceRef||'',entry.dedupKey||''].join('|')).digest('hex').slice(0,32);

/** Reject re-imports and double entries up front. Two genuinely separate but
 * identical observations can still be recorded by giving distinct dedupKeys. */
function assertNoDuplicate(store,entry){
 const active=store.list('growth_metrics').filter(x=>x.projectId===entry.projectId&&x.status==='active');
 if(entry.dedupKey&&active.some(x=>x.dedupKey===entry.dedupKey))
  throw fail('GROWTH_DUPLICATE','已存在相同来源编号（dedupKey）的记录；如确属两条独立数据，请使用不同的来源编号',409);
 const fp=fingerprintOf(entry);
 if(active.some(x=>x.fingerprint===fp))
  throw fail('GROWTH_DUPLICATE','疑似重复数据（同一渠道、指标、时间与数值）。如确属两条独立记录，请补充不同的来源编号后再录入',409);
 return fp;
}

function buildMetric(store,projectId,data){
 const metric=String(data.metric||'');
 if(!GROWTH_METRICS.includes(metric))throw fail('BAD_REQUEST','无效的增长指标类型');
 const channel=requireChannel(store,projectId,data.channelId);
 const campaign=requireCampaign(store,projectId,data.campaignId,channel.id);
 requirePublishedContent(store,projectId,data.contentId);
 const occurredAt=parseIsoTime(data.occurredAt,'统计时间');
 if(Date.parse(occurredAt)>Date.now()+60000)throw fail('BAD_REQUEST','统计时间不能晚于当前时间');
 const value=parseMetricValue(data.value);
 const provenance=PROVENANCES.includes(data.provenance)?data.provenance:'manual_entry';
 const sourceRef=cleanSourceRef(data.sourceRef,{required:provenance!=='manual_entry'});
 const isAnomaly=data.isAnomaly===true;
 const anomalyNote=isAnomaly?clean(data.anomalyNote,500):'';
 if(isAnomaly&&anomalyNote.length<5)throw fail('BAD_REQUEST','标记异常的数据必须填写异常说明（至少5个字）');
 return {projectId,channelId:channel.id,campaignId:campaign?.id||null,contentId:data.contentId||null,
  metric,value,unit:unitOf(metric),occurredAt,provenance,sourceRef,
  dedupKey:data.dedupKey?clean(data.dedupKey,120):'',notes:clean(data.notes,600),
  isAnomaly,anomalyNote};
}

export function createGrowthChannel(store,projectId,data){
 requireProject(store,projectId);
 const name=clean(data.name,80);
 if(!name)throw fail('BAD_REQUEST','渠道名称不能为空');
 if(store.list('growth_channels').some(c=>c.projectId===projectId&&c.name===name))
  throw fail('GROWTH_CHANNEL_EXISTS','同名渠道已存在',409);
 const item=store.put('growth_channels',{id:randomUUID(),projectId,name,notes:clean(data.notes,300),createdAt:now()});
 store.event('growth.channel.created',item.id,'owner',{name},projectId);
 return item;
}

export function createGrowthCampaign(store,projectId,data){
 requireProject(store,projectId);
 const channel=requireChannel(store,projectId,data.channelId);
 const name=clean(data.name,120);
 if(!name)throw fail('BAD_REQUEST','活动名称不能为空');
 const startsAt=data.startsAt?parseIsoTime(data.startsAt,'开始时间'):null;
 const endsAt=data.endsAt?parseIsoTime(data.endsAt,'结束时间'):null;
 if(startsAt&&endsAt&&Date.parse(endsAt)<Date.parse(startsAt))throw fail('BAD_REQUEST','结束时间不能早于开始时间');
 const item=store.put('growth_campaigns',{id:randomUUID(),projectId,channelId:channel.id,name,
  objective:clean(data.objective,300),startsAt,endsAt,status:'active',createdAt:now()});
 store.event('growth.campaign.created',item.id,'owner',{name,channelId:channel.id},projectId);
 return item;
}

export function recordGrowthMetric(store,projectId,data){
 requireProject(store,projectId);
 return store.transaction(()=>{
  const base=buildMetric(store,projectId,data);
  const entry={id:randomUUID(),...base,fingerprint:null,status:'active',supersedesId:null,supersededById:null,
   supersededAt:null,retractedAt:null,retractReason:null,verifiedAt:null,verifyNote:null,
   originalProvenance:base.provenance,revisionNumber:1,recordedBy:'owner',createdAt:now()};
  entry.fingerprint=assertNoDuplicate(store,entry);
  const saved=store.put('growth_metrics',entry);
  store.event('growth.metric.recorded',saved.id,'owner',
   {projectId,metric:saved.metric,value:saved.value,provenance:saved.provenance,
    channelId:saved.channelId,campaignId:saved.campaignId,contentId:saved.contentId,isAnomaly:saved.isAnomaly},projectId);
  return saved;
 });
}

/** The owner ledger (结果账本) and growth_metrics are different objects with
 * different provenance models, so growth reports never read the ledger
 * directly. Instead every ACTUAL ledger entry whose metric has an equivalent
 * caliber here is mirrored exactly once: provenance manual_entry, dedupKey
 * `ledger:<id>` makes re-runs and backfills idempotent. Deliberately unmapped
 * calibers: reuse（再次使用 ≠ retention 留存）, transaction_fee / service_cost
 * （≠ cost 的 cash_cost 口径）, user_hours / agent_hours / brand / learning
 * （增长模型无对应层级）。Missing caliber equivalents stay Unknown upstream. */
export const LEDGER_METRIC_MAP={impressions:'impressions',visits:'visits',interest:'interest',
 trials:'trials',activation:'activation',retention:'retention',income:'income',refund:'refund',cash_cost:'cost'};
export const hasLedgerMirror=ledgerEntry=>ledgerEntry.actual===true&&Boolean(LEDGER_METRIC_MAP[ledgerEntry.type]);
const LEDGER_CHANNEL_NAME='结果账本';
/** Growth metrics are channel-scoped by design; ledger mirrors share one
 * per-project bucket channel so the owner ledger stays a distinct, honestly
 * labeled source instead of being attributed to a real promotion channel. */
function ledgerChannelId(store,projectId){
 const existing=store.list('growth_channels').find(c=>c.projectId===projectId&&c.name===LEDGER_CHANNEL_NAME);
 if(existing)return existing.id;
 return store.put('growth_channels',{id:randomUUID(),projectId,name:LEDGER_CHANNEL_NAME,
  notes:'由结果账本实际记录自动镜像（manual_entry 口径）',createdAt:now()}).id;
}
/** Mirror one actual ledger entry into growth_metrics. Must run inside the
 * caller's transaction (no nested BEGIN); validation errors propagate. */
export function mirrorLedgerMetric(store,projectId,ledgerEntry){
 const metric=LEDGER_METRIC_MAP[ledgerEntry.type];
 if(!metric)return null;
 const base=buildMetric(store,projectId,{metric,value:ledgerEntry.value,occurredAt:ledgerEntry.at,
  provenance:'manual_entry',channelId:ledgerChannelId(store,projectId),contentId:ledgerEntry.contentId||null,
  dedupKey:'ledger:'+ledgerEntry.id,
  notes:ledgerEntry.notes?('账本记录：'+ledgerEntry.notes):'来自结果账本的实际记录'});
 const entry={id:randomUUID(),...base,fingerprint:null,status:'active',supersedesId:null,supersededById:null,
  supersededAt:null,retractedAt:null,retractReason:null,verifiedAt:null,verifyNote:null,
  originalProvenance:base.provenance,revisionNumber:1,recordedBy:'owner',createdAt:now()};
 entry.fingerprint=assertNoDuplicate(store,entry);
 const saved=store.put('growth_metrics',entry);
 store.event('growth.metric.mirrored',saved.id,'owner',{ledgerId:ledgerEntry.id,metric:saved.metric,value:saved.value},projectId);
 return saved;
}

/** Paste-style import of externally exported rows. Each row is validated
 * individually; duplicates and invalid rows are rejected with reasons, never merged silently. */
export function importGrowthMetrics(store,projectId,{items}={}){
 requireProject(store,projectId);
 if(!Array.isArray(items)||!items.length||items.length>200)throw fail('BAD_REQUEST','导入 items 必须是 1–200 条的数组');
 const accepted=[],rejected=[];let duplicateCount=0;
 store.transaction(()=>{
  // 判重集合一次性构建：批量导入从 O(行数×表大小) 降为 O(行数)，不再在写事务内反复全表解析。
  // 空 dedupKey 不参与判重（与 assertNoDuplicate 的真值守卫一致），否则无来源编号的合法行会被误判重复。
  const active=store.list('growth_metrics').filter(x=>x.projectId===projectId&&x.status==='active');
  const seenKeys=new Set(active.map(x=>x.dedupKey).filter(Boolean)),seenPrints=new Set(active.map(x=>x.fingerprint));
  items.forEach((raw,index)=>{
   try{
    const base=buildMetric(store,projectId,raw||{});
    const entry={id:randomUUID(),...base,fingerprint:null,status:'active',supersedesId:null,supersededById:null,
     supersededAt:null,retractedAt:null,retractReason:null,verifiedAt:null,verifyNote:null,
     originalProvenance:base.provenance,revisionNumber:1,recordedBy:'owner',createdAt:now()};
    entry.fingerprint=fingerprintOf(entry);
    if(entry.dedupKey&&seenKeys.has(entry.dedupKey))throw fail('GROWTH_DUPLICATE','已存在相同来源编号（dedupKey）的记录；如确属两条独立数据，请使用不同的来源编号',409);
    if(seenPrints.has(entry.fingerprint))throw fail('GROWTH_DUPLICATE','疑似重复数据（同一渠道、指标、时间与数值）。如确属两条独立记录，请补充不同的来源编号后再录入',409);
    if(entry.dedupKey)seenKeys.add(entry.dedupKey);seenPrints.add(entry.fingerprint);
    store.put('growth_metrics',entry);
    store.event('growth.metric.recorded',entry.id,'owner',
     {projectId,metric:entry.metric,value:entry.value,provenance:entry.provenance,imported:true},projectId);
    accepted.push(entry);
   }catch(e){
    if(e.code==='GROWTH_DUPLICATE')duplicateCount++;
    rejected.push({index,code:e.code||'ERROR',message:e.message});
   }
  });
 });
 return {acceptedCount:accepted.length,rejected,duplicateCount,
  note:'重复行已逐条跳过并说明，没有静默合并；请核对被拒绝的行后再补录'};
}

/** Revision creates a superseding active row and keeps the original row intact.
 * Changing value/time/source resets a previous owner verification. */
export function reviseGrowthMetric(store,projectId,metricId,data){
 requireProject(store,projectId);
 const reason=String(data.reason??'').trim();
 if(reason.length<10)throw fail('BAD_REQUEST','数据修订必须说明理由（至少10个字）');
 return store.transaction(()=>{
  const old=store.get('growth_metrics',metricId);
  if(!old||old.projectId!==projectId)throw fail('NOT_FOUND','增长数据不存在',404);
  if(String(old.dedupKey||'').startsWith('ledger:'))
   throw fail('BAD_STATE','该行是结果账本的自动镜像；请到结果账本修订原条目，增长页会随之更新',409);
  if(old.status!=='active')throw fail('BAD_STATE','已被修订或撤回的数据不能再修订；如需更正请先撤回原记录或修改最新版本',409);
  const base=buildMetric(store,projectId,{channelId:old.channelId,campaignId:old.campaignId,contentId:old.contentId,
   metric:old.metric,value:data.value??old.value,occurredAt:data.occurredAt??old.occurredAt,
   provenance:old.originalProvenance||old.provenance,sourceRef:data.sourceRef??old.sourceRef,
   dedupKey:data.dedupKey??old.dedupKey,notes:data.notes??old.notes,
   isAnomaly:data.isAnomaly??old.isAnomaly,anomalyNote:data.anomalyNote??old.anomalyNote});
  const entry={id:randomUUID(),...base,fingerprint:null,status:'active',supersedesId:old.id,supersededById:null,
   supersededAt:null,retractedAt:null,retractReason:null,verifiedAt:old.verifiedAt,verifyNote:old.verifyNote,
   originalProvenance:old.originalProvenance||old.provenance,revisionNumber:old.revisionNumber+1,
   recordedBy:'owner',createdAt:now()};
  entry.provenance=old.provenance;
  const coreChanged=base.value!==old.value||base.occurredAt!==old.occurredAt||(base.sourceRef||'')!==(old.sourceRef||'');
  if(old.provenance===PROVENANCE_VERIFIED&&coreChanged){
   entry.provenance=entry.originalProvenance;entry.verifiedAt=null;entry.verifyNote=null;
  }
  store.put('growth_metrics',{...old,status:'superseded',supersededById:entry.id,supersededAt:now()},old.revision);
  entry.fingerprint=assertNoDuplicate(store,entry);
  const saved=store.put('growth_metrics',entry);
  store.event('growth.metric.revised',saved.id,'owner',
   {projectId,metricId:saved.id,supersedesId:old.id,reason,revisionNumber:saved.revisionNumber,
    verificationReset:Boolean(old.verifiedAt&&!saved.verifiedAt),
    changes:{value:{from:old.value,to:saved.value},occurredAt:{from:old.occurredAt,to:saved.occurredAt}}},projectId);
  return saved;
 });
}

export function retractGrowthMetric(store,projectId,metricId,data){
 requireProject(store,projectId);
 const reason=String(data.reason??'').trim();
 if(reason.length<10)throw fail('BAD_REQUEST','撤回数据必须说明理由（至少10个字）');
 return store.transaction(()=>{
  const old=store.get('growth_metrics',metricId);
  if(!old||old.projectId!==projectId)throw fail('NOT_FOUND','增长数据不存在',404);
  if(old.status!=='active')throw fail('BAD_STATE','该数据已被修订或撤回',409);
  const saved=store.put('growth_metrics',{...old,status:'retracted',retractedAt:now(),retractReason:reason},old.revision);
  store.event('growth.metric.retracted',saved.id,'owner',
   {projectId,metric:saved.metric,value:saved.value,reason},projectId);
  return saved;
 });
}

/** Owner attests they personally checked the data source. Clearly labeled,
 * never presented as an automated verification. */
export function verifyGrowthMetric(store,projectId,metricId,data){
 requireProject(store,projectId);
 const reason=String(data.reason??'').trim();
 if(reason.length<8)throw fail('BAD_REQUEST','人工核验必须说明依据（至少8个字），例如核对了哪个后台或凭证');
 return store.transaction(()=>{
  const old=store.get('growth_metrics',metricId);
  if(!old||old.projectId!==projectId)throw fail('NOT_FOUND','增长数据不存在',404);
  if(old.status!=='active')throw fail('BAD_STATE','只有有效数据可以被核验',409);
  const saved=store.put('growth_metrics',{...old,provenance:PROVENANCE_VERIFIED,
   originalProvenance:old.originalProvenance||old.provenance,verifiedAt:now(),verifyNote:reason,
   sourceRef:data.sourceRef?cleanSourceRef(data.sourceRef):old.sourceRef},old.revision);
  store.event('growth.metric.verified',saved.id,'owner',
   {projectId,metric:saved.metric,value:saved.value,reason,previousProvenance:old.provenance},projectId);
  return saved;
 });
}

export function growthOverview(store,projectId){
 requireProject(store,projectId);
 const metrics=store.list('growth_metrics').filter(m=>m.projectId===projectId);
 const provenanceCounts={manual_entry:0,external_import:0,api_fetch:0,verified:0};
 let active=0,superseded=0,retracted=0;
 for(const m of metrics){
  if(m.status==='active'){active++;provenanceCounts[m.provenance]=(provenanceCounts[m.provenance]||0)+1;}
  else if(m.status==='superseded')superseded++;else retracted++;
 }
 return {projectId,
  channels:store.list('growth_channels').filter(c=>c.projectId===projectId),
  campaigns:store.list('growth_campaigns').filter(c=>c.projectId===projectId),
  latest:metrics.filter(m=>m.status==='active').sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.createdAt.localeCompare(a.createdAt)).slice(0,50),
  counts:{active,superseded,retracted},provenanceCounts,
  note:'增长数据按登记关联记录：相关性不代表因果归因；缺失数据按未知处理，绝不按零。'};
}

const DAY=86400000;
/** Exported for the Phase D retrospective: shared YYYY-MM-DD window parsing. */
export function parseDay(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z')))
  throw fail('BAD_REQUEST',label+'必须是有效的 YYYY-MM-DD 日期');
 return value;
}
function bucketKey(iso,granularity){
 const d=new Date(iso);
 if(granularity==='week'){const dow=(d.getUTCDay()+6)%7;return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-dow)).toISOString().slice(0,10);}
 return iso.slice(0,10);
}
function sumEntries(entries,metric){
 const rows=entries.filter(x=>x.metric===metric);
 return rows.length?round4(rows.reduce((a,x)=>a+x.value,0)):null;
}
function valuesOf(entries){
 return Object.fromEntries(GROWTH_METRICS.map(k=>[k,sumEntries(entries,k)]));
}
/** Conversion rates with explicit caliber checks. Returns a row per adjacent
 * funnel pair; every withheld rate carries a reason instead of a fake number.
 * Pairs are [upstream, downstream]; the numerator is always the downstream count. */
function conversionRows(entries){
 return ADJACENT_PAIRS.map(([upstream,downstream])=>{
  const numeratorValue=sumEntries(entries,downstream),denominatorValue=sumEntries(entries,upstream);
  const row={numerator:downstream,denominator:upstream,numeratorValue,denominatorValue,rate:null,reason:null,provenanceMixed:false};
  if(numeratorValue==null||denominatorValue==null){row.reason='unknown_data';return row;}
  if(denominatorValue===0){row.reason='zero_denominator';return row;}
  if(numeratorValue>denominatorValue){row.reason='caliber_inconsistent';return row;}
  row.provenanceMixed=new Set(entries.filter(x=>x.metric===downstream||x.metric===upstream).map(x=>x.provenance)).size>1;
  row.rate=round4(numeratorValue/denominatorValue);
  return row;
 });
}
/** Exported for the Phase D retrospective: the same anomaly scan as growthReport. */
export function detectAnomalies(entries){
 const explained=entries.filter(e=>e.isAnomaly)
  .map(e=>({id:e.id,metric:e.metric,value:e.value,occurredAt:e.occurredAt,anomalyNote:e.anomalyNote}));
 const unexplained=[];
 for(const metric of GROWTH_METRICS){
  const rows=entries.filter(e=>e.metric===metric&&!e.isAnomaly);
  if(rows.length<4)continue;
  const sorted=rows.map(e=>e.value).sort((a,b)=>a-b);
  const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  if(median<=0)continue;
  for(const e of rows)if(e.value>3*median)
   unexplained.push({id:e.id,metric,value:e.value,median,occurredAt:e.occurredAt,detectionRule:'value_above_3x_median'});
 }
 return {explained,unexplained,
  detectionNote:unexplained.length?'统计检测到异常峰值，需人工补充说明；检测只是提示，不是结论':explained.length?'异常已由人工说明':'数据点不足或没有异常，未做统计检测'};
}

export function growthReport(store,projectId,{from,to,granularity='day'}={}){
 requireProject(store,projectId);
 if(!['day','week'].includes(granularity))throw fail('BAD_REQUEST','趋势粒度只支持 day 或 week');
 const toDay=parseDay(to||new Date().toISOString().slice(0,10),'结束日期');
 const fromDay=parseDay(from||new Date(Date.parse(toDay+'T00:00:00Z')-29*DAY).toISOString().slice(0,10),'开始日期');
 if(fromDay>toDay)throw fail('BAD_REQUEST','开始日期不能晚于结束日期');
 if(Date.parse(toDay+'T00:00:00Z')-Date.parse(fromDay+'T00:00:00Z')>365*DAY)throw fail('BAD_REQUEST','时间窗口最长 366 天');
 const startMs=Date.parse(fromDay+'T00:00:00Z'),endMs=Date.parse(toDay+'T00:00:00Z')+DAY;
 const entries=store.list('growth_metrics')
  .filter(m=>m.projectId===projectId&&m.status==='active')
  .filter(m=>{const t=Date.parse(m.occurredAt);return t>=startMs&&t<endMs;});
 const bucketOrder=[],bucketMap=new Map();
 for(let t=startMs;t<endMs;t+=DAY){
  const dayIso=new Date(t).toISOString().slice(0,10);
  const key=granularity==='week'?bucketKey(dayIso+'T00:00:00Z','week'):dayIso;
  if(!bucketMap.has(key)){bucketMap.set(key,{bucket:key,values:Object.fromEntries(GROWTH_METRICS.map(k=>[k,null]))});bucketOrder.push(key);}
 }
 for(const e of entries){
  const key=granularity==='week'?bucketKey(e.occurredAt,granularity):e.occurredAt.slice(0,10);
  const bucket=bucketMap.get(key);
  if(bucket)bucket.values[e.metric]=round4((bucket.values[e.metric]??0)+e.value);
 }
 const channels=store.list('growth_channels').filter(c=>c.projectId===projectId);
 const channelName=new Map(channels.map(c=>[c.id,c.name]));
 const campaignRows=store.list('growth_campaigns').filter(c=>c.projectId===projectId).map(c=>{
  const ce=entries.filter(e=>e.campaignId===c.id);
  return {campaignId:c.id,name:c.name,channelId:c.channelId,channelName:channelName.get(c.channelId)||'未知',
   entryCount:ce.length,values:valuesOf(ce),conversions:conversionRows(ce)};
 });
 const contentTitles=new Map(store.list('contents').filter(c=>c.projectId===projectId).map(c=>[c.id,c.title]));
 const contentRows=[...new Set(entries.map(e=>e.contentId).filter(Boolean))].map(cid=>{
  const ce=entries.filter(e=>e.contentId===cid);
  return {contentId:cid,title:contentTitles.get(cid)||'内容已不存在',entryCount:ce.length,values:valuesOf(ce),conversions:conversionRows(ce)};
 });
 return {projectId,generatedAt:now(),window:{from:fromDay,to:toDay,granularity,timezone:'UTC'},
  totals:valuesOf(entries),
  conversions:conversionRows(entries),
  trend:bucketOrder.map(k=>bucketMap.get(k)),
  channels:channels.map(c=>{
   const ce=entries.filter(e=>e.channelId===c.id);
   return {channelId:c.id,name:c.name,entryCount:ce.length,values:valuesOf(ce),conversions:conversionRows(ce),
    anomalyCount:ce.filter(e=>e.isAnomaly).length};
  }),
  campaigns:campaignRows,contents:contentRows,
  anomalies:detectAnomalies(entries),
  caveats:[
   '缺失的指标一律显示为未知，不按零计算；零值只代表明确登记为零。',
   '窗口与趋势分桶按 UTC 日界切分；带本地时区录入的数据按其 UTC 日期归属，与本地日期可能相差一天。',
   '转化率只在相同范围、相同时间窗口内计算，且要求分子是分母的下游计数层级；分子大于分母视为口径不一致并拒绝展示。',
   '渠道、活动与内容级别的对比来自登记关联，只能说明相关性，不能证明因果归因。',
   '人工录入、外部导入、API 获取与已核验数据分别标注；人工核验不等于自动化验证。',
   '金额指标（收入、退款、成本）不参与转化率计算，避免计数与金额混用口径。'],
  unknownPolicy:'missing_data_is_unknown'};
}

export function growthHistory(store,projectId,{metricId='',limit=50}={}){
 requireProject(store,projectId);
 const n=Number(limit);
 if(!Number.isInteger(n)||n<1||n>200)throw fail('BAD_REQUEST','limit 必须是 1–200');
 const rows=metricId
  ?store.db.prepare("SELECT seq,kind,entity_id,actor,detail,created_at FROM events WHERE project_id=? AND entity_id=? AND kind LIKE 'growth.%' ORDER BY seq DESC LIMIT ?").all(projectId,metricId,n)
  :store.db.prepare("SELECT seq,kind,entity_id,actor,detail,created_at FROM events WHERE project_id=? AND kind LIKE 'growth.%' ORDER BY seq DESC LIMIT ?").all(projectId,n);
 return rows.map(r=>({...r,detail:JSON.parse(r.detail)}));
}
