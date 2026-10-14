import {freezeRegressionSuite,replayFrozenRegressionSuite,recordFrozenRegressionReview} from '../../src/discovery-regression-suite.mjs';

export const researchReviewReason='逐条检查冻结回归集内的人工正反例，确认当前试验没有已知退化';
export function freezeAndReviewRegression(db){
 const frozen=freezeRegressionSuite(db,{reason:'记录本阶段经过Owner确认的具体正反例以便后续比较',expected_revision:0});
 const replay=replayFrozenRegressionSuite(db);
 if(replay.verdict!=='manual_review_only')throw Error('test fixture must not regress frozen sample');
 const reviewed=recordFrozenRegressionReview(db,{policy_id:'require_workaround',suite_revision:frozen.revision,
  fingerprint:replay.fingerprint,decision:'recommend_shadow_review',reason:researchReviewReason,expected_revision:0});
 return {frozen,replay,reviewed};
}
export function addReviewedHoldout(db,freezeAt,{total=6,modified=false,sameHost=false,stale=false}={}){
 const labelAt=new Date(Date.parse(freezeAt)+1000).toISOString();
 const ids=[];
 for(let i=0;i<total;i++){
  const positive=i%2===0;
  const s=db.put('sources',{id:'after-freeze-'+i,status:'new',
   url:'https://'+(sameHost?'site-one.example':i%2?'site-two.example':'site-one.example')+'/new-post-'+i,
   title:positive?'Cannot automate weekly invoice workflow':'New release announcement',
   description:positive?'I manually reconcile invoices every day and spend hours correcting errors':
    modified&&i===1?'I copy invoices every day and spend hours fixing errors':'Our team is launching a product'});
  const label=db.put('discovery_quality_labels',{id:s.id,
   label:positive?'real_problem':'not_problem',
   sourceRevision:s.revision,at:labelAt,reason:'在冻结历史样本之后人工核对新的原帖内容'});
  ids.push({s,label});
 }
 if(stale){
  const s=ids.at(-1).s;
  db.put('sources',{...s,title:'Edited later after owner review'},s.revision);
 }
 return ids;
}
