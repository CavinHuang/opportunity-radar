import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function renderModelDiagnostics('),source.indexOf("  case 'retry-load':"))+'}}';
const snapshot={models:[{kind:'llm',configured:true,provider:'api.deepseek.com',model:'deepseek-chat',timeoutMs:90000},{kind:'jev',configured:false}],recent:[],notice:'测试数据'};
function harness(api){
 const rendered=[],S={};let open=true;
 const context=vm.createContext({S,api,esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  document:{querySelector:()=>open},modal:(title,html,submit,options)=>rendered.push({title,html,options,submit})});
 vm.runInContext(code,context);return {context,rendered,S,close:()=>{open=false;}};
}

test('diagnostic view keeps model routes distinct, escapes provider content and has no confirmation form',()=>{
 const h=harness();
 h.context.renderModelDiagnostics({...snapshot,recent:[{provider:'<script>bad</script>',model:'fixture',operation:'probe',status:'failed',error:'LLM_HTTP_ERROR',upstreamStatus:503,elapsedMs:100,id:'request'}]});
 const view=h.rendered[0];assert.equal(view.options.readOnly,true);assert.equal(view.submit,null);
 assert.ok(view.html.includes('研究与草稿模型'));assert.ok(view.html.includes('Jev 信号预筛'));
 assert.ok(view.html.includes('证据对照只使用研究模型'));assert.ok(view.html.includes('HTTP 503'));
 assert.ok(!view.html.includes('<script>'));assert.ok(view.html.includes('&lt;script&gt;'));
 assert.match(view.html,/data-id="jev" disabled/);
});

test('repeated probe clicks issue one request and failures remain visible and retryable',async()=>{
 let failProbe=true,release,probes=0;
 const h=harness(async(path)=>{
  if(path==='/operations/models')return snapshot;
  probes++;await new Promise(r=>{release=r;});if(failProbe)throw new Error('模型请求失败 HTTP 503');return {ok:true};
 });
 const first=h.context.perform('model-probe','llm');
 await new Promise(r=>setImmediate(r));assert.equal(h.S.modelProbeBusy,'llm');
 await h.context.perform('model-probe','llm');assert.equal(probes,1);release();await first;
 assert.equal(h.S.modelProbeBusy,null);assert.ok(h.rendered.at(-1).html.includes('HTTP 503'));
 failProbe=false;const retry=h.context.perform('model-probe','llm');await new Promise(r=>setImmediate(r));release();await retry;
 assert.equal(probes,2);assert.ok(h.rendered.at(-1).html.includes('最小请求已通过；真实任务仍需验证'));
});

test('finishing a probe after closing its dialog does not reopen it',async()=>{
 let release;
 const h=harness(async path=>path==='/operations/models'?snapshot:new Promise(r=>{release=r;}));
 const pending=h.context.perform('model-probe','llm');await new Promise(r=>setImmediate(r));
 const count=h.rendered.length;h.close();release({ok:true});await pending;
 assert.equal(h.rendered.length,count);assert.equal(h.S.modelProbeBusy,null);
});
