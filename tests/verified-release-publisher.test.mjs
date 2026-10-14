import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const publisher=readFileSync(new URL('../.github/workflows/publish-release-image.yml',import.meta.url),'utf8');
const compose=readFileSync(new URL('../docker-compose.yml',import.meta.url),'utf8');
const dockerCheck=readFileSync(new URL('../.github/workflows/docker.yml',import.meta.url),'utf8');

test('only successful main push CI in the same repository authorizes a GHCR publication',()=>{
 assert.match(publisher,/workflow_run:[\s\S]*workflows: \[CI\]/);
 assert.match(publisher,/github\.event\.workflow_run\.conclusion == 'success'/);
 assert.match(publisher,/github\.event\.workflow_run\.event == 'push'/);
 assert.match(publisher,/github\.event\.workflow_run\.head_branch == 'main'/);
 assert.match(publisher,/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
 assert.match(publisher,/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
 assert.match(publisher,/test "\$\(git rev-parse HEAD\)" = "\$VERIFIED_SHA"/);
 assert.match(publisher,/permissions:\s+contents: read\s+packages: write/);
 assert.doesNotMatch(publisher,/workflow_dispatch:/);
 assert.doesNotMatch(publisher,/\bpull_request:/);
});
test('release tag embeds exact full source SHA, smoke-checks and only then publishes the same image',()=>{
 assert.match(publisher,/ghcr\.io\/\$\{GITHUB_REPOSITORY,,\}:sha-\$VERIFIED_SHA/);
 assert.match(publisher,/RADAR_RELEASE_SHA=\$\{\{ steps\.release\.outputs\.sha \}\}/);
 assert.match(publisher,/platforms: linux\/amd64/);
 assert.match(publisher,/load: true\s+push: false/);
 assert.match(publisher,/scripts\/verify-release\.mjs --allow-http-loopback/);
 assert.match(publisher,/--expected-sha "\$RELEASE_SHA"/);
 const check=publisher.indexOf('Verify the same image');
 const login=publisher.indexOf('Login using repository-scoped GITHUB_TOKEN');
 const push=publisher.indexOf('docker push "$RELEASE_IMAGE"');
 assert.ok(check>0&&login>check&&push>login,'must test exact image before authenticated registry publication');
 assert.match(publisher,/docker push "\$RELEASE_IMAGE" \| tee/);
 assert.match(publisher,/digest: \\(sha256:/);
 assert.match(publisher,/For Dokploy select:/);
 assert.doesNotMatch(publisher,/\:latest/);
});
test('Docker Compose does not erase SHA baked into a GHCR image with an empty runtime env',()=>{
 assert.match(compose,/build:\s+context: \.\s+args:\s+RADAR_RELEASE_SHA:/);
 const environment=compose.split('    environment:')[1].split('    ports:')[0];
 assert.doesNotMatch(environment,/^\s+RADAR_RELEASE_SHA:/m);
 assert.match(compose,/never override it with an empty env/);
 assert.match(dockerCheck,/\.github\/workflows\/publish-release-image\.yml/);
});
