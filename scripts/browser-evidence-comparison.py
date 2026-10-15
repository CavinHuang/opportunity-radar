"""Real Chromium/HTTP/SQLite comparison journey; model and evidence are synthetic."""
from pathlib import Path
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = 'http://127.0.0.1:49625'
KEY = 'comparison-browser-fixture'
NODE = r"""
import http from 'node:http';
import {openDatabase} from './src/db.mjs';
import {candidateContext} from './src/opportunity-research.mjs';
const db=openDatabase(process.env.RADAR_DB);
db.put('sources',{id:'a',status:'new',url:'https://example.org/original',
 title:'I cannot import CSV files into Excel',description:'I manually import CSV every day and spend 3 hours fixing errors.'});
const ctx=candidateContext(db,'signal:a');
db.put('opportunity_external_research',{id:'signal:a',candidateFingerprint:ctx.fingerprint,
 results:[{url:'https://example.org/export',title:'CSV Excel export tool',excerpt:'This tool exports Excel sheets to CSV; it does not import CSV.',triageType:'possible_alternative'}]});
db.close();
let homeCalls=0,releaseHome=null;
const model=http.createServer(async(req,res)=>{
 if(req.url==='/release-home'){releaseHome?.();res.end('OK');return;}
 if(req.url==='/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({homeCalls}));return;}
 let body='';for await(const chunk of req)body+=chunk;
 const request=JSON.parse(body);
 if(request.messages.length===1){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));return;}
 const prompt=JSON.parse(request.messages[1].content);
 if(prompt.candidates){
  const attempt=++homeCalls;
  if(attempt===2)await new Promise(resolve=>{releaseHome=resolve;});
  const rows=attempt===1?[]:prompt.candidates.map(x=>({id:x.id,verdict:'keep',reason:'用户的重复导入任务需要核查'}));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(rows)}}]}));return;
 }
 const original=prompt.quotations.original.find(x=>x.quote.includes('I manually import CSV'));
 const external=prompt.quotations.external.find(x=>x.quote.includes('it does not import CSV'));
 res.writeHead(200,{'Content-Type':'application/json'});
 res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({
 taskRelation:'different_task',relationReason:'原帖需要导入，外部工具描述导出，方向不同。',
 originalEvidence:{quoteId:original.quoteId},externalEvidence:{quoteId:external.quoteId},
 solutionCoverage:'not_described',coverageReason:'片段未描述原帖需要的导入办法，不能推断没有其他方案。',
 coverageQuoteId:'',nextCheck:'检查工具是否另有导入入口；若支持原帖输入，则撤回不同任务判断。'
 })}}]}));
});
await new Promise(resolve=>model.listen(49624,'127.0.0.1',resolve));
const {createServer}=await import('./src/server.mjs');
createServer().listen(49625,'127.0.0.1');
"""

def call(path, payload=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode() if payload is not None else None, headers={'X-Radar-Owner-Key': KEY})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)

