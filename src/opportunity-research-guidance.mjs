import {crossWeekResearchDossier} from './opportunity-cross-week-dossier.mjs';

// Advisory only: this report never updates an opportunity or substitutes for owner approval.
export function researchDecisionGuidance(store,candidateId){
 const dossier=crossWeekResearchDossier(store,candidateId);
 const weeks=dossier.weeks;
 const latest=weeks.at(-1)||null;
 const flags=dossier.reviewFlags||[];
 const codes=new Set(flags.map(f=>f.code));
 const findings=weeks.map(w=>w.hypothesis?.finding).filter(x=>x&&x!=='unknown');
 const lastFinding=latest?.hypothesis?.finding||'unknown';
 const hasCounterevidence=lastFinding==='contradicted'||findings.includes('contradicted');
 const insufficient=!weeks.length||lastFinding==='unknown'||codes.has('NO_HYPOTHESIS')||codes.has('NO_LINKED_EVIDENCE')||codes.has('UNREVIEWED_PROVENANCE');
 const conflicting=codes.has('CONFLICTING_FINDINGS')||hasCounterevidence;
 const stale=codes.has('STALE_RESEARCH');
 let action='continue_research',headline='继续核查关键问题';
 if(!weeks.length){action='plan_research';headline='先制定最小研究计划';}
 else if(conflicting){action='review_direction';headline='复核反证并考虑调整方向';}
 else if(stale){action='refresh_evidence';headline='更新过期研究证据';}
 else if(insufficient){action='collect_evidence';headline='补充可追溯的真实证据';}
 else if(latest.status!=='reviewed'){action='complete_review';headline='完成本周人工复盘';}
 else if(lastFinding==='supported'){action='human_decision';headline='提交人工继续投入评审';}
 const reasons=[
  ...flags.map(f=>({code:f.code,message:f.message})),
  ...(lastFinding==='supported'?[{code:'OWNER_SUPPORT',message:'最新假设标记为人工支持；并非独立验证的需求或付费证明。'}]:[]),
  ...(hasCounterevidence?[{code:'COUNTEREVIDENCE_RECORDED',message:'历史中有人工反驳结论，应先检查反证和适用范围。'}]:[])
 ];
 const nextSteps={
  plan_research:['定义目标用户、可证伪假设和停止条件','安排第一项真实研究任务'],
  review_direction:['对照相反结论的原始记录','由 Owner 决定调整、暂停或继续研究'],
  refresh_evidence:['重新联系目标用户或核实来源现状','把新观察关联到最新研究周'],
  collect_evidence:['核查原始来源与事件独立性','记录实际行为或明确反证'],
  complete_review:['核对本周研究事件及结论','由 Owner 完成复盘'],
  human_decision:['人工审阅证据质量及预算','选择继续、调整、暂停或停止，并保存理由'],
  continue_research:['定义下一条可推翻当前假设的观察','取得新的原始证据']
 };
 return {candidateId,title:dossier.title,action,headline,reasons,nextSteps:nextSteps[action],researchWeeks:weeks.length,
  latestWeek:latest?.weekStart||null,latestFinding:lastFinding,reviewFlags:flags,ownerDecisionRequired:true,
  automaticDecision:false,marketValidated:false,readOnly:true,
  notice:'仅依据已保存的人工研究记录给出保守行动建议，不是市场判断、机会评分、自动停止或自动项目批准。任何正式决策都必须由 Owner 审阅证据后独立作出。'};
}
