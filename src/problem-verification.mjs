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
 const c=opportunityScanCandidates(store,{limit:50}).items.find(x=>x.id===id);
 if(!c)throw fail('CANDIDATE_NOT_FOUND','候选已变更或不存在',404);
 const evidence=c.signalIds.map(i=>store.get('sources',i)).filter(Boolean);
 const fingerprint=createHash('sha256').update(JSON.stringify(evidence.map(s=>[s.id,s.url,s.title,s.description,s.revision]))).digest('hex');
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
 const item=store.put('problem_verifications',{id,fingerprint,firsthandConfirmed,actualWorkaround:workaround,impactConfirmed,alternativeAdequacy,decision,notes:reason,at:new Date().toISOString()},old?.revision||0);
 store.event('problem.verification.reviewed',id,'owner',{decision,revision:item.revision});
 return item;
}
export function verifiedProblemCards(store){return opportunityScanCandidates(store,{limit:50}).items.map(c=>({id:c.id,title:c.title,verification:store.get('problem_verifications',c.id)||null,firsthand:verificationContext(store,c.id).firsthand}));}
