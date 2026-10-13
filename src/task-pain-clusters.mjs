import {assessRealProblem} from './real-problem.mjs';
import {evidenceFingerprint} from './opportunity-evidence-priority.mjs';

// Explicit task vocabulary, not a general semantic embedding model. Unknown tasks
// remain isolated; a shared topic ("AI", "tools") is insufficient to merge.
const tasks=[
 ['invoice_reconciliation',/(invoice|invoices|发票|账单).{0,90}(reconcil|match|对账|核对)|(reconcil|match|对账|核对).{0,90}(invoice|invoices|发票|账单)/i],
 ['invoice_entry',/(invoice|invoices|receipt|receipts|发票|收据).{0,90}(copy|enter|entry|extract|录入|复制|提取)|(copy|enter|entry|extract|录入|复制|提取).{0,90}(invoice|invoices|receipt|receipts|发票|收据)/i],
 ['photo_organizing',/(photo|photos|picture|pictures|照片|相册).{0,90}(organiz|sort|deduplicat|整理|去重|分类)|(organiz|sort|deduplicat|整理|去重|分类).{0,90}(photo|photos|picture|pictures|照片|相册)/i],
 ['calendar_scheduling',/(calendar|meeting|schedule|日程|会议|排期).{0,90}(sync|conflict|book|coordinate|冲突|同步|协调)|(sync|conflict|book|coordinate|冲突|同步|协调).{0,90}(calendar|meeting|schedule|日程|会议|排期)/i],
 ['csv_import',/(csv|spreadsheet|excel|表格).{0,90}(import|upload|导入|上传)|(import|upload|导入|上传).{0,90}(csv|spreadsheet|excel|表格)/i]
];
export function taskPainSignature(source){
 const text=[source.title,source.description].filter(Boolean).join(' ').normalize('NFKC').slice(0,2400);
 if(!assessRealProblem(source).qualified)return null;
 const matched=tasks.filter(([,rx])=>rx.test(text)).map(([id])=>id);
 // Conflicting tasks are intentionally left ungrouped.
 return matched.length===1?matched[0]:null;
}
export function taskPainClusters(sources,{assess=assessRealProblem,maxMembers=8}={}){
 const groups=new Map(),usedKeys=new Map();
 for(const source of sources){
  if(!assess(source).qualified)continue;
  const signature=taskPainSignature(source);
  if(!signature)continue;
  const key=evidenceFingerprint(source);
  const seen=usedKeys.get(signature)||new Set();
  if(seen.has(key))continue;
  seen.add(key);usedKeys.set(signature,seen);
  const group=groups.get(signature)||[];
  if(group.length<maxMembers)group.push(source);
  groups.set(signature,group);
 }
 return [...groups.entries()].filter(([,members])=>members.length>=2).map(([task,members])=>({
  task, members, matchingBasis:'task_action_pain_lexicon',confidence:'candidate_only',
  caveat:'仅因描述同一类任务/操作而提出归组，可能涉及不同用户、不同根因；必须人工核对原帖。'
 }));
}
