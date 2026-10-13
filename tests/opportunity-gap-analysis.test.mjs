import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeExternalCounterevidence} from '../src/opportunity-gap-analysis.mjs';

const hit=(url,title,excerpt='',source='GitHub Issues')=>({url,title,excerpt,source});
test('clear matching solution mentions are investigative leads, not verified market gaps',()=>{
 const r=analyzeExternalCounterevidence('Invoice reconciliation workflow fails',[
  hit('https://github.com/demo/tool/issues/1','Invoice reconciliation alternative','This plugin still fails for invoices'),
  hit('https://news.ycombinator.com/item?id=2','Invoice reconciliation error','Users still report missing records','Hacker News')],[]);
 assert.equal(r.counts.solution_with_reported_limits,1);
 assert.equal(r.counts.related_problem_report,1);
 assert.equal(r.stage,'inspect_existing_solutions');
 assert.ok(r.items.every(x=>x.verified===false));
 assert.ok(r.missing.some(x=>x.includes('价格')));
});
test('keyword-only unrelated hits never become competitor claims',()=>{
 const r=analyzeExternalCounterevidence('Invoice reconciliation workflow fails',[
  hit('https://github.com/demo/a/issues/2','Calendar sync plugin','Fixed a meeting conflict'),
  hit('https://github.com/demo/a/issues/2','Duplicate calendar sync plugin','Other')],[]);
 assert.equal(r.counts.weak_match,1);
 assert.equal(r.counts.possible_alternative,0);
 assert.equal(r.stage,'insufficient_external_evidence');
});
test('partial search failure remains visible and empty results never prove market space',()=>{
 const r=analyzeExternalCounterevidence('Invoice reconciliation workflow fails',[],[{source:'GitHub Issues',status:'failed'}]);
 assert.equal(r.items.length,0);
 assert.ok(r.missing.some(x=>x.includes('GitHub Issues')));
 assert.equal(r.stage,'insufficient_external_evidence');
});
