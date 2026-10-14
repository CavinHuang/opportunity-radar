import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=readFileSync(new URL('../.github/workflows/production-watch.yml',import.meta.url),'utf8');

test('manual watch accepts one-off HTTPS origin and deployment SHA without persisting settings',()=>{
 assert.match(file,/workflow_dispatch:\s+inputs:\s+production_url:/);
 assert.match(file,/production_url:\s+description:[^\n]+\n\s+required: false\s+type: string/);
 assert.match(file,/RADAR_PRODUCTION_URL: \$\{\{ inputs\.production_url \|\| vars\.RADAR_PRODUCTION_URL \}\}/);
 assert.match(file,/RADAR_EXPECTED_DEPLOY_SHA: \$\{\{ inputs\.expected_sha \|\| vars\.RADAR_EXPECTED_DEPLOY_SHA \}\}/);
 assert.match(file,/require_rollback_monitoring:[\s\S]+default: true/);
 assert.match(file,/require_pinned_revision:[\s\S]+default: true/);
 assert.match(file,/node scripts\/production-watch-acceptance\.mjs/);
 assert.match(file,/if: github\.event_name == 'workflow_dispatch' && env\.RADAR_PRODUCTION_URL == ''/);
});
test('a manual test can never create, close or reopen canonical production issue alerts',()=>{
 assert.match(file,/name: Reconcile production incidents \(scheduled canonical monitor only\)\n/);
 assert.match(file,/if: github\.event_name == 'schedule' && env\.RADAR_PRODUCTION_URL != ''\n\s+run: node scripts\/production-watch-issues\.mjs/);
 assert.equal((file.match(/node scripts\/production-watch-issues\.mjs/g)||[]).length,1);
 assert.match(file,/name: Explicit external monitoring readiness, no production probe/);
 assert.match(file,/if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});
