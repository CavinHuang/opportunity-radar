import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const content=readFileSync(new URL('../.github/workflows/anonymous-ghcr-pull.yml',import.meta.url),'utf8');
test('anonymous deployment probe uses no registry token and runs only after trusted publication or explicit main bootstrap',()=>{
 assert.match(content,/permissions:\s+contents: read/);
 assert.doesNotMatch(content,/packages: write|docker\/login-action|GITHUB_TOKEN|password:/);
 assert.match(content,/workflow_run:\s+workflows: \[Verified GHCR release image\]/);
 assert.match(content,/github\.event\.workflow_run\.conclusion == 'success'/);
 assert.match(content,/github\.event\.workflow_run\.head_branch == 'main'/);
 assert.match(content,/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
 assert.match(content,/persist-credentials: false/);
});
test('probe isolates Docker client credentials and tests the exact anonymous image over real localhost HTTP',()=>{
 assert.match(content,/export DOCKER_CONFIG="\$\(mktemp -d\)"/);
 assert.match(content,/docker pull "\$image"/);
 assert.match(content,/if ! docker pull "\$image"; then/);
 assert.match(content,/docker run -d --rm --name radar-ghcr-anonymous/);
 assert.match(content,/node scripts\/verify-release\.mjs --allow-http-loopback/);
 assert.match(content,/--expected-sha "\$VERIFIED_SHA"/);
 assert.match(content,/This verifies registry pull accessibility/);
 assert.match(content,/not.*Dokploy production deployment/);
});
