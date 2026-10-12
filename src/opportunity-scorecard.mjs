import {opportunityScanCandidates} from './opportunity-scan.mjs';
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const DEFAULT={friction:3,corroboration:2,domainFit:2,competitiveClarity:1,validationReadiness:2};
const dimensions=Object.keys(DEFAULT);
export function scorecardConfig(store){return store.get('scorecard_config','default')||{id:'default',weights:DEFAULT,focusDomains:[],revision:0};}
export function updateScorecardConfig(store,data){
 const current=scorecardConfig(store);
 if(data.expected_revision!==current.revision)throw fail('REVISION_CONFLICT','评分配置已更新，请刷新',409);
 if(!data.weights||typeof data.weights!=='object'||Object.keys(data.weights).sort().join(',')!==dimensions.slice().sort().join(','))throw fail('BAD_WEIGHTS','评分维度不完整');
 const weights={};
 for(const name of dimensions){const x=data.weights[name];if(!Number.isInteger(x)||x<0||x>5)throw fail('BAD_WEIGHTS','权重必须为 0–5 的整数');weights[name]=x;}
 if(!Object.values(weights).some(Boolean))throw fail('BAD_WEIGHTS','至少需要一个非零权重');
 const focus=Array.isArray(data.focusDomains)?data.focusDomains:[];
 if(focus.length>8||focus.some(x=>typeof x!=='string'||!/^[a-z_]{2,35}$/.test(x)))throw fail('BAD_DOMAINS','领域选择无效');
 const result=store.put('scorecard_config',{id:'default',weights,focusDomains:[...new Set(focus)]},current.revision);
 store.event('scorecard.config.updated','default','owner',{weights,focusDomains:result.focusDomains});
 return result;
}
export function opportunityScoreboard(store){
 const config=scorecardConfig(store);
 const raw=opportunityScanCandidates(store,{limit:50});
 const items=raw.items.map(c=>{
  const q=c.qualityReview||{};
  const factors={
   friction:Math.min(2,(c.reasons||[]).filter(x=>/重复|摩擦|替代|障碍|手动/.test(x)).length),
   corroboration:c.signalCount>1?1:0,
   domainFit:config.focusDomains.length&&q.domains?.some(d=>config.focusDomains.includes(d.id))?1:0,
   competitiveClarity:c.competitionMentioned?1:0,
   validationReadiness:(c.sourceUrls?.length&&q.nextSteps?.length)?1:0
  };
  const numerator=dimensions.reduce((s,k)=>s+factors[k]*config.weights[k],0);
  const max=dimensions.reduce((s,k)=>s+2*config.weights[k],0);
  const attentionIndex=Math.round(100*numerator/max);
  const stage='worth_attention';
  return {id:c.id,title:c.title,attentionIndex,stage,factors,sourceUrls:c.sourceUrls||[],reason:'仅依据公开线索的可核查程度与规则匹配排序；缺乏独立需求、技术成本和付费证据，不可升级为值得投入',blockedBy:['未证明独立需求','未评估技术可行性与预算','未证实付费意愿'],scoreType:'signal_attention_index_not_market_score'};
 }).sort((a,b)=>b.attentionIndex-a.attentionIndex||a.id.localeCompare(b.id));
 return {config,items,scanned:raw.examined,generatedAt:new Date().toISOString(),notice:'关注指数不代表市场机会优先级、用户数量或投入建议。所有候选只到值得关注层级；值得验证和投入需要额外人工证据。'};
}
