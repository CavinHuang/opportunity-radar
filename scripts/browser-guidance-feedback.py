"""Focused, real Chromium E2E for research-guidance feedback (all records synthetic)."""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import time
import urllib.request
import urllib.parse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = 'http://127.0.0.1:49623'
KEY = 'guidance-e2e-owner-key'

def call(path, data=None):
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type': 'application/json', 'X-Radar-Owner-Key': KEY},
        method='POST' if data is not None else 'GET'
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)

with tempfile.TemporaryDirectory(prefix='radar-guidance-browser-') as directory:
    env = {
        **os.environ,
        'RADAR_DB': directory + '/radar.sqlite',
        'RADAR_PORT': '49623',
        'RADAR_HOST': '127.0.0.1',
        'RADAR_OWNER_TOKEN': KEY,
        'RADAR_FEED_URLS': ''
    }
    server = subprocess.Popen(['node', 'src/server.mjs'], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                call('/api/health')
                break
            except Exception:
                time.sleep(0.12)
        else:
            raise AssertionError('Synthetic browser test server never started')

        # Guaranteed production-qualified problem fixture; this is not consumer evidence.
        origin = 'https://example.org/test-guidance/receipts'
        call('/api/signals/manual', {
            'url': origin,
            'title': 'Cannot automate repetitive receipts workflow',
            'description': 'I spend hours manually copying receipts between tools.',
            'market': 'International'
        })
        candidates = call('/api/opportunity-scan')['items']
        candidate = next((item for item in candidates if origin in item['sourceUrls']), None)
        assert candidate, 'Fixture did not produce a visible review candidate'
        candidate_id = candidate['id']
        path = '/api/opportunity-scan/' + urllib.parse.quote(candidate_id, safe='') + '/research-guidance/feedback'

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            context = browser.new_context(viewport={'width': 1365, 'height': 900}, locale='zh-CN')
            context.add_init_script("sessionStorage.setItem('radar-owner-token','guidance-e2e-owner-key')")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                page.goto(BASE, wait_until='networkidle', timeout=20000)
                page.locator('[data-action="manage-sources"]').first.click()
                target = page.locator('[data-action="research-decision-guidance"][data-id="' + candidate_id + '"]')
                target.wait_for(timeout=12000)
                target.click()
                page.locator('#dialog-form').wait_for(timeout=10000)
                assert page.locator('#modal-root').get_by_text('先制定最小研究计划').count() == 1
                page.locator('#modal-root [data-action="research-guidance-record"]').click()

                page.locator('#dialog-form select[name="response"]').select_option('adapted')
                page.locator('#dialog-form textarea[name="reason"]').fill(
                    '这是用于检验交互的合成样例，人工决定先缩小研究范围再观察。')
                page.locator('#dialog-form textarea[name="chosenAction"]').fill(
                    '只记录合成场景并访谈两名自愿参与者')
                page.locator('#dialog-form button[type="submit"]').click()
                page.locator('#modal-root .modal').wait_for(state='hidden', timeout=12000)

                board = call(path)
                assert board['summary']['total'] == 1
                assert board['summary']['adapted'] == 1
                assert board['summary']['pending'] == 1
                assert board['entries'][0]['recommendation']['action'] == 'plan_research'
                assert board['entries'][0]['followup'] is None

                target = page.locator('[data-action="research-decision-guidance"][data-id="' + candidate_id + '"]')
                target.click()
                assert page.locator('#modal-root [data-action="research-guidance-record"]').count() == 0
                page.locator('#modal-root [data-action="research-guidance-followup"]').first.click()
                page.locator('#dialog-form select[name="assessment"]').select_option('uncertain')
                page.locator('#dialog-form input[name="actualHours"]').fill('1.5')
                page.locator('#dialog-form input[name="evidenceUrl"]').fill('https://example.org/test-guidance/notes')
                page.locator('#dialog-form textarea[name="notes"]').fill(
                    '合成浏览器测试只有模拟观察，不存在已经核验的独立用户证据。')
                page.locator('#dialog-form button[type="submit"]').click()
                page.locator('#modal-root .modal').wait_for(state='hidden', timeout=12000)

                final_board = call(path)
                assert final_board['summary']['total'] == 1
                assert final_board['summary']['followedUp'] == 1
                assert final_board['summary']['pending'] == 0
                assert final_board['summary']['uncertain'] == 1
                assert final_board['entries'][0]['followup']['actualHours'] == 1.5
                assert final_board['entries'][0]['followup']['selfReported'] is True
                page.reload(wait_until='networkidle')
                persisted = page.locator('[data-action="research-decision-guidance"][data-id="' + candidate_id + '"]')
                persisted.wait_for(timeout=12000)
                persisted.click()
                assert page.locator('#modal-root').get_by_text('主观认为有帮助').count() == 0
                page.locator('#modal-root').get_by_text('尚无法判断').wait_for(timeout=12000)
                assert page.locator('#modal-root [data-action="research-guidance-followup"]').count() == 0
                assert not errors, 'Page JavaScript errors: ' + repr(errors)
                out = ROOT / 'artifacts' / 'browser-smoke'
                out.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(out / 'research-guidance-feedback.png'), full_page=True)
                print('Direct real Chromium research feedback E2E passed: response, follow-up and reload.')
            except Exception:
                out = ROOT / 'artifacts' / 'browser-smoke'
                out.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(out / 'research-guidance-feedback-failure.png'), full_page=True)
                print('Browser errors:', errors, flush=True)
                print('Toast:', page.locator('#toast-root').inner_text(), flush=True)
                print('Page:', page.locator('body').inner_text()[:3500], flush=True)
                raise
            finally:
                browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
