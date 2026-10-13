import {problemCaseFile} from './real-problem.mjs';
import {evidenceFingerprint} from './opportunity-evidence-priority.mjs';

// Evidence dossier is a review aid, never automatically verified market demand.
const asHttps=url=>{try{return new URL(url).protocol==='https:'}catch{return false}};
export function opportunityEvidenceDossier(sources){
 const seen=new Set(),originals=[];
 for(const s of sources){
  if(!asHttps(s.url))continue;
  const key=evidenceFingerprint(s);
  if(seen.has(key))continue;
  seen.add(key);
  const caseFile=problemCaseFile(s);
  if(!caseFile.qualified)continue;
  originals.push({sourceId:s.id,url:s.url,title:s.title,
   sourceRevision:s.revision||null,excerpts:caseFile.signals,
   missing:caseFile.missing});
 }
 const has=field=>originals.some(x=>x.excerpts[field]);
 const checks=[
  {id:'originals',state:originals.length?'unverified':'missing',detail:'原帖可访问性、作者是否亲历及转载关系待人工核对'},
  {id:'workaround',state:has('workaround')?'mentioned_unverified':'missing',detail:'已有解决方案是否有效、为何不足，仍需核对'},
  {id:'frequency',state:has('frequency')?'mentioned_unverified':'missing',detail:'发生频率只取自原帖文字，未经外部验证'},
  {id:'impact',state:has('impact')?'mentioned_unverified':'missing',detail:'成本与影响的文字描述需访谈或实际数据验证'},
  {id:'independent_users',state:'missing',detail:'不同链接、不同域名不等于独立用户'},
  {id:'competitive_alternatives',state:'missing',detail:'尚未完成免费、付费或非软件替代方案的反证调查'},
  {id:'willingness_to_pay',state:'missing',detail:'没有可验证的支付行为或购买承诺'}
 ];
 const nextActions=checks.filter(c=>c.state==='missing').map(c=>c.detail);
 return {sources:originals.slice(0,12),sourceCount:originals.length,checks,
  hasUnverifiedWorkaround:has('workaround'),hasUnverifiedCost:has('impact'),
  falsificationQuestions:[
   '现有免费或人工流程是否已经足够好，切换成本是否超过改善收益？',
   '相似帖子是否来自同一个作者、转载链或单次事件？',
   '这个问题是否只出现在极少数边缘配置或临时故障？',
   '问题消失后用户是否仍愿意长期使用或付费？'
  ],nextActions,validationState:'needs_independent_verification',
  notice:'所有摘录均来自已收录文本的字面匹配；没有在线检索竞品、身份核验或推断真实需求。'};
}
