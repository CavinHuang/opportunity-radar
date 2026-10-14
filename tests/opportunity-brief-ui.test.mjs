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
