/** Evidence-bound review, not a market success score. */
const patterns=[
 ['ai_automation','AI 与自动化',/\bai\b|agent|llm|automat|自动化|模型/i],
 ['developer_tools','开发者工具',/github|program|debug|terminal|\bcli\b|开发|代码/i],
 ['productivity','个人效率',/productiv|workflow|calendar|organize|note|效率|笔记|整理/i],
 ['financial_tools','财务工具',/invoice|receipt|payment|budget|发票|账单|支付/i]
];
export function opportunityQualityReview(candidate,{focusDomains=[]}={}){
 const text=[candidate.title,candidate.summary].join(' ').slice(0,3000);
 const matched=patterns.filter(p=>p[2].test(text)).map(p=>({id:p[0],name:p[1]}));
 const fit=matched.filter(x=>focusDomains.includes(x.id));
 const links=[...new Set((candidate.sourceUrls||[]).filter(x=>{try{return new URL(x).protocol==='https:'}catch{return false}}))];
 const multiDomain=(candidate.siteCount||0)>1;
 const repeated=(candidate.signalCount||0)>1;
 const competition=candidate.competitionMentioned===true;
 const gaps=['尚未验证原帖是否为真实一手经历','尚未验证独立用户数量或发生频率','尚未获得实际付费或留存数据'];
 if(!competition)gaps.push('尚未完成竞品与现有替代方案调查');
 const feasibility='unknown';
 return {candidateId:candidate.id,domains:matched,focusFit:!focusDomains.length?'not_configured':fit.length?'keyword_match':'no_keyword_match',
   problemFrequency:repeated?'multiple_posts_unverified':'single_post_unverified',
   independentConsumers:'unknown',competition:competition?'mentioned_not_verified':'research_missing',
   implementationFeasibility:feasibility,minimumValidationCost:'unknown',
   reasons:[...candidate.reasons||[]],
   concerns:[...candidate.counterEvidence||[],...gaps],
   evidenceUrls:links,
   nextSteps:['核查原帖是否明确描述当事人的使用场景','找至少两个非转帖的独立案例或访谈','对照现有免费和收费解决办法','记录最小实验的时间预算与停止条件'],
   safeguards:{approved:false,validatedDemand:false,mayAutoInvest:false},
   note:multiDomain?'涉及多个来源域名，但相似内容不代表独立消费者':'仅有公开线索，不能以发帖数估算市场'};
}
