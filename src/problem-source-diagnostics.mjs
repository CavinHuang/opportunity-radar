import {assessRealProblem} from './real-problem.mjs';
import {firsthandHint} from './problem-verification.mjs';
export function problemSourceDiagnostics(store,{sampleLimit=200}={}){
 const feeds=store.list('feeds'),sources=store.list('sources');
 const labels=new Map(store.list('discovery_quality_labels').map(x=>[x.id,x]));
 const items=feeds.map(f=>{
  const own=sources.filter(s=>(s.feedIds||[]).includes(f.id)).slice(0,sampleLimit);
  const concrete=own.filter(s=>assessRealProblem(s).qualified);
  const firsthand=concrete.filter(s=>firsthandHint(s).level==='possible_firsthand');
  const secondhand=own.filter(s=>firsthandHint(s).level==='possible_secondhand');
  const promotions=own.filter(s=>assessRealProblem(s).flags.promotion);
  const flags=[];
  if(own.length>=5&&concrete.length/own.length<.15)flags.push('具体用户问题线索比例较低');
  if(own.length>=5&&promotions.length/own.length>.5)flags.push('发布宣传类文本较多');
  if(own.length>=5&&secondhand.length/own.length>.5)flags.push('可能存在较多二手转述');
  const current=own.map(s=>({source:s,label:labels.get(s.id)})).filter(x=>x.label&&x.label.sourceRevision===x.source.revision);
  const reviewed=current.filter(x=>x.label.label!=='uncertain');
  const actualReal=reviewed.filter(x=>x.label.label==='real_problem');
  const falseNegative=actualReal.filter(x=>!assessRealProblem(x.source).qualified);
  const falsePositive=reviewed.filter(x=>x.label.label==='not_problem'&&assessRealProblem(x.source).qualified);
  const stale=own.filter(s=>{const l=labels.get(s.id);return l&&l.sourceRevision!==s.revision;}).length;
  // Counts are evidence from voluntarily reviewed, non-representative examples;
  // do not silently auto-disable feeds or infer a population error rate.
  const reviewAdvice=reviewed.length<5?'collect_more_labels':
    falseNegative.length?'inspect_missed_problems':
    falsePositive.length?'inspect_false_positives':'continue_monitoring';
  return {feedId:f.id,title:f.title||f.url,sampled:own.length,concreteProblems:concrete.length,possibleFirsthand:firsthand.length,possibleSecondhand:secondhand.length,promotions:promotions.length,flags,examples:concrete.slice(0,3).map(s=>({title:s.title,url:s.url})),
   humanReview:{currentLabels:current.length,usableLabels:reviewed.length,uncertain:current.length-reviewed.length,stale,falseNegative:falseNegative.length,falsePositive:falsePositive.length,
    advice:reviewAdvice,missedExamples:falseNegative.slice(0,3).map(x=>({sourceId:x.source.id,title:x.source.title,url:x.source.url})),falsePositiveExamples:falsePositive.slice(0,3).map(x=>({sourceId:x.source.id,title:x.source.title,url:x.source.url}))}};
 });
 return {items,notice:'启发式结果与人工标注分开展示。人工标注仅代表已核对的小样本且可有选择偏差；相同帖子可属于多个订阅源，不能跨源加总为独立用户、总体准确率或付费需求，也不会自动关闭来源或调整规则'};
}
