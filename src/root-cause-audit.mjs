// Narrow, explicit failure signatures. These are text hints, NOT verified root causes.
const causes=[
 ['accuracy',/(?:incorrect|wrong|mismatch|mismatched|inaccurate|duplicate entries|错误|不准确|不匹配|对不上|重复数据)/i],
 ['latency',/(?:slow|takes hours|time.consuming|tedious|manual effort|耗时|太慢|花费.*时间|手工工作量)/i],
 ['access',/(?:permission denied|unauthorized|access denied|cannot log in|登录失败|无权限|权限不足|无法访问)/i],
 ['sync',/(?:out of sync|sync failure|sync failed|not syncing|同步失败|无法同步|不同步)/i],
 ['data_loss',/(?:data loss|lost data|missing files|deleted data|数据丢失|文件丢失|记录消失)/i]
];
export function rootCauseHints(signal){
 const description=String(signal.description||'').normalize('NFKC').slice(0,2400);
 const matching=causes.filter(([,rx])=>rx.test(description)).map(([name])=>name);
 return {tags:matching,exclusive:matching.length===1?matching[0]:null,
  caveat:'仅对正文明确出现的故障现象分类，不是已验证的根因；多现象或无现象时不做排斥判断'};
}
export function rootCauseConflict(a,b){
 const left=rootCauseHints(a),right=rootCauseHints(b);
 const conflict=Boolean(left.exclusive&&right.exclusive&&left.exclusive!==right.exclusive);
 return {conflict,left:left.exclusive,right:right.exclusive,reason:conflict?'正文明确描述不同故障现象，建议拆分核查':null,
  verified:false};
}
export function clusterRootCauseAudit(groups){
 const flagged=[];
 for(const group of groups){
  const signals=group.signals||group.members||[];
  const conflicts=[];
  for(let i=0;i<signals.length;i++)for(let j=i+1;j<signals.length;j++){
   const result=rootCauseConflict(signals[i],signals[j]);
   if(result.conflict)conflicts.push({a:signals[i].id,b:signals[j].id,left:result.left,right:result.right});
  }
  if(conflicts.length)flagged.push({groupId:group.id||signals[0].id,conflicts:conflicts.slice(0,20),
   reviewState:group.state||'unreviewed',suggestion:'核对原帖后决定是否将不同问题拆分，不能仅凭词汇自动拆分'});
 }
 return {flagged,flaggedGroups:flagged.length,autoSplit:false,
  notice:'严格依据正文故障现象词汇提出人工复核建议；词汇不同不一定是不同根因，词汇相同也不证明相同问题。'};
}
