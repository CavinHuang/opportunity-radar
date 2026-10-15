import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function renderProductHypotheses('),source.indexOf('\nfunction failingSourceItem'));
const context=vm.createContext({esc:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
vm.runInContext(code,context);
test('homepage separates support leads and product hypotheses with citations and a falsifiable next action',()=>{
 const html=context.renderProductHypotheses({status:'filtered',items:[
  {id:'support',title:'Browser editing problem',aiReason:'Single-use difficulty',opportunityBrief:{kind:'support_issue'}},
  {id:'research',title:'Needs more evidence',aiReason:'No workaround documented',opportunityBrief:{kind:'research_lead'}},
  {id:'product',opportunityBrief:{kind:'product_hypothesis',hypothesis:'<script>unsafe</script>Invoice checking hypothesis',validation:'Measure saved time; stop if none',counterargument:'A spreadsheet formula may suffice',evidence:{pain:{quote:'I lose 3 hours each week',url:'https://forum.example/1'}}}}
 ]});
 assert.match(html,/值得验证的产品假设/);
 assert.match(html,/Measure saved time; stop if none/);
 assert.match(html,/A spreadsheet formula may suffice/);
 assert.match(html,/href="https:\/\/forum.example\/1"/);
 assert.match(html,/使用求助与待研究线索 · 2 项/);
 assert.ok(html.indexOf('Browser editing problem')>html.indexOf('<details>'));
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
test('no grounded product evidence produces an honest empty state instead of a recommendation',()=>{
 const html=context.renderProductHypotheses({status:'filtered',items:[]});
 assert.match(html,/本次尚未发现原文证据足够的产品假设/);
 assert.doesNotMatch(html,/核查这个产品假设/);
});
test('homepage distinguishes automated clues and owner review progress and exposes the next review action',()=>{
 const html=context.renderHypothesisResearch({id:'product',researchSummary:{state:'needs_review',coverage:'partial',
  automatic:{related_problem_report:4,possible_alternative:2,solution_with_reported_limits:0,weak_match:25},
  progress:{reviewed:0,total:35,pending:35},ownerClassifications:{existing_solution:0},references:[],
  nextAction:{action:'workbench-evidence-review',label:'逐条核查外部证据',reason:'Check the original sources'}}});
 assert.match(html,/自动初筛：相似问题 4/);assert.match(html,/人工分类 0\/35/);
 assert.match(html,/部分来源查询失败/);assert.match(html,/data-action="workbench-evidence-review"/);
 assert.match(html,/不能证明独立用户或付费需求/);
});

test('review queue opens priority clues first while keeping weak hits and editable reviews folded',()=>{
 const hit=(url,triageType)=>({url,title:url,source:'HN',triageType,excerpt:'<script>excerpt</script>'});
 const priority=hit('https://example.org/problem','related_problem_report');
 const weak=hit('https://example.org/weak','weak_match');const reviewed=hit('https://example.org/solution','possible_alternative');
 const html=context.renderEvidenceReviewQueue({results:[priority,weak,reviewed],reviews:[{url:reviewed.url,classification:'uncertain',notes:'<b>owner notes</b>'}],
  queue:{priority:[priority],other:[weak],reviewed:[reviewed],priorityProgress:{total:2,reviewed:1,pending:1}}},'id');
 assert.match(html,/重点线索人工分类 1\/2 · 全部结果 1\/3/);
 assert.ok(html.indexOf(priority.url)<html.indexOf('<details>'));
 assert.match(html,/<details><summary>弱相关与未分组 · 1 条待复查/);
 assert.match(html,/<details><summary>已人工分类 · 1 条/);
 assert.equal((html.match(/data-action="workbench-review-item"/g)||[]).length,3);
 assert.match(html,/修改审核/);assert.match(html,/人工：无法确认/);
 assert.doesNotMatch(html,/<script>|<b>/);assert.match(html,/&lt;script&gt;excerpt/);assert.match(html,/&lt;b&gt;owner notes/);
});
test('legacy ungrouped review results remain reachable without claiming priority completion',()=>{
 const html=context.renderEvidenceReviewQueue({results:[{url:'https://example.org/legacy',title:'Old clue'}],reviews:[]},'id');
 assert.match(html,/暂无待核查的重点线索/);assert.match(html,/弱相关与未分组 · 1 条待复查/);
 assert.match(html,/data-evidence-url="https:\/\/example.org\/legacy"/);
});
test('AI task comparison keeps model judgments separate and requires owner to enter their own review',()=>{
 const html=context.renderEvidenceComparison({url:'https://example.org/hit',notice:'未访问全文，不保存人工分类',comparison:{
  taskRelation:'different_task',relationReason:'<script>different root cause</script>',
  originalEvidence:{quote:'Original task quote',url:'https://example.org/original'},externalEvidence:{quote:'External quote',url:'https://example.org/hit'},
  solutionCoverage:'unknown',coverageReason:'No verified capabilities',coverageQuote:null,nextCheck:'Try original input before accepting a solution'}},'id');
 assert.match(html,/可能是不同任务/);assert.match(html,/方案覆盖未知/);assert.match(html,/AI 对照草稿 · 未经人工核查/);
 assert.match(html,/自行填写/);assert.doesNotMatch(html,/<script>|name="classification"|name="notes"/);
 assert.match(html,/type="button".*data-action="workbench-review-item"/);assert.match(html,/返回复核列表/);
});
test('cached model mismatch stays folded and editable while homepage separates machine progress from owner progress',()=>{
 const hit={url:'https://example.org/different',title:'Different task',triageType:'possible_alternative'};
 const html=context.renderEvidenceReviewQueue({results:[hit],reviews:[],comparisons:[{url:hit.url,comparison:{taskRelation:'different_task',relationReason:'<script>different task</script>'}}],
  queue:{priority:[],other:[],reviewed:[],differentTask:[hit],priorityProgress:{total:0,reviewed:0}}},'id');
 assert.match(html,/<details><summary>AI 判断任务不同 · 1 条待复查/);assert.match(html,/可能误判/);
 assert.match(html,/查看已保存 AI 对照/);assert.match(html,/workbench-evidence-recompare/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/人工：未审核/);assert.match(html,/workbench-review-item/);
 const card=context.renderHypothesisResearch({researchSummary:{modelComparisons:{analyzed:1,total:35,same_task:0,different_task:1,uncertain:0},progress:{reviewed:0,total:35,pending:35}}});
 assert.match(card,/AI 任务对照 1\/35/);assert.match(card,/人工分类 0\/35/);assert.match(card,/未审核草稿/);
});
test('continuation shows partial failures without marking them complete or hiding the retry entry',()=>{
 const html=context.renderEvidenceComparisonBatch({progress:{compared:1,total:35,pending:34,skipped:1,available:33},
  results:[{url:'https://example.org/failed',title:'<script>failure</script>',status:'failed',reason:'引用未通过核对'},
   {url:'https://example.org/saved',title:'Saved',status:'saved'}],notice:'失败不计为完成'},'id');
 assert.match(html,/已有 AI 草稿 1\/35/);assert.match(html,/本次会话暂跳过 1/);assert.match(html,/单独重试这条/);
 assert.match(html,/继续接下来的线索/);assert.match(html,/未经人工审核/);assert.doesNotMatch(html,/<script>/);
 const paused=context.renderEvidenceComparisonBatch({progress:{compared:34,total:35,pending:1,skipped:1,available:0},results:[]},'id');
 assert.match(paused,/其余待对照线索本次暂时跳过/);assert.doesNotMatch(paused,/data-action="workbench-evidence-next"/);
});
