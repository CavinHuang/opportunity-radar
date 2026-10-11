import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPipeline} from '../src/project-pipeline.mjs';

const base=()=>({status:'research',baselines:[{revision:2}],tasks:[],milestones:[{acceptanceState:'pending'},{acceptanceState:'pending'}],submissions:[],decisions:[],contents:[]});
test('a chosen project starts with an actionable kickoff without invented progress',()=>{
 const p=projectPipeline(base());
 assert.equal(p.progressLabel,'0/2 里程碑已人工验收');
 assert.equal(p.nextActions[0].kind,'kickoff');
 assert.equal(p.launchReady,false);
});
test('stale tasks excluded, pending delivery and decisions take priority',()=>{
 const p=base();p.tasks=[{status:'submitted',baselineRevision:1},{status:'rework',baselineRevision:2}];
 p.submissions=[{acceptanceState:'pending',baselineRevision:2}];p.decisions=[{status:'pending'}];
 const r=projectPipeline(p);
 assert.equal(r.totalTasks,1);assert.equal(r.taskCounts.rework,1);
 assert.deepEqual(r.nextActions.slice(0,2).map(x=>x.kind),['decision','acceptance']);
});
test('launch requires all milestones accepted and manual content approval',()=>{
 const p=base();p.milestones.forEach(m=>m.acceptanceState='accepted');
 p.contents=[{reviewState:'draft'},{reviewState:'approved',revision:2,approvedRevision:2}];
 const r=projectPipeline(p);
 assert.equal(r.launchReady,true);
 assert.equal(r.nextActions[0].kind,'publish');
 p.contents=[{reviewState:'published',revision:3,approvedRevision:2}];
 assert.equal(projectPipeline(p).nextActions[0].kind,'draft');
 assert.equal(projectPipeline(p).nextActions.at(-1).kind,'measure');
});
test('paused project does not suggest starting external work',()=>{
 const p=base();p.status='paused';p.tasks=[{status:'open',baselineRevision:2}];
 const r=projectPipeline(p);
 assert.deepEqual(r.nextActions.map(x=>x.kind),['project_state']);
});
