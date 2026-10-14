import {createHash,randomUUID} from 'node:crypto';
import {crossWeekResearchDossier} from './opportunity-cross-week-dossier.mjs';
import {researchDecisionGuidance} from './opportunity-research-guidance.mjs';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(value,max=1000)=>typeof value==='string'?value.trim().slice(0,max):'';
const responseTypes=new Set(['accepted','adapted','declined']);
const followupTypes=new Set(['helpful','not_helpful','uncertain']);
function fingerprint(dossier,guidance){
 return createHash('sha256').update(JSON.stringify({
  candidateId:guidance.candidateId,action:guidance.action,
  headline:guidance.headline,reviewFlags:guidance.reviewFlags,
  weeks:dossier.weeks,origins:dossier.originHistory
 })).digest('hex');
}
function requireUrl(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>2000)throw fail('INVALID_EVIDENCE_URL','证据链接格式无效');
 let url;
 try{url=new URL(value.trim());}catch{throw fail('INVALID_EVIDENCE_URL','证据链接必须是 HTTPS 地址');}
 if(url.protocol!=='https:'||url.username||url.password||!url.hostname)throw fail('INVALID_EVIDENCE_URL','证据链接必须是未包含账号密码的 HTTPS 地址');
 return url.toString();
}
// This is feedback about the advisory, NOT the existing formal investment decision ledger.
export function researchGuidanceFeedbackBoard(store,candidateId){
 const guidance=researchDecisionGuidance(store,candidateId);
 const dossier=crossWeekResearchDossier(store,candidateId);
 const entries=store.list('opportunity_research_guidance_feedback')
  .filter(x=>x.candidateId===candidateId)
  .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||String(b.id).localeCompare(String(a.id)));
 const formalDecisions=store.list('opportunity_decision_history')
  .filter(x=>x.problemId===candidateId)
  .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
  .slice(0,20).map(x=>({id:x.id,adopted:x.adopted,createdAt:x.createdAt}));
 const closed=entries.filter(x=>x.followup);
 return {candidateId,title:guidance.title,guidance,fingerprint:fingerprint(dossier,guidance),
  entries:entries.slice(0,50),hasMore:entries.length>50,formalDecisions,
  summary:{total:entries.length,accepted:entries.filter(x=>x.response==='accepted').length,
   adapted:entries.filter(x=>x.response==='adapted').length,
   declined:entries.filter(x=>x.response==='declined').length,
   pending:entries.length-closed.length,followedUp:closed.length,
   helpful:closed.filter(x=>x.followup.assessment==='helpful').length,
   notHelpful:closed.filter(x=>x.followup.assessment==='not_helpful').length,
   uncertain:closed.filter(x=>x.followup.assessment==='uncertain').length},
  readOnly:true,marketValidated:false,
  notice:'此账本只用于评估研究建议的可用性。采纳不等于正式机会投资决策；后续结果为人工自报，不据此推断模型准确率、业务收益或因果效果。正式投入请使用既有机会决策账本。'};
}
export function recordResearchGuidanceFeedback(store,candidateId,data={}){
 const board=researchGuidanceFeedbackBoard(store,candidateId);
 if(data.fingerprint!==board.fingerprint)throw fail('STALE_GUIDANCE','研究记录已变化，请重新读取建议',409);
 if(!responseTypes.has(data.response))throw fail('INVALID_RESPONSE','请选择采纳、调整或不采纳');
 const reason=clean(data.reason);
 if(reason.length<12)throw fail('REASON_REQUIRED','请填写不少于12字的处理依据');
 const chosenAction=clean(data.chosenAction,400);
 if(data.response==='adapted'&&chosenAction.length<10)throw fail('ACTION_REQUIRED','调整建议时需填写至少10字的实际行动');
 const linkedDecisionId=clean(data.linkedDecisionId,128)||null;
 if(linkedDecisionId&&!board.formalDecisions.some(x=>x.id===linkedDecisionId))
  throw fail('INVALID_DECISION_LINK','只能关联同一机会的已有正式决策',409);
 return store.transaction(()=>{
  const latest=researchGuidanceFeedbackBoard(store,candidateId);
  if(latest.fingerprint!==data.fingerprint)throw fail('STALE_GUIDANCE','研究记录已变化，请重新读取建议',409);
  if(latest.entries.some(x=>x.fingerprint===data.fingerprint)||store.list('opportunity_research_guidance_feedback').some(x=>x.candidateId===candidateId&&x.fingerprint===data.fingerprint))
   throw fail('ALREADY_RECORDED','当前证据版本的建议已记录反馈，可回填后续结果',409);
  const row=store.put('opportunity_research_guidance_feedback',{
   id:randomUUID(),candidateId,fingerprint:data.fingerprint,
   recommendation:{action:board.guidance.action,headline:board.guidance.headline,
    latestWeek:board.guidance.latestWeek,latestFinding:board.guidance.latestFinding,
    reasons:board.guidance.reasons.map(x=>({code:x.code,message:x.message})),
    nextSteps:[...board.guidance.nextSteps]},
   response:data.response,reason,chosenAction:data.response==='adapted'?chosenAction:null,
   linkedDecisionId,createdAt:new Date().toISOString(),followup:null
  });
  store.event('opportunity.research_guidance.feedback_recorded',candidateId,'owner',{entryId:row.id,response:row.response,linkedDecisionId});
  return row;
 });
}
export function recordResearchGuidanceFollowup(store,candidateId,entryId,data={}){
 if(typeof entryId!=='string'||!entryId||entryId.length>128)throw fail('BAD_ENTRY','无效反馈记录');
 if(!followupTypes.has(data.assessment))throw fail('INVALID_ASSESSMENT','请选择有帮助、无帮助或仍无法判断');
 const notes=clean(data.notes,1500);
 if(notes.length<12)throw fail('NOTES_REQUIRED','请填写至少12字的实际观察结果');
 const actualHours=data.actualHours;
 if(typeof actualHours!=='number'||!Number.isFinite(actualHours)||actualHours<0||actualHours>1000)
  throw fail('INVALID_HOURS','实际投入小时必须在0至1000之间');
 const evidenceUrl=requireUrl(data.evidenceUrl);
 if(!Number.isInteger(data.expected_revision)||data.expected_revision<1)throw fail('REVISION_CONFLICT','请刷新记录后提交',409);
 return store.transaction(()=>{
  const row=store.get('opportunity_research_guidance_feedback',entryId);
  if(!row||row.candidateId!==candidateId)throw fail('FEEDBACK_NOT_FOUND','没有找到当前机会的反馈记录',404);
  if(row.followup)throw fail('FOLLOWUP_EXISTS','此条建议已有后续结果，不允许覆盖历史',409);
  if(row.revision!==data.expected_revision)throw fail('REVISION_CONFLICT','反馈记录已更新，请刷新',409);
  const saved=store.put('opportunity_research_guidance_feedback',{
   ...row,followup:{assessment:data.assessment,notes,actualHours,evidenceUrl,
    recordedAt:new Date().toISOString(),selfReported:true}
  },row.revision);
  store.event('opportunity.research_guidance.followup_recorded',candidateId,'owner',{entryId,assessment:data.assessment,evidenceLinked:Boolean(evidenceUrl)});
  return saved;
 });
}
