"""Real browser E2E on a clean SQLite database. No browser fetch bridge or consumer secrets."""
from pathlib import Path
import json, os, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
BASE='http://127.0.0.1:49619'
def call(path, data=None):
    req=urllib.request.Request(BASE+path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type':'application/json','X-Radar-Owner-Key':'ui-smoke-owner-key'},
        method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req,timeout=10) as response:
        return json.load(response)

with tempfile.TemporaryDirectory(prefix='radar-browser-smoke-') as directory:
    env={**os.environ,'RADAR_DB':directory+'/smoke.sqlite','RADAR_PORT':'49619',
         'RADAR_HOST':'127.0.0.1','RADAR_OWNER_TOKEN':'ui-smoke-owner-key',
         'RADAR_FEED_URLS':''}
    process=subprocess.Popen(['node','src/server.mjs'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for i in range(90):
            try:
                call('/api/health')
                break
            except Exception: time.sleep(0.15)
        else:raise AssertionError('Server never became ready')
        created=call('/api/opportunities',{'title':'[DEMO] Receipt organization','problem':'[DEMO] I repeatedly lose the receipt at home',
            'market':'International','sources':[{'url':'https://example.org/consumer/real-browse-test','quote':'[DEMO] Sample traceable URL, not real customer evidence'}],
            'risk':'No consumer interview or willingness to pay has been established'})
        oid=created['item']['id']
        with sync_playwright() as engine:
            browser=engine.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            context=browser.new_context(viewport={'width':1365,'height':900},locale='zh-CN')
            context.add_init_script("sessionStorage.setItem('radar-owner-token','ui-smoke-owner-key')")
            page=context.new_page()
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(BASE,wait_until='networkidle',timeout=20000)
            page.locator('.hero-title').wait_for(timeout=10000)
            page.locator('[data-action="manage-sources"]').first.click()
            try:
                page.get_by_text('精选公开信息源').wait_for(timeout=10000)
            except Exception:
                out=ROOT/'artifacts'/'browser-smoke'
                out.mkdir(parents=True,exist_ok=True)
                page.screenshot(path=str(out/'source-failure.png'),full_page=True)
                print('BROWSER ERRORS:',errors,flush=True)
                print('BROWSER URL:',page.url,flush=True)
                print('BROWSER TEXT:',page.locator('body').inner_text()[:3500],flush=True)
                print('CATALOG API:',call('/api/source-catalog'),flush=True)
                raise
            first=page.locator('[data-action="install-catalog"][data-id="v2ex-qna"]')
            assert first.count()==1
            page.get_by_text('信息源质量反馈').wait_for(timeout=10000)
            assert page.get_by_text('观察数据 · 非商机评分').count()==1
            first.click()
            feed_id=call('/api/source-catalog')['items'][0]['installedFeedId']
            assert feed_id is not None
            quality=call('/api/source-quality')
            assert any(item['feedId']==feed_id for item in quality['items'])
            page.locator('[data-action="focus-source"]').first.click()
            page.wait_for_function("(feedId) => document.querySelector('#feed-filter')?.value === feedId",arg=feed_id,timeout=8000)
            page.locator('[data-action="show-opportunities"]').first.click()
            page.locator('[data-action="show-research"]').first.click()
            page.get_by_text('反证与未知项').wait_for(timeout=10000)
            assert page.get_by_text('核查来源').count()>=1
            page.locator('[data-action="review-source"]').first.click()
            page.locator('input[name="reviewed_original"]').check()
            page.locator('textarea[name="note"]').fill('The reviewer has read the source and verified it is a synthetic demo, not a genuine customer account.')
            page.locator('#dialog-form button[type="submit"]').click()
            page.wait_for_timeout(500)
            assert call('/api/opportunities/'+oid+'/research')['report']['stage']=='unverified'
            page.locator('#locale-switch').select_option('en-US')
            assert page.locator('html').get_attribute('lang')=='en-US'
            assert not errors,errors
            out=ROOT/'artifacts'/'browser-smoke'
            out.mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(out/'review-en.png'),full_page=True)
            print('Direct localhost browser-to-Node API E2E passed; no mocked responses.')
            browser.close()
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
