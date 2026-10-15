import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const statusCode=source.slice(source.indexOf('function homeAnalysisStatus('),source.indexOf('function renderProductHypotheses('));
const actionCode='async function perform(action){switch(action){'+source.slice(source.indexOf("  case 'retry-home-analysis':"),source.indexOf("  case 'scan-home-opportunities':"))+'}}';

test('home recovery distinguishes old results from fresh findings and links a retry that does not scan feeds',()=>{
 const S={homeAnalysisBusy:false},context=vm.createContext({S,esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 vm.runInContext(statusCode,context);
 const html=context.homeAnalysisStatus({status:'filter_failed',reason:'<script>bad</script>',retainedCount:7,analysis:{classified:0,unclassified:8,reused:0}});
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('保留此前结果 7 项'));assert.ok(html.includes('不计为本次新发现'));
 assert.ok(html.includes('不重新扫描信息源'));assert.ok(html.includes('data-action="retry-home-analysis"'));
 assert.equal(context.homeAnalysisStatus({status:'filtered'}),'');
 S.homeAnalysisBusy=true;assert.match(context.homeAnalysisStatus({status:'filtered_partial'}),/data-action="retry-home-analysis" disabled/);
});

test('repeat clicks during home retry issue one request; failures release the button for retry',async()=>{
 let release,calls=0,fail=true;const S={},rendered=[];
 const context=vm.createContext({S,render:()=>rendered.push(S.homeAnalysisBusy),refresh:async()=>{},toast:()=>{},api:async(path,options)=>{
  assert.equal(path,'/home/opportunities/retry');assert.equal(options.method,'POST');calls++;
  await new Promise(r=>{release=r;});if(fail)throw new Error('temporary connection failure');return {discovery:{status:'filtered'}};
 }});
 vm.runInContext(actionCode,context);
 const first=context.perform('retry-home-analysis');await context.perform('retry-home-analysis');assert.equal(calls,1);
 release();await assert.rejects(first,/connection failure/);assert.equal(S.homeAnalysisBusy,false);
 fail=false;const retry=context.perform('retry-home-analysis');release();await retry;
 assert.equal(calls,2);assert.equal(S.homeAnalysisBusy,false);assert.ok(rendered.includes(true));
});
