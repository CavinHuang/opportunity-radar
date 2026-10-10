import {randomUUID} from 'node:crypto';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const time=()=>new Date().toISOString();
function required(value,label,min=4,max=800){
 const v=String(value??'').trim();
 if(v.length<min||v.length>max)throw fail('VALIDATION_INPUT',label+' 需要 '+min+'–'+max+' 个字符');
 return v;
}
function amount(value,label,max){
 const n=Number(value);if(!Number.isFinite(n)||n<0||n>max)throw fail('VALIDATION_INPUT',label+' 必须介于 0 和 '+max+' 之间');return n;
}
function link(value){
 if(!value)return null;
 let url;try{url=new URL(value)}catch{throw fail('VALIDATION_INPUT','证据 URL 无效');}
 if(url.protocol!=='https:'||url.username||url.password)throw fail('VALIDATION_INPUT','证据 URL 必须为无凭据的 HTTPS 地址');
 url.hash='';return url.href;
}
function opportunity(store,id){
 const o=store.get('opportunities',id);if(!o)throw fail('NOT_FOUND','机会不存在',404);return o;
}
const plans=(store,id)=>store.list('validation_plans').filter(x=>x.opportunityId===id).reverse().sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
const rows=(store,id)=>store.list('validation_observations').filter(x=>x.planId===id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));

export function validationSummary(store,id){
 opportunity(store,id);
 const history=plans(store,id),latest=history.at(-1)||null,observations=latest?rows(store,latest.id):[];
 const counts={supports:0,contradicts:0,unclear:0};for(const item of observations)counts[item.stance]++;
 return {opportunityId:id,latestPlan:latest,planCount:history.length,observations,observationCount:observations.length,
  distinctParticipantRefs:new Set(observations.map(x=>x.participantRef.toLowerCase())).size,
  counts,independentlyVerifiedCount:0,
  evidenceStatement:'All observations are Owner-reported. Sources and participant identity have not been independently verified.',
  decisions:history.filter(x=>x.status==='closed').map(x=>({id:x.id,outcome:x.outcome,reason:x.decisionReason,closedAt:x.closedAt}))};
}
export function validationOverview(store){
 return store.list('opportunities').map(o=>{
  const list=plans(store,o.id),latest=list.at(-1)||null,observations=latest?rows(store,latest.id):[];
  return {opportunityId:o.id,latestPlanId:latest?.id||null,status:latest?.status||'not_started',
   outcome:latest?.outcome||null,observations:observations.length,
   distinctParticipantRefs:new Set(observations.map(x=>x.participantRef.toLowerCase())).size};
 });
}
export function createValidationPlan(store,id,input){
 opportunity(store,id);
 return store.transaction(()=>{
  if(plans(store,id).some(x=>x.status==='active'))throw fail('VALIDATION_ACTIVE','该机会已有进行中的验证计划',409);
  const item=store.put('validation_plans',{id:randomUUID(),opportunityId:id,status:'active',
   audience:required(input.audience,'目标用户'),
   hypothesis:required(input.hypothesis,'可证伪假设',12,1000),
   researchQuestion:required(input.researchQuestion,'验证问题',10,800),
   channel:required(input.channel,'接触渠道'),
   successCriterion:required(input.successCriterion,'成功证据',12,800),
   stopCondition:required(input.stopCondition,'停止条件',12,800),
   timeBudgetHours:amount(input.timeBudgetHours??10,'个人时间预算',10),
   cashBudget:amount(input.cashBudget??0,'现金预算',100000),
   nextAction:required(input.nextAction,'下一步行动',8,800),
   createdAt:time(),approvedBy:'owner',outcome:null,closedAt:null,decisionReason:null});
  store.event('validation.plan.approved',item.id,'owner',{opportunityId:id});
  return item;
 });
}
export function recordValidationObservation(store,id,planId,input){
 opportunity(store,id);
 return store.transaction(()=>{
  const plan=store.get('validation_plans',planId);
  if(!plan||plan.opportunityId!==id)throw fail('NOT_FOUND','验证计划不存在',404);
  if(plan.status!=='active')throw fail('VALIDATION_CLOSED','已结束的验证计划不能新增记录',409);
  if(!['interview','observed_use','repeat_use','payment','other'].includes(input.kind))throw fail('VALIDATION_INPUT','无效的证据类型');
  if(!['supports','contradicts','unclear'].includes(input.stance))throw fail('VALIDATION_INPUT','请选择支持、反驳或未知');
  const note=required(input.note,'观察内容',20,2400);
  const ref=required(input.participantRef,'匿名参与者代号',2,64);
  if(/[@\s]|\d{11}/.test(ref))throw fail('VALIDATION_INPUT','参与者仅使用不含联系方式的匿名代号');
  if(input.consentConfirmed!==true)throw fail('CONSENT_REQUIRED','请确认已获得记录反馈所需的同意',409);
  const item=store.put('validation_observations',{id:randomUUID(),opportunityId:id,planId,participantRef:ref,
   kind:input.kind,stance:input.stance,note,evidenceUrl:link(input.evidenceUrl),
   consentConfirmed:true,basis:'owner_reported',independentlyVerified:false,createdAt:time(),recordedBy:'owner'});
  store.event('validation.observation.recorded',item.id,'owner',{opportunityId:id,planId,kind:item.kind,stance:item.stance});
  return item;
 });
}
export function closeValidationPlan(store,id,planId,input){
 opportunity(store,id);
 return store.transaction(()=>{
  const plan=store.get('validation_plans',planId);
  if(!plan||plan.opportunityId!==id)throw fail('NOT_FOUND','验证计划不存在',404);
  if(plan.status!=='active')throw fail('VALIDATION_CLOSED','计划已结束',409);
  if(plan.revision!==input.expected_revision)throw fail('REVISION_CONFLICT','验证计划已被更新，请刷新',409);
  if(!['continue','pivot','stop','inconclusive'].includes(input.outcome))throw fail('VALIDATION_INPUT','请选择继续、调整、停止或仍未知');
  const reason=required(input.reason,'决策依据',16,1600),observations=rows(store,planId);
  if(input.outcome==='continue'&&observations.length===0)throw fail('INSUFFICIENT_OBSERVATIONS','没有真实观察记录，不能标记为继续投入',409);
  if(input.outcome==='continue'&&input.acknowledgeUncertainty!==true)throw fail('UNCERTAINTY_ACK_REQUIRED','继续投入仍需确认现有证据的不确定性',409);
  const updated=store.put('validation_plans',{...plan,status:'closed',outcome:input.outcome,
   decisionReason:reason,closedAt:time(),decisionBy:'owner',observationsAtDecision:observations.length,
   actualEvidenceVerified:false},plan.revision);
  store.event('validation.plan.closed',updated.id,'owner',{opportunityId:id,outcome:updated.outcome,observationCount:observations.length});
  return updated;
 });
}
