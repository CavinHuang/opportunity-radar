import {rootCauseConflict} from './root-cause-audit.mjs';

// Offline experiment: require explicit high-specificity failure language in both
// descriptions; generic "slow", "wrong" or "manual effort" alone is not enough.
const signatures=[
 ['accuracy',/\b(?:incorrect (?:amounts?|results?|data)|wrong (?:amounts?|results?|data)|mismatch(?:ed)? (?:amounts?|records?|invoices?)|duplicate entries)\b|金额不匹配|对账金额错误|数据不准确/i],
 ['latency',/\b(?:takes? (?:me |us )?(?:\d+|several|multiple) hours?|time.consuming|(?:\d+|several) hours? per (?:day|week))\b|每天耗时|每周耗时|耗费\d+小时/i],
 ['access',/\b(?:permission denied|access denied|cannot log in|unauthorized access)\b|登录失败|权限不足|无法访问/i],
 ['sync',/\b(?:sync failure|sync failed|not syncing|out of sync)\b|同步失败|无法同步|不同步/i],
 ['data_loss',/\b(?:lost data|deleted data|missing files|data loss)\b|数据丢失|文件丢失/i]
];
export function strictRootCauseHint(source){
 const description=String(source.description||'').normalize('NFKC').slice(0,2400);
 const tags=signatures.filter(([,rx])=>rx.test(description)).map(([id])=>id);
 return {tags,exclusive:tags.length===1?tags[0]:null};
}
export function strictRootCauseConflict(a,b){
 const left=strictRootCauseHint(a).exclusive,right=strictRootCauseHint(b).exclusive;
 return {conflict:Boolean(left&&right&&left!==right),left,right,
  baseline:rootCauseConflict(a,b).conflict,verified:false};
}
