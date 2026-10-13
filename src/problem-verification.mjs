import {opportunityScanCandidates} from './opportunity-scan.mjs';
import {createHash} from 'node:crypto';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const direct=/\b(?:i|my|i'm|i've|we|our)\b|我(?:们)?|自己|亲自/i;
const secondhand=/\b(?:according to|report says|users say|someone said|top \d+|sponsored|press release)\b|据报道|听说|有人说|转载|推广|广告|盘点/i;
export function firsthandHint(signal){
 const text=String(signal.title||'')+' '+String(signal.description||'');
 return {level:secondhand.test(text)?'possible_secondhand':direct.test(text)?'possible_firsthand':'unknown',
  note:'仅为文本来源类型提示；无法确认作者身份、真实经历或转载关系'};
}
export function verificationContext(store,id){
 const candidates=opportunityScanCandidates(store,{limit:50}).items;
 // 已核查的问题以记录中保存的稳定信号 ID 为锚：候选窗口变化（聚类合并、滑出
 // top-50）后，访谈与实验链路仍能解析上下文，存量记录不再 404 变成孤儿。
 const saved=store.get('problem_verifications',id);
 const c=candidates.find(x=>x.id===id)
  ||(saved&&saved.signalIds?.length
    ?candidates.find(x=>(x.signalIds||[]).some(s=>saved.signalIds.includes(s)))
      ||{id:saved.id,title:saved.title||saved.id,signalIds:saved.signalIds,sourceUrls:[],archived:true}
    :null);
 if(!c)throw fail('CANDIDATE_NOT_FOUND','候选已变更或不存在',404);
 const evidence=c.signalIds.map(i=>store.get('sources',i)).filter(Boolean);
 // 指纹只含内容字段（id/URL/标题/摘要）：分诊、静音、多源合并等非内容操作
 // 不应使已核查证据作废。
 const fingerprint=createHash('sha256').update(JSON.stringify(evidence.map(s=>[s.id,s.url,s.title,s.description]))).digest('hex');
 return {candidate:c,fingerprint,firsthand:evidence.map(s=>({sourceId:s.id,url:s.url,...firsthandHint(s)}))};
}
export function verifyProblem(store,id,{fingerprint,firsthandConfirmed,actualWorkaround,impactConfirmed,alternativeAdequacy,decision,notes,expected_revision}={}){
 const ctx=verificationContext(store,id);
 if(ctx.fingerprint!==fingerprint)throw fail('STALE_EVIDENCE','原帖证据已有变化，请重新查看',409);
 const allowed=['needs_more_evidence','worth_interviewing','not_a_real_problem'];
 if(!allowed.includes(decision)||!['adequate','inadequate','unknown'].includes(alternativeAdequacy)||typeof firsthandConfirmed!=='boolean'||typeof impactConfirmed!=='boolean')throw fail('BAD_VERIFICATION','核查选项不完整');
 const reason=String(notes||'').trim().slice(0,800),workaround=String(actualWorkaround||'').trim().slice(0,400);
 if(reason.length<10)throw fail('REASON_REQUIRED','请填写至少10字的核查依据');
 if(decision==='worth_interviewing'&&(!firsthandConfirmed||!impactConfirmed||alternativeAdequacy!=='inadequate'||!workaround))throw fail('INSUFFICIENT_VERIFICATION','优先访谈必须确认一手经历、实际影响和现有替代方案不足');
 const old=store.get('problem_verifications',id);
 if(expected_revision!==(old?.revision||0))throw fail('REVISION_CONFLICT','核查记录已被更新',409);
 // 保存稳定信号锚点与标题快照：候选窗口变化后，后续链路据此解析上下文。
 const item=store.put('problem_verifications',{id,fingerprint,signalIds:[...(ctx.candidate.signalIds||[])],title:ctx.candidate.title,firsthandConfirmed,actualWorkaround:workaround,impactConfirmed,alternativeAdequacy,decision,notes:reason,at:new Date().toISOString()},old?.revision||0);
 store.event('problem.verification.reviewed',id,'owner',{decision,revision:item.revision});
 return item;
}
export function verifiedProblemCards(store){return opportunityScanCandidates(store,{limit:50}).items.map(c=>({id:c.id,title:c.title,verification:store.get('problem_verifications',c.id)||null,firsthand:verificationContext(store,c.id).firsthand}));}
