/** Conservative evidence gate: real-world workflow friction before opportunity hypotheses. */
const negative=/\b(?:we (?:launched|are launching|built|announce|offer|sell)|introducing our|sponsored|promo code|press release|join our team|we are hiring|launching today|product hunt launch|top \d+ tools|best tools of)\b|新品发布|正式上线|招聘|限时优惠|推广|广告合作|产品发布|官宣/i;
const actor=/\b(?:i|i'm|i've|my|we|our|client|customer|users?|freelancers?|team)\b|我(?:们)?|用户|客户|团队|商家|开发者|财务|运营|老师|学生/i;
const task=/\b(?:import|export|copy|paste|migrat|upload|download|invoic(?:e|es)|receipts?|sync|track|reconcil|schedule|book|organize|edit|debug|test|report|send|pay|enter data|manually)\b|导入|导出|复制|粘贴|同步|迁移|整理|记账|报销|对账|排班|填写|录入|提交|发送|测试|上传|下载|处理|开票|手动/i;
const pain=/\b(?:can't|cannot|unable|fail(?:s|ed|ing)?|broken|crash(?:es|ing)?|error|stuck|struggl\w*|time.consuming|tedious|hours?|every day|each week|repeatedly|painful|missing|lost|too expensive)\b|无法|失败|报错|崩溃|丢失|重复|耗时|每天|每周|痛苦|麻烦|太贵|不方便|效率低|卡住/i;
const workarounds=/\b(?:workaround|manually|spreadsheet|excel|copy.paste|instead|currently use|have to|forced to|alternative)\b|临时|手动|表格|人工|只能|不得不|替代|绕过/i;
const question=/\b(?:how do i|how can i|any way to|looking for|is there a way)\b|怎么办|有没有办法|求助|怎么解决/i;
const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
export function assessRealProblem(signal){
 const title=normalize(signal.title),description=normalize(signal.description),text=(title+' '+description).slice(0,2400);
 const flags={actor:actor.test(text),task:task.test(text),pain:pain.test(text),workaround:workarounds.test(text),question:question.test(text),promotion:negative.test(text)};
 const blockers=[];
 if(flags.promotion)blockers.push('疑似营销、招聘或发布公告');
 if(!flags.actor)blockers.push('缺少明确的用户或使用主体');
 if(!flags.task)blockers.push('缺少具体任务或操作场景');
 if(!flags.pain)blockers.push('缺少明确障碍、损失或重复成本');
 // Do not treat vague tool requests and thematic chatter as customer evidence.
 const qualified=!flags.promotion&&flags.actor&&flags.task&&flags.pain;
 const evidence=[flags.actor?'文本提及使用主体':null,flags.task?'文本提及具体任务':null,flags.pain?'文本描述实际障碍或成本':null,flags.workaround?'提及当前替代做法':null].filter(Boolean);
 return {qualified,flags,evidence,blockers,missing:['目标用户的身份与情境是否属实','问题实际发生频率与影响','用户当前如何解决以及成本','是否有独立的一手佐证'],grade:qualified&&flags.workaround?'concrete_workflow_with_workaround':qualified?'concrete_workflow':'insufficient_problem_evidence'};
}

/** Extract short verbatim snippets, not model-generated assertions. */
function excerpt(text,rx){
 const m=rx.exec(text);if(!m)return null;
 const start=Math.max(0,m.index-58),end=Math.min(text.length,m.index+m[0].length+92);
 return {quote:text.slice(start,end).trim(),matched:m[0]};
}
const frequency=/\b(?:every day|daily|each week|weekly|every month|monthly|repeatedly|\d+\s+(?:hours?|minutes?)\s+(?:every|per|a)\s+(?:day|week))\b|每天|每周|每月|反复|经常|每次|\d+\s*(?:小时|分钟)/i;
const impact=/\b(?:\d+\s+hours?|\d+\s+minutes?|lost data|missed deadline|expensive|costs?\s+\$?\d+|errors?|crashes?)\b|损失|出错|报错|丢失|超时|成本|耗时|\d+\s*(?:小时|分钟|元)/i;
export function problemCaseFile(signal){
 const text=normalize([signal.title,signal.description].filter(Boolean).join(' · ')).slice(0,2400);
 const assessment=assessRealProblem(signal);
 const signals={actor:excerpt(text,actor),task:excerpt(text,task),obstacle:excerpt(text,pain),workaround:excerpt(text,workarounds),frequency:excerpt(text,frequency),impact:excerpt(text,impact)};
 const missing=[!signals.workaround?'当前采用的解决办法尚未说明':null,!signals.frequency?'问题频率尚未说明':null,!signals.impact?'实际代价尚未量化':null,'身份和原帖独立性未经核验','付费意愿没有证据'].filter(Boolean);
 const evidenceCompleteness=[signals.actor,signals.task,signals.obstacle,signals.workaround,signals.frequency,signals.impact].filter(Boolean).length;
 return {qualified:assessment.qualified,signals,missing,evidenceCompleteness,stage:'needs_owner_verification',
  userProblem:assessment.qualified?'文本显示存在具体操作障碍，仍需核实':'缺少具体、可核验的问题描述',
  nextVerification:!signals.workaround?'访谈当前怎么解决问题、为什么仍不满意':!signals.frequency?'核对问题发生的实际频率':!signals.impact?'询问时间、金钱或错误成本':'核对原始经历、独立用户及现有替代方案',
  warning:'所有片段只是公开文本的字面匹配，不代表事实已核查'};
}