with tempfile.TemporaryDirectory(prefix='radar-comparison-browser-') as directory:
    env = {**os.environ, 'RADAR_DB': directory + '/radar.sqlite',
           'RADAR_OWNER_TOKEN': KEY, 'RADAR_FEED_URLS': '',
           'RADAR_LLM_BASE_URL': 'http://127.0.0.1:49624',
           'RADAR_LLM_API_KEY': 'synthetic', 'RADAR_LLM_MODEL': 'fixture'}
    server = subprocess.Popen(['node', '--input-type=module', '-e', NODE], cwd=ROOT,
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                call('/api/health')
                break
            except Exception:
                time.sleep(0.12)
        else:
            raise AssertionError('Synthetic comparison server did not start')
        path = '/api/opportunity-scan/signal%3Aa/evidence-review'
        assert call(path)['reviews'] == []
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            context = browser.new_context(viewport={'width': 1365, 'height': 900}, locale='zh-CN')
            context.add_init_script("sessionStorage.setItem('radar-owner-token','comparison-browser-fixture')")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE, wait_until='networkidle', timeout=20000)
            page.locator('[data-action="manage-sources"]').first.click()
            page.locator('[data-action="opportunity-workbench"][data-id="signal:a"]').click()
            page.locator('#modal-root [data-action="workbench-evidence-review"]').click()
            comparison = page.locator('#modal-root [data-action="workbench-evidence-compare"]')
            assert comparison.get_attribute('type') == 'button'
            page.locator('#modal-root [data-action="workbench-evidence-next"]').click()
            page.locator('#modal-root').get_by_text('已有 AI 草稿 1/1', exact=False).wait_for(timeout=10000)
            assert len(call(path)['comparisons']) == 1
            page.locator('#modal-root [data-action="workbench-evidence-compare"]').click()
            page.locator('#modal-root').get_by_text('可能是不同任务', exact=True).wait_for(timeout=10000)
            assert page.locator('#modal-root').get_by_text('I manually import CSV every day', exact=False).count() == 1
            assert call(path)['comparisons'][0]['citationFormat'] == 'indexed-quotes-v1'
            assert page.locator('#dialog-form button[type="submit"]').count() == 0
            assert call(path)['reviews'] == []
            saved = call(path)['comparisons']
            assert len(saved) == 1
            page.locator('#modal-root [data-action="workbench-evidence-review"]').click()
            page.locator('#modal-root summary').filter(has_text='AI 判断任务不同').click()
            cached_button = page.locator('#modal-root [data-action="workbench-evidence-compare"]')
            assert cached_button.inner_text() == '查看已保存 AI 对照'
            cached_button.click()
            page.locator('#modal-root').get_by_text('可能是不同任务', exact=True).wait_for()
            assert call(path)['comparisons'][0]['generatedAt'] == saved[0]['generatedAt']
            page.locator('#modal-root [data-action="workbench-review-item"]').click()
            page.locator('#dialog-form textarea[name="notes"]').wait_for()
            assert page.locator('#dialog-form textarea[name="notes"]').input_value() == ''
            assert page.locator('#dialog-form select[name="classification"]').input_value() == 'uncertain'
            assert call(path)['reviews'] == []
            page.locator('#modal-root .modal-close').click()
            page.locator('[data-action="model-diagnostics"]').click()
            page.locator('#modal-root').get_by_text('研究与草稿模型', exact=True).wait_for()
            assert page.locator('#dialog-form button[type="submit"]').count() == 0
            page.locator('#modal-root [data-action="model-probe"][data-id="llm"]').click()
            page.locator('#modal-root').get_by_text('最小请求已通过；真实任务仍需验证。', exact=True).wait_for(timeout=10000)
            assert call('/api/operations/models')['recent'][0]['operation'] == 'connectivity_probe'
            assert call(path)['comparisons'][0]['generatedAt'] == saved[0]['generatedAt']
            assert call(path)['reviews'] == []
            page.locator('#modal-root .modal-close').click()
            failed_scan = call('/api/home/opportunities/retry', {})['discovery']
            assert failed_scan['status'] == 'filter_failed'
            page.locator('[data-action="show-opportunities"]').click()
            retry_home = page.locator('[data-action="retry-home-analysis"]').first
            retry_home.wait_for()
            assert page.get_by_text('不重新扫描信息源。原帖、模型或反馈变化后，会重新分析对应候选。', exact=True).count() >= 1
            retry_home.click()
            page.locator('[aria-label="首页检索任务"]').get_by_text('正在分析候选', exact=True).wait_for(timeout=10000)
            running = call('/api/home/opportunities/jobs/current')['job']
            assert running['inProgress'] is True
            page.reload(wait_until='networkidle')
            page.locator('[aria-label="首页检索任务"]').get_by_text('正在分析候选', exact=True).wait_for(timeout=10000)
            attached = call('/api/home/opportunities/jobs/current')['job']
            assert attached['jobId'] == running['jobId']
            with urllib.request.urlopen('http://127.0.0.1:49624/stats') as stats_response:
                assert json.load(stats_response)['homeCalls'] == 2
            with urllib.request.urlopen('http://127.0.0.1:49624/release-home') as release_response:
                assert release_response.status == 200
            page.locator('[data-action="retry-home-analysis"]').first.wait_for(state='detached')
            page.locator('[aria-label="首页检索任务"]').get_by_text('本轮分析完成', exact=True).wait_for(timeout=10000)
            complete = call('/api/home/opportunities')
            assert complete['status'] == 'filtered'
            assert complete['analysis']['unclassified'] == 0
            assert complete['accepted'] == 1
            assert call(path)['reviews'] == []
            assert call(path)['comparisons'][0]['generatedAt'] == saved[0]['generatedAt']
            assert not errors, errors
            browser.close()
        print(json.dumps({'synthetic': True, 'comparisonVisible': True,
                          'backgroundJobReattached': True, 'homeAnalysisRecovery': True, 'modelDiagnosticsProbe': True, 'boundedContinuation': True, 'savedDraftReused': True, 'ownerNotesNotPrefilled': True, 'ownerReviews': 0}, ensure_ascii=False))
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
