import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {verifyGitHubEvidence} from '../src/github.mjs';

const sha='a'.repeat(40);
function setup(){
  const db=openDatabase();const service=createService(db);
  const opp=service.createOpportunity({title:'Consumer scenario',problem:'Repeated customer friction',market:'CN'});
  const project=service.startExperiment({opportunityId:opp.id,goal:'Prototype',hypothesis:'Real people need it',criteria:['User finishes one core flow'],stopCondition:'Stop after 10 hours'});
  return {db,service,project,milestone:service.getFullProject(project.id).milestones[1]};
}
function attach(s,project,m,criteriaIds=[],key='evidence1'){
  return s.tool('evidence.attach',{project_id:project.id,milestone_id:m.id,type:'github_pr',source_uri:'https://github.com/a/b/pull/1',commit_sha:sha,criteria_ids:criteriaIds,idempotency_key:key});
}

test('idempotency keys reject different arguments or tool names',()=>{
  const {db,service:s,project:p,milestone:m}=setup();
  try{
    const input={project_id:p.id,milestone_id:m.id,title:'Prototype',idempotency_key:'same-key'};
    const one=s.tool('task.upsert',input);
    assert.deepEqual(s.tool('task.upsert',{...input}),one);
    assert.throws(()=>s.tool('task.upsert',{...input,title:'Different task'}),{code:'IDEMPOTENCY_CONFLICT'});
    assert.throws(()=>s.tool('progress.report',{project_id:p.id,summary:'Hello',idempotency_key:'same-key'}),{code:'IDEMPOTENCY_CONFLICT'});
    assert.equal(s.getFullProject(p.id).tasks.length,1);
  }finally{db.close();}
});

test('baseline revision updates milestone criteria and invalidates obsolete submissions',()=>{
  const {db,service:s,project:p,milestone:m}=setup();
  try{
    const oldCriteria=p.baselines[0].criteria[0];
    const old=attach(s,p,m,[oldCriteria.id]);
    const submission=s.tool('handoff.submit',{project_id:p.id,milestone_id:m.id,baseline_revision:1,commit_sha:sha,evidence_ids:[old.id],idempotency_key:'handoff-1'});
    const revised=s.ownerDecision(p.id,{action:'revise_baseline',reason:'Customer need changed',criteria:['New customer acceptance condition']});
    const current=s.getFullProject(p.id).milestones[1];
    assert.notDeepEqual(current.acceptanceIds,[oldCriteria.id]);
    assert.deepEqual(current.acceptanceIds,revised.baselines.at(-1).criteria.map(c=>c.id));
    assert.throws(()=>s.ownerDecision(p.id,{action:'accept',submissionId:submission.id,reason:'Outdated'}),{code:'BASELINE_STALE'});
    assert.throws(()=>attach(s,p,current,[oldCriteria.id],'invalid-criteria'),{code:'BAD_REQUEST'});
    const latest=attach(s,p,current,current.acceptanceIds,'new-evidence');
    const next=s.tool('handoff.submit',{project_id:p.id,milestone_id:current.id,baseline_revision:2,commit_sha:sha,evidence_ids:[latest.id],idempotency_key:'handoff-2'});
    assert.equal(next.g2State,'covered');
  }finally{db.close();}
});

test('evidence cannot be attached to or submitted across milestone boundaries',()=>{
  const {db,service:s,project:p,milestone:m}=setup();
  try{
    const research=s.getFullProject(p.id).milestones[0];
    const evidence=attach(s,p,m,p.baselines[0].criteria.map(c=>c.id));
    assert.throws(()=>s.tool('handoff.submit',{project_id:p.id,milestone_id:research.id,baseline_revision:1,evidence_ids:[evidence.id],idempotency_key:'cross'}),{code:'FORBIDDEN'});
    assert.throws(()=>s.tool('evidence.attach',{project_id:p.id,milestone_id:research.id,type:'github_pr',criteria_ids:p.baselines[0].criteria.map(c=>c.id),idempotency_key:'cross-criteria'}),{code:'BAD_REQUEST'});
  }finally{db.close();}
});

