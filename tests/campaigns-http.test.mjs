import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'radar-campaigns-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
process.env.RADAR_OWNER_TOKEN='campaign-owner-secret';
process.env.RADAR_AGENT_TOKEN='campaign-agent-secret';
const {createServer,closeDatabase}=await import('../src/server.mjs');

test('campaign routes enforce owner auth, revision fences and the manual-publication-only workflow',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const owner={'Content-Type':'application/json','X-Radar-Owner-Key':'campaign-owner-secret'};
 const agent={'Content-Type':'application/json',Authorization:'Bearer campaign-agent-secret'};
 const call=async(path,method='GET',body,headers=owner)=>{
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 };
 try{
  const opp=await call('/api/opportunities','POST',{title:'Campaign flow',problem:'Repeated manual work',market:'China'});
  assert.equal(opp.status,201);
  const proj=await call('/api/experiments','POST',{opportunityId:opp.data.item.id,goal:'validate flow',hypothesis:'people want it',criteria:['core flow works'],stopCondition:'stop after budget'});
  assert.equal(proj.status,201);const pid=proj.data.project.id;
  // permission negatives: missing owner key and agent tokens cannot read or write campaigns
  assert.equal((await call('/api/projects/'+pid+'/campaigns','GET',undefined,{})).status,401);
  assert.equal((await call('/api/projects/'+pid+'/campaigns','GET',undefined,agent)).status,401);
  assert.equal((await call('/api/projects/'+pid+'/campaigns','POST',{name:'X',goal:'Y',channels:['blog']},agent)).status,401);
  assert.equal((await call('/api/projects/'+pid+'/campaigns/'+crypto.randomUUID()+'/cancel','POST',{reason:'whatever reason',expected_revision:1},agent)).status,401);
  // input validation and unknown project
  assert.equal((await call('/api/projects/'+pid+'/campaigns','POST',{goal:'Y',channels:['blog']})).status,400);
  assert.equal((await call('/api/projects/unknown/campaigns','POST',{name:'X',goal:'Y',channels:['blog']})).status,404);
  assert.equal((await call('/api/projects/unknown/campaigns','GET')).status,404);
  const created=await call('/api/projects/'+pid+'/campaigns','POST',{name:'首发征集',goal:'收集真实试用反馈',channels:['blog','community'],startAt:'2027-01-01',endAt:'2027-01-15',budget:{cash:100}});
  assert.equal(created.status,201);const c=created.data.item;
  assert.equal(c.status,'active');
  assert.deepEqual(c.channels,['blog','community']);
  // revision fence on adjust
  assert.equal((await call('/api/projects/'+pid+'/campaigns/'+c.id+'/adjust','POST',{goal:'新目标',expected_revision:c.revision-1})).status,409);
  const adjusted=await call('/api/projects/'+pid+'/campaigns/'+c.id+'/adjust','POST',{goal:'新目标',expected_revision:c.revision});
  assert.equal(adjusted.status,200);assert.equal(adjusted.data.item.goal,'新目标');
  // content joins the campaign through the existing v2.8 content API
  const content=await call('/api/projects/'+pid+'/contents','POST',{title:'内容',body:'真实进展',objective:'反馈',channel:'blog',campaignId:c.id});
  assert.equal(content.status,200);assert.equal(content.data.item.campaignId,c.id);
  assert.equal((await call('/api/projects/'+pid+'/contents','POST',{title:'X',body:'B',objective:'O',channel:'blog',campaignId:'nope'})).status,404);
  // project response carries campaigns plus the calendar/reminders read model
  const project=await call('/api/projects/'+pid);
  assert.equal(project.data.campaigns.length,1);
  assert.equal(project.data.campaignReview.campaigns[0].id,c.id);
  assert.ok(Array.isArray(project.data.campaignReview.calendar));
  assert.ok(Array.isArray(project.data.campaignReview.notes));
  assert.ok(project.data.pipeline);
  const overview=await call('/api/projects/'+pid+'/campaigns');
  assert.equal(overview.status,200);
  assert.equal(overview.data.campaigns[0].contentCounts.drafts,1);
  assert.equal(overview.data.campaigns[0].actuals.refund,null); // unknown, not zero
  // cancel needs a real reason; afterwards adjustment is closed
  assert.equal((await call('/api/projects/'+pid+'/campaigns/'+c.id+'/cancel','POST',{reason:'太短',expected_revision:adjusted.data.item.revision})).status,400);
  assert.equal((await call('/api/projects/'+pid+'/campaigns/'+c.id+'/cancel','POST',{reason:'取消原因：集中精力打磨产品',expected_revision:1})).status,409);
  const cancelled=await call('/api/projects/'+pid+'/campaigns/'+c.id+'/cancel','POST',{reason:'取消原因：集中精力打磨产品',expected_revision:adjusted.data.item.revision});
  assert.equal(cancelled.status,200);assert.equal(cancelled.data.item.status,'cancelled');
  assert.equal((await call('/api/projects/'+pid+'/campaigns/'+c.id+'/adjust','POST',{goal:'x',expected_revision:cancelled.data.item.revision})).status,409);
  assert.equal((await call('/api/projects/'+pid+'/campaigns/'+c.id+'/retrospective','POST',{summary:'一份太短的复盘',expected_revision:cancelled.data.item.revision})).status,400);
  const retro=await call('/api/projects/'+pid+'/campaigns/'+c.id+'/retrospective','POST',{summary:'活动取消：预算转向产品打磨，内容保留待后续复用',expected_revision:cancelled.data.item.revision});
  assert.equal(retro.status,200);assert.ok(retro.data.item.retrospective.summary);
  // agent context never contains campaign data
  const context=await call('/api/agent/tools/project.get_context','POST',{project_id:pid},agent);
  assert.equal(context.status,200);
  assert.equal(JSON.stringify(context.data).includes('campaign'),false);
 }finally{
  await new Promise(r=>server.close(r));
  closeDatabase(); // release the SQLite handle so Windows can delete the temp dir
  rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
