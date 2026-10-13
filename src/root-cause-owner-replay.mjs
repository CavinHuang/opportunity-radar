import {discoveryClusters} from './discovery.mjs';
import {rootCauseConflict} from './root-cause-audit.mjs';

const ratio=(a,b)=>b?Number((a/b).toFixed(4)):null;
export function rootCauseOwnerReplay(store){
 const groups=discoveryClusters(store,{includeDismissed:true,limit:300,maxSignals:400}).items;
 const examples=[],excluded={unreviewed:0,otherDismissal:0,insufficientPairs:0};
 for(const group of groups){
  const label=group.state==='reviewed_related'?'same_problem':
   group.state==='dismissed'&&group.reviewClass==='different_problem'?'different_problem':null;
  if(!label){if(group.state==='needs_review')excluded.unreviewed++;else excluded.otherDismissal++;continue;}
  const pairs=[];
  for(let i=0;i<group.signals.length;i++)for(let j=i+1;j<group.signals.length;j++){
   const a=store.get('sources',group.signals[i].id),b=store.get('sources',group.signals[j].id);
   if(!a||!b)continue;
   const result=rootCauseConflict(a,b);
   pairs.push({leftId:a.id,rightId:b.id,flagged:result.conflict,left:result.left,right:result.right});
  }
  if(!pairs.length){excluded.insufficientPairs++;continue;}
  examples.push({groupId:group.id,fingerprint:group.fingerprint,label,
   reviewedRevision:group.reviewRevision,memberCount:group.signalCount,pairs,
   suggestedSplit:pairs.some(p=>p.flagged),reviewNote:group.reviewNote||''});
 }
 // A group-level owner decision is not independent pair-by-pair ground truth.
 const tp=examples.filter(x=>x.label==='different_problem'&&x.suggestedSplit).length;
 const fn=examples.filter(x=>x.label==='different_problem'&&!x.suggestedSplit).length;
 const fp=examples.filter(x=>x.label==='same_problem'&&x.suggestedSplit).length;
 const tn=examples.filter(x=>x.label==='same_problem'&&!x.suggestedSplit).length;
 return {sampleSize:examples.length,counts:{caughtDifferent:tp,missedDifferent:fn,falseSplitWarnings:fp,correctlyUnflaggedSame:tn},
  flaggedPrecision:ratio(tp,tp+fp),differentGroupRecall:ratio(tp,tp+fn),
  missed:examples.filter(x=>x.label==='different_problem'&&!x.suggestedSplit).slice(0,20),
  falseWarnings:examples.filter(x=>x.label==='same_problem'&&x.suggestedSplit).slice(0,20),
  examples:examples.slice(0,40),excluded,liveRuleChanged:false,autoSplit:false,
  policy:'current_membership_owner_review_group_level_only',
  notice:'只评估与当前聚合成员指纹一致的人工审核组；同一问题的人工标签也并非客观根因证明。组级标注不应当作每一对帖子的独立真值，样本存在选择偏差；不能推断全站准确率，也不自动拆分。'};
}
