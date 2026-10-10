// Verifies a COMPLETED, PRE-EXISTING real GitHub commit + CI, not a fake check.
// In a PR runner, never verify its own still-running SHA: that causes deadlock.
import assert from 'node:assert/strict';
import {verifyGitHubEvidence} from '../src/github.mjs';
const sha=process.env.RADAR_LIVE_GITHUB_SHA||'ace6e15c508cb6bf90083b8782357cd3de488080';
const repo=process.env.RADAR_LIVE_GITHUB_REPO||'CavinHuang/opportunity-radar';
const requiredChecks=process.env.RADAR_REQUIRED_CHECKS||'test';
if(!/^[0-9a-f]{40}$/i.test(sha))throw new Error('Specify a complete previously green commit SHA');
const evidence={sourceUri:'https://github.com/'+repo+'/commit/'+sha,repo,commitSha:sha};
const result=await verifyGitHubEvidence(evidence,process.env.GITHUB_TOKEN,{requiredChecks});
assert.equal(result.state,'verified',JSON.stringify(result));
assert.equal(result.checks.length,requiredChecks.split(',').length);
assert.ok(result.checks.every(x=>x.headSha===sha&&x.conclusion==='success'));
const wrong={...evidence,commitSha:'0'.repeat(40)};
const mismatch=await verifyGitHubEvidence(wrong,process.env.GITHUB_TOKEN,{requiredChecks});
assert.equal(mismatch.state,'unverified','Mismatched SHA must not inherit previous success');
console.log(JSON.stringify({passed:true,repository:repo,verifiedSha:sha,requiredChecks:result.checks.map(c=>({name:c.name,runId:c.runId,htmlUrl:c.htmlUrl})),negativeMismatchRejected:true},null,2));
console.log('This validates GitHub evidence API integration ONLY, not real Agent code changes, G4 Owner acceptance or customer demand.');
