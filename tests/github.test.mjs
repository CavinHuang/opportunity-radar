import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGitHubEvidence} from '../src/github.mjs';
test('GitHub verification never trusts missing or malformed SHA',async()=>{
 const no=await verifyGitHubEvidence({sourceUri:'https://github.com/a/b/pull/1',commitSha:'fake'});
 assert.equal(no.state,'unverified');
});
test('GitHub verification rejects unsupported host and mismatched URLs before network',async()=>{
 const wrong=await verifyGitHubEvidence({sourceUri:'https://fakegithub.com/a/b/pull/1',commitSha:'a'.repeat(40)});
 assert.equal(wrong.state,'unverified');
 const mismatch=await verifyGitHubEvidence({sourceUri:'https://github.com/a/b/commit/'+'b'.repeat(40),commitSha:'a'.repeat(40)});
 assert.equal(mismatch.state,'unverified');
});
