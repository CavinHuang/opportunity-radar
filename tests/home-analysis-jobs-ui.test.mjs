import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let homeJobPollTimer='),source.indexOf('function homeAnalysisStatus('));
const active={jobId:'one',revision:4,mode:'retry',status:'analyzing',inProgress:true,progress:{total:8,classified:4,pending:4,reused:0}};
function harness(api){
 const timers=new Map(),calls=[],S={view:'brief'},node={innerHTML:''};let refreshed=0,timer=0;
 const context=vm.createContext({S,api:async(path,opts={})=>{calls.push({path,opts});return api(path,opts);},
  document:{querySelectorAll:()=>[node]},applyLanguage:()=>{},locale:()=> 'zh-CN',esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  render:()=>{},toast:()=>{},refresh:async()=>{refreshed++;},
  setTimeout:callback=>{timers.set(++timer,callback);return timer;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(code,context);return {S,node,context,calls,timers,refreshed:()=>refreshed};
}

test('progress distinguishes source synchronization, real model counts and interrupted work without fake percentages',()=>{
 const h=harness();h.S.homeAnalysisJob={...active,status:'collecting',progress:null};
 const collecting=h.context.renderHomeAnalysisJob();assert.ok(collecting.includes('正在同步来源'));assert.ok(!collecting.includes('<progress'));
 h.S.homeAnalysisJob=active;const analyzing=h.context.renderHomeAnalysisJob();assert.ok(analyzing.includes('已分析 4 / 8'));assert.ok(analyzing.includes('value="4"'));
 h.S.homeAnalysisJob={...active,status:'interrupted',inProgress:false,reason:'<script>not trusted</script>'};
 const interrupted=h.context.renderHomeAnalysisJob();assert.ok(interrupted.includes('继续未完成分析'));assert.ok(!interrupted.includes('<script>'));
 assert.equal(h.calls.length,0);
});

test('polling an existing task only reads status; completion refreshes results once',async()=>{
 const h=harness(async()=>({job:{...active,revision:5,status:'completed',inProgress:false}}));
 h.S.homeAnalysisJob=active;await h.context.pollHomeAnalysisJob();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/home/opportunities/jobs/current');
 assert.equal(h.calls[0].opts.background,true);assert.equal(h.calls[0].opts.method,undefined);
 assert.equal(h.refreshed(),1);assert.equal(h.timers.size,0);
});

test('a lost start response reattaches through one read and never repeats the POST',async()=>{
 const h=harness(async(path,opts)=>{if(opts.method==='POST')throw new Error('connection reset');return {job:active};});
 await h.context.startHomeAnalysis('retry');
 assert.equal(h.calls.length,2);assert.equal(h.calls.filter(x=>x.opts.method==='POST').length,1);
 assert.equal(h.S.homeAnalysisJob.jobId,'one');assert.equal(h.S.homeAnalysisBusy,false);assert.equal(h.timers.size,1);
 await h.context.startHomeAnalysis('scan');assert.equal(h.calls.length,2);
});

test('three failed status reads stop automatic polling and expose an explicit read-only recovery',async()=>{
 let fail=true;const h=harness(async()=>{if(fail)throw new Error('private gateway body');return {job:active};});h.S.homeAnalysisJob=active;
 for(let i=0;i<3;i++)await h.context.pollHomeAnalysisJob();
 assert.equal(h.timers.size,0);assert.ok(h.node.innerHTML.includes('重新查询任务状态'));assert.ok(!h.node.innerHTML.includes('private gateway body'));
 assert.ok(h.calls.every(x=>x.opts.method===undefined));
 fail=false;await h.context.pollHomeAnalysisJob(true);assert.equal(h.S.homeJobPollError,null);assert.equal(h.timers.size,1);
 assert.equal(h.calls.at(-1).opts.background,false);
});

test('late status responses cannot overwrite a newer task or newer completion',async()=>{
 const h=harness(async()=>({job:{...active,revision:2}}));
 h.S.homeAnalysisJob={...active,revision:8,status:'completed',inProgress:false};await h.context.pollHomeAnalysisJob();
 assert.equal(h.S.homeAnalysisJob.revision,8);assert.equal(h.S.homeAnalysisJob.status,'completed');
 h.context.acceptHomeAnalysisJob(null);assert.equal(h.S.homeAnalysisJob.revision,8);
});
