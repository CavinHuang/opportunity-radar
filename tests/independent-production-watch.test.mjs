import test from 'node:test';
import assert from 'node:assert/strict';
import {probeProduction} from '../scripts/production-watch.mjs';
import {planWatchIssues,manageWatchIssues} from '../scripts/production-watch-issues.mjs';

const SHA='a'.repeat(40),TOKEN='watch-token-which-is-longer-than-32-characters';
function server({failPath,commit=SHA,rollback=null,auth=true}={}){
 return async (url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  const p=new URL(url).pathname;
  if(p===failPath)return new Response('unavailable',{status:503});
  if(p==='/api/release')return Response.json({application:'opportunity-radar',identified:true,version:'1',commit});
  if(p==='/api/health')return Response.json({ok:true,mode:'local-first'});
  if(p==='/api/operations/watch'){
   assert.equal(opts.headers['X-Radar-Watch-Key'],TOKEN);
   if(!auth)return new Response('denied',{status:401});
   return Response.json({application:'opportunity-radar',watchVersion:1,releaseRevision:3,
    active:false,rolloutPercent:0,lastTransition:'rollback',ownerDataIncluded:false,
    lastGuardAlert:rollback});
  }
  throw Error('Unexpected endpoint '+p);
 };
}
const origin='https://radar.example';
test('independent watch is health only without watch token, not a fake rollback assertion',async()=>{
 const x=await probeProduction({url:origin,fetchImpl:server()});
 assert.equal(x.state,'healthy');
 assert.equal(x.monitoring,'health_only');
 assert.equal(x.versionVerified,true);
 assert.equal(x.rollbackAlert,null);
 const mismatch=await probeProduction({url:origin,expectedSha:'b'.repeat(40),fetchImpl:server()});
 assert.deepEqual([mismatch.state,mismatch.code],['down','RELEASE_MISMATCH']);
 const bad=await probeProduction({url:'http://radar.example',fetchImpl:server()});
 assert.equal(bad.code,'INSECURE_URL');
 const outage=await probeProduction({url:origin,fetchImpl:server({failPath:'/api/health'})});
 assert.equal(outage.state,'down');
 assert.equal(outage.code,'HTTP_503');
});
test('protected watch sees recent rollback but discards old alert and errors fail closed',async()=>{
 const now=Date.parse('2026-10-14T12:00:00Z');
 const rollback={code:'REVIEWED_REGRESSION',releaseRevision:3,at:'2026-10-14T11:59:00Z'};
 const result=await probeProduction({url:origin,watchToken:TOKEN,fetchImpl:server({rollback}),now});
 assert.equal(result.monitoring,'health_and_rollback');
 assert.deepEqual(result.rollbackAlert,rollback);
 assert.equal(result.rollout.releaseRevision,3);
 const old=await probeProduction({url:origin,watchToken:TOKEN,fetchImpl:server({rollback:{
   ...rollback,at:'2026-10-12T11:59:00Z'}}),now});
 assert.equal(old.rollbackAlert,null);
 const denied=await probeProduction({url:origin,watchToken:TOKEN,fetchImpl:server({auth:false}),now});
 assert.equal(denied.state,'down');assert.equal(denied.code,'HTTP_401');
 assert.equal(denied.monitoring,'watch_unavailable');
 assert.ok(!JSON.stringify(denied).includes(TOKEN));
});
test('GitHub incident actions deduplicate outages and rollback by exact event',()=>{
 const outage={state:'down',code:'UNHEALTHY',monitoring:'health_only'};
 let actions=planWatchIssues(outage,[]);
 assert.equal(actions.length,1);assert.equal(actions[0].action,'create');
 assert.ok(!actions[0].body.includes('radar.example'));
 const existing=[{title:actions[0].title,state:'open',number:7}];
 assert.deepEqual(planWatchIssues(outage,existing),[]);
 assert.equal(planWatchIssues({state:'healthy',monitoring:'health_only'},existing)[0].action,'close');
 actions=planWatchIssues(outage,[{...existing[0],state:'closed'}]);
 assert.equal(actions[0].action,'reopen');
 const alert={code:'APPROVAL_REVOKED',releaseRevision:4,at:'2026-10-14T12:00:00Z'};
 const current={state:'healthy',monitoring:'health_and_rollback',rollbackAlert:alert};
 const incident=planWatchIssues(current,[])[0];
 assert.match(incident.title,/Guard rollback APPROVAL_REVOKED/);
 assert.deepEqual(planWatchIssues(current,[{title:incident.title,state:'closed',number:18}]),[]);
});
test('GitHub API issue updater handles failure, recovery and dedup without remote credentials in reports',async()=>{
 const issues=[],calls=[];
 async function fake(url,opts){
  calls.push({url,method:opts.method});
  const u=new URL(url),route=u.pathname;
  if(opts.method==='GET'&&route.endsWith('/issues'))return Response.json(issues);
  if(opts.method==='POST'&&route.endsWith('/issues')){
   const payload=JSON.parse(opts.body);
   issues.push({number:issues.length+1,title:payload.title,state:'open'});
   return Response.json({number:issues.length},{status:201});
  }
  if(opts.method==='PATCH'){
   const id=Number(route.split('/').at(-1)),issue=issues.find(x=>x.number===id);
   issue.state=JSON.parse(opts.body).state;return Response.json(issue);
  }
  if(opts.method==='POST'&&route.endsWith('/comments'))return Response.json({}, {status:201});
  throw Error('Unexpected '+opts.method+' '+route);
 }
 const config={token:'mock-token-secret',repository:'CavinHuang/opportunity-radar',fetchImpl:fake};
 const down={state:'down',code:'FETCH_FAILED',monitoring:'health_only'};
 assert.equal((await manageWatchIssues(down,config))[0].action,'create');
 assert.equal((await manageWatchIssues(down,config)).length,0);
 assert.equal(issues.length,1);
 assert.equal((await manageWatchIssues({state:'healthy',monitoring:'health_only'},config))[0].action,'close');
 assert.equal(issues[0].state,'closed');
 assert.equal((await manageWatchIssues(down,config))[0].action,'reopen');
 assert.equal(issues[0].state,'open');
 assert.ok(calls.some(c=>c.method==='PATCH'));
});