test('only latest pending submission can be decided once',()=>{
  const {db,service:s,project:p,milestone:m}=setup();
  try{
    const e=attach(s,p,m,p.baselines[0].criteria.map(c=>c.id));
    const args={project_id:p.id,milestone_id:m.id,baseline_revision:1,commit_sha:sha,evidence_ids:[e.id]};
    const a=s.tool('handoff.submit',{...args,idempotency_key:'submission-1'});
    const b=s.tool('handoff.submit',{...args,idempotency_key:'submission-2'});
    assert.throws(()=>s.ownerDecision(p.id,{action:'reject',submissionId:a.id,reason:'Old proposal'}),{code:'SUBMISSION_SUPERSEDED'});
    s.ownerDecision(p.id,{action:'reject',submissionId:b.id,reason:'Needs work'});
    assert.throws(()=>s.ownerDecision(p.id,{action:'reject',submissionId:b.id,reason:'Retry'}),{code:'BAD_STATE'});
  }finally{db.close();}
});

test('GitHub G1 verifies only required checks for exactly the proposed SHA',async()=>{
  const requests=[];
  const mock=async url=>{
    requests.push(url);
    if(url.includes('/pulls/'))return {ok:true,json:async()=>({head:{sha}})};
    if(url.includes('/check-runs'))return {ok:true,json:async()=>({total_count:2,check_runs:[
      {id:1,name:'test',head_sha:sha,status:'completed',conclusion:'success',started_at:'2026-10-10T08:00:00Z'},
      {id:2,name:'optional-lint',head_sha:sha,status:'completed',conclusion:'failure',started_at:'2026-10-10T08:00:00Z'}
    ]})};
    return {ok:true,json:async()=>({sha})};
  };
  const evidence={sourceUri:'https://github.com/a/b/pull/1',repo:'a/b',commitSha:sha};
  const r=await verifyGitHubEvidence(evidence,'',{fetchImpl:mock,requiredChecks:'test'});
  assert.equal(r.state,'verified');assert.deepEqual(r.checks.map(c=>c.name),['test']);assert.equal(requests.length,3);
  assert.equal((await verifyGitHubEvidence({...evidence,repo:'another/repo'},'',{fetchImpl:mock,requiredChecks:'test'})).state,'unverified');
});

test('GitHub G1 rejects mismatched SHA and prioritizes newer failed reruns',async()=>{
  let checks=[{id:1,name:'test',head_sha:sha,status:'completed',conclusion:'success',started_at:'2026-10-10T07:00:00Z'},
    {id:2,name:'test',head_sha:sha,status:'completed',conclusion:'failure',started_at:'2026-10-10T08:00:00Z'}];
  const mock=async url=>({ok:true,json:async()=>url.includes('/check-runs')?{total_count:checks.length,check_runs:checks}: {sha}});
  const e={sourceUri:'https://github.com/a/b/commit/'+sha,commitSha:sha};
  assert.equal((await verifyGitHubEvidence(e,'',{fetchImpl:mock,requiredChecks:'test'})).state,'unverified');
  checks=[{...checks[0],head_sha:'b'.repeat(40)}];
  assert.equal((await verifyGitHubEvidence(e,'',{fetchImpl:mock,requiredChecks:'test'})).state,'unverified');
  checks=[{...checks[0],head_sha:sha,status:'in_progress'}];
  assert.equal((await verifyGitHubEvidence(e,'',{fetchImpl:mock,requiredChecks:'test'})).state,'pending');
});


test('product delivery cannot use non-GitHub owner attestation to bypass G1',()=>{
  const {db,service:s,project:p,milestone:m}=setup();
  try{
    const e=attach(s,p,m,p.baselines[0].criteria.map(c=>c.id));
    s.store.put('evidence',{...e,verificationState:'owner_attested'},e.revision);
    const sub=s.tool('handoff.submit',{project_id:p.id,milestone_id:m.id,baseline_revision:1,commit_sha:sha,evidence_ids:[e.id],idempotency_key:'owner-attested-sub'});
    assert.throws(()=>s.ownerDecision(p.id,{action:'accept',submissionId:sub.id,reason:'reviewed'}),{code:'GITHUB_G1_REQUIRED'});
  }finally{db.close();}
});
