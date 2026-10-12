import {sourceQualityReport} from './source-quality.mjs';
/** Advisory only. No automatic pausing or deleting sources. */
export function sourceOperations(store,{nowMs=Date.now()}={}){
 const report=sourceQualityReport(store,{nowMs});
 const suggestions=report.items.map(x=>{
  const reasons=[],action=[];
  const checked=x.lastCheckedAt?Date.parse(x.lastCheckedAt):null;
  if(x.enabled&&x.consecutiveFailures>=3){reasons.push('连续失败 '+x.consecutiveFailures+' 次');action.push('检查接口授权、可访问性及是否更换来源');}
  if(x.enabled&&checked&&nowMs-checked>14*86400000){reasons.push('最近检查距离现在超过14天');action.push('重新探测来源');}
  const signals=store.list('sources').filter(s=>(s.feedIds||[]).includes(x.feedId));
  const overlaps=new Map();
  for(const signal of signals)for(const otherId of signal.feedIds||[]){
   if(otherId===x.feedId)continue;
   overlaps.set(otherId,(overlaps.get(otherId)||0)+1);
  }
  const mostOverlapping=[...overlaps.entries()].sort((a,b)=>b[1]-a[1])[0];
  const distinct=new Set(signals.map(s=>s.url)).size;
  const ratio=mostOverlapping&&distinct>=10?mostOverlapping[1]/distinct:0;
  if(x.enabled&&ratio>=.8){
   const another=store.get('feeds',mostOverlapping[0]);
   reasons.push('近似重复：至少 '+Math.round(ratio*100)+'% 的本来源文章也出现在 '+(another?.title||'其他来源')+'（按相同信号 ID 观察）');
   action.push('比较两源主题覆盖、更新延迟和人工收藏后再决定是否暂停');
  }
  if(x.enabled&&x.captured>=20&&x.linkedOpportunities===0&&x.counts.saved===0){reasons.push('已收录较多内容但没有收藏或关联机会');action.push('复核主题与筛选条件，考虑暂停');}
  if(x.enabled&&x.captured>=10&&x.counts.dismissed/x.captured>=.8){reasons.push('已收录线索中人工忽略比例较高');action.push('检查噪音关键词，考虑优化采集范围');}
  return reasons.length?{feedId:x.feedId,title:x.title,reasons,actions:action,requiresOwnerConfirmation:true,observed:{captured:x.captured,linkedOpportunities:x.linkedOpportunities,saved:x.counts.saved,failures:x.consecutiveFailures,overlapRatio:ratio||null,overlapWith:mostOverlapping?.[0]||null}}:null;
 }).filter(Boolean);
 return {generatedAt:new Date(nowMs).toISOString(),suggestions,assessed:report.items.length,notice:'这些仅是基于本地运营记录的建议，不自动停用来源，不代表商业价值'};
}
