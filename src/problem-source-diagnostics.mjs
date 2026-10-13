import {assessRealProblem} from './real-problem.mjs';
import {firsthandHint} from './problem-verification.mjs';
export function problemSourceDiagnostics(store,{sampleLimit=200}={}){
 const feeds=store.list('feeds'),sources=store.list('sources');
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
  return {feedId:f.id,title:f.title||f.url,sampled:own.length,concreteProblems:concrete.length,possibleFirsthand:firsthand.length,possibleSecondhand:secondhand.length,promotions:promotions.length,flags,examples:concrete.slice(0,3).map(s=>({title:s.title,url:s.url}))};
 });
 return {items,notice:'仅统计已采集文本的启发式识别结果；无样本不评分，不能证明发帖者身份或用户需求，不会自动调整来源'};
}
