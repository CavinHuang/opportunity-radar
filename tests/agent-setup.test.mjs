import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSetupSummary } from '../src/agent-setup.mjs';
import { translate, LANGUAGES } from '../public/i18n.js';

test('owner integration summary stays secret-free and keeps project identity',()=>{
  const summary=agentSetupSummary('p-1',{
    agentLastSync:'2026-10-10T06:00:00Z',
    tasks:[{status:'open'},{status:'rework'}, {status:'in_progress',lease:{expiresAt:'2026-10-10T06:10:00Z'}},{status:'submitted',lease:{expiresAt:'2026-10-10T05:00:00Z'}}],
    decisions:[{status:'pending'},{status:'rejected'}],
    status:'research'
  },{enabled:true,serverTime:'2026-10-10T06:05:00Z',tools:['project.get_context','task.claim']});
  assert.equal(summary.projectId,'p-1');
  assert.equal(summary.openTasks,2);
  assert.equal(summary.activeLeases,1);
  assert.equal(summary.pendingDecisions,1);
  assert.equal(summary.auth.configured,true);
  assert.equal(summary.auth.secretExposed,false);
  assert.equal(summary.toolCount,2);
  assert.ok(!JSON.stringify(summary).includes('Bearer abcdef'));
});
test('integration summary distinguishes paused and unavailable Agent',()=>{
  const off=agentSetupSummary('x',{status:'paused',tasks:[],decisions:[]},{enabled:false});
  assert.equal(off.paused,true);assert.equal(off.enabled,false);assert.equal(off.lastSync,null);
});
test('agent setup headings are localized without translating stored customer content',()=>{
  assert.equal(LANGUAGES['en-US'],'English');
  assert.equal(translate('Agent 接入中心','en-US'),'Agent connection');
  assert.equal(translate('有效任务租约','en-US'),'Active leases');
  assert.equal(translate('Agent 接入中心','zh-CN'),'Agent 接入中心');
});

test('stale Agent reports, expired leases, rejection and work queues are distinguished without online claims',()=>{
 const status=agentSetupSummary('p-2',{status:'execution',agentLastSync:'2026-10-10T06:00:00Z',
   tasks:[{status:'rework',lease:{expiresAt:'2026-10-10T06:10:00Z'}},{status:'blocked'},
     {status:'open',lease:{expiresAt:'2026-10-10T07:00:00Z'}}],
   submissions:[{acceptanceState:'pending'},{acceptanceState:'rejected'}],decisions:[]},
   {enabled:true,serverTime:'2026-10-10T06:40:00Z',tools:[]});
 assert.equal(status.freshness,'stale');assert.equal(status.minutesSinceReport,40);
 assert.equal(status.expiredLeases,1);assert.equal(status.activeLeases,1);
 assert.equal(status.reworkTasks,1);assert.equal(status.blockedTasks,1);
 assert.equal(status.pendingSubmissions,1);assert.equal(status.externalProcessState,'unknown');
 const never=agentSetupSummary('x',{tasks:[],status:'execution'}, {serverTime:'2026-10-10T06:40:00Z'});
 assert.equal(never.freshness,'never_reported');
});
