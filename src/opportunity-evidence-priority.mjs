import {assessRealProblem} from './real-problem.mjs';

// Evidence-first ordering: this is a review priority, never an estimate of market size.
const canonical=raw=>{try{const u=new URL(raw);if(u.protocol!=='https:')return null;u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid|ref|source)$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.toString().replace(/\/$/,'');}catch{return null}};
const token=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function evidenceFingerprint(source){
 const url=canonical(source.url);
 return url||'text:'+token(source.title).slice(0,180)+'|'+token(source.description).slice(0,240);
}
export function reviewPriority(signals,{assess=assessRealProblem,possibleRepost=false}={}){
 const seen=new Set(),accepted=[];
 for(const s of signals){
  if(!assess(s).qualified)continue;
  const key=evidenceFingerprint(s);
  if(seen.has(key))continue;
  seen.add(key);accepted.push(s);
 }
 const assessments=accepted.map(assess);
 const withWorkaround=assessments.filter(a=>a.flags.workaround).length;
 const explicitQuestions=assessments.filter(a=>a.flags.question).length;
 const sources=accepted.length;
 // Only count distinct source records, not inferred people; repost warning reduces priority.
 const priority=Math.min(12,sources*2)+Math.min(4,withWorkaround*2)+Math.min(2,explicitQuestions)-(possibleRepost?4:0);
 const blockers=[];
 if(sources===0)blockers.push('没有合格的原始问题描述');
 if(withWorkaround===0)blockers.push('尚未发现当前替代做法');
 if(possibleRepost)blockers.push('存在转载或重复内容风险');
 if(sources<2)blockers.push('只有单条可核查来源，不能证明问题重复发生');
 return {priority:Math.max(0,priority),qualifiedSources:sources,workaroundSources:withWorkaround,questionSources:explicitQuestions,
  sourceIds:accepted.map(s=>s.id),blockers,reviewTier:sources>=2&&withWorkaround>0&&!possibleRepost?'corroborate_originals':sources?'inspect_original':'insufficient_evidence',
  caveat:'来源记录不等于独立用户；评分仅用于安排核查顺序，不是市场规模、需求确定性或付费意愿。'};
}
