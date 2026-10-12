import test from 'node:test';import assert from 'node:assert/strict';
import {opportunityQualityReview} from '../src/opportunity-quality.mjs';
const candidate={id:'signal:1',title:'Cannot automate invoice workflow',summary:'I need an alternative tool for receipts',signalCount:1,siteCount:1,sourceUrls:['https://community.example/post/1'],reasons:['手动重复任务'],counterEvidence:[],competitionMentioned:true};
test('single-post evidence remains unverified and no monetary or feasibility inference',()=>{
 const q=opportunityQualityReview(candidate);
 assert.equal(q.problemFrequency,'single_post_unverified');assert.equal(q.independentConsumers,'unknown');assert.equal(q.minimumValidationCost,'unknown');assert.equal(q.implementationFeasibility,'unknown');assert.equal(q.safeguards.approved,false);assert.ok(q.evidenceUrls.length);
});
test('focus matching is lexical only and competitor mention is not validated',()=>{
 const q=opportunityQualityReview(candidate,{focusDomains:['ai_automation']});
 assert.equal(q.focusFit,'keyword_match');assert.equal(q.competition,'mentioned_not_verified');assert.ok(q.concerns.length>=3);
});
test('duplicate posts cannot prove independent consumers',()=>{
 const q=opportunityQualityReview({...candidate,siteCount:3,signalCount:4});
 assert.equal(q.problemFrequency,'multiple_posts_unverified');assert.equal(q.independentConsumers,'unknown');
});
