// Owner-defined mute rules: the exclude-list complement to per-feed keyword
// include-filters. Rules apply ONLY to signals entering via scans — manual
// entries are deliberate owner actions and are never muted. Matching is
// honest case-insensitive substring on title+description (documented, no AI),
// and every muted signal keeps the matched rule for auditability and restore.
import {randomUUID} from 'node:crypto';

const clean=(v,max)=>String(v??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
export const MUTE_RULE_LIMIT=50;

export function muteRules(store){return store.list('mute_rules').filter(r=>!r.deletedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

export function createMuteRule(store,data){
 const keyword=clean(data.keyword,40);
 if(!keyword)throw Object.assign(new Error('静音关键词不能为空'),{code:'BAD_REQUEST',status:400});
 if(store.list('mute_rules').some(r=>!r.deletedAt&&r.keyword.toLocaleLowerCase()===keyword.toLocaleLowerCase()))
  throw Object.assign(new Error('同名静音关键词已存在'),{code:'MUTE_RULE_EXISTS',status:409});
 if(store.list('mute_rules').filter(r=>!r.deletedAt).length>=MUTE_RULE_LIMIT)
  throw Object.assign(new Error('静音规则最多 '+MUTE_RULE_LIMIT+' 条，请先删除不再需要的规则'),{code:'MUTE_RULE_LIMIT',status:400});
 const item=store.put('mute_rules',{id:randomUUID(),keyword,note:clean(data.note,200),createdAt:now(),deletedAt:null});
 store.event('mute_rule.created',item.id,'owner',{keyword},null);
 return item;
}

export function deleteMuteRule(store,id){
 const rule=store.get('mute_rules',id);
 if(!rule||rule.deletedAt)throw Object.assign(new Error('静音规则不存在'),{code:'NOT_FOUND',status:404});
 const item=store.put('mute_rules',{...rule,deletedAt:now()});
 store.event('mute_rule.deleted',id,'owner',{keyword:rule.keyword},null);
 return item;
}

/** Pure decision helper so matching is testable without a network scan:
 * returns the first rule whose keyword appears (case-insensitive) in the
 * candidate title or description, or null. Substring semantics are the
 * documented behavior — rules are blunt instruments, owners write them. */
export function evaluateMuteRules(rules,candidate){
 const text=(clean(candidate.title,1000)+' '+clean(candidate.description,1000)).toLocaleLowerCase();
 return muteRulesOf(rules).find(r=>text.includes(r.keyword.toLocaleLowerCase()))||null;
}
const muteRulesOf=rules=>rules.filter(r=>!r.deletedAt);

/** Owner-initiated "apply now": evaluate every untriaged (new) signal against
 * the current rules — the explicit complement to scan-time muting, so a fresh
 * rule does not have to wait for the next scan. Converted and already-triaged
 * signals are untouched by design; the owner's click is the authorization. */
export function applyMuteRules(store){
 const rules=muteRules(store);
 if(!rules.length)return {scanned:0,applied:0,note:'没有静音规则'};
 return store.transaction(()=>{
  let scanned=0,applied=0;
  for(const signal of store.list('sources')){
   if(signal.status!=='new')continue;
   scanned++;
   const rule=evaluateMuteRules(rules,signal);
   if(!rule)continue;
   store.put('sources',{...signal,status:'dismissed',muteRule:{id:rule.id,keyword:rule.keyword},triagedAt:now()},signal.revision);
   store.event('signal.muted',signal.id,'owner',{ruleId:rule.id,keyword:rule.keyword,origin:'apply'});
   applied++;
  }
  return {scanned,applied,note:'只影响待研判（new）状态的信号；已收藏、已忽略、已关联机会的信号不会被触碰。'};
 });
}
