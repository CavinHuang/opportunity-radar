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
                page.get_by_text('首次使用与数据安全').first.wait_for(timeout=10000)
                page.get_by_text('备份你的研究资料').first.wait_for(timeout=10000)
                assert page.locator('[data-action="copy-data-backup"]').count()==1
                # Read-only source cohort diagnosis must render in real Chromium without changing sources.
                page.locator('[data-action="source-cohort-quality"]').first.click()
                page.locator('#modal-root').get_by_text('来源错误归因与复核队列').wait_for(timeout=10000)
                page.locator('#modal-root').get_by_text('按来源域名划分（非独立用户）').wait_for(timeout=10000)
                page.locator('#modal-root [data-modal-close]').first.click()
                assert page.locator('#modal-root .modal').count()==0
                readiness=call('/api/operations/readiness')
                assert any(c['id']=='backup' and c['ok'] is None for c in readiness['checks'])
                assert readiness['mode']=='local-first'

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
            # Isolated manually-entered TEST data: grouping never implies real demand.
            for index,host in enumerate(['example.net','example.com'],start=1):
                call('/api/signals/manual',{
                    'title':'Lost receipts after buying online orders',
                    'description':'[DEMO] Synthetic recurring topic, not a real consumer experience.',
                    'url':'https://'+host+'/demo/source-'+str(index),
                    'market':'International'
                })
            page.locator('[data-action="show-opportunities"]').first.click()
            page.locator('[data-action="manage-sources"]').first.click()
            page.get_by_text('重复问题候选').first.wait_for(timeout=10000)
            before=call('/api/discovery/clusters')
            assert before['total']==1
            assert before['items'][0]['signalCount']==2
            page.locator('[data-action="cluster-dismiss"]').first.click()
            page.locator('textarea[name="reason"]').fill('The two demonstration posts are synthetic duplicates, not real customers.')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            assert call('/api/discovery/clusters')['total']==0
            page.locator('[data-action="toggle-cluster-history"]').first.click()
            page.locator('[data-action="cluster-restore"]').first.click()
            assert call('/api/discovery/clusters')['total']==1
            assert call('/api/discovery/clusters')['items'][0]['diagnostics']['possibleRepost'] is True
            page.locator('[data-action="cluster-confirm"]').first.click()
            page.locator('textarea[name="reason"]').fill('These titles describe a comparable problem, but these test records do not establish independent consumers.')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            assert call('/api/discovery/clusters')['items'][0]['state']=='reviewed_related'
            quality=call('/api/discovery/quality')
            assert quality['ownerMarkedRelated']==1
            assert quality['ownerLabelAgreementRatio'] is None
            assert page.get_by_text('可能转载 / 重复发帖',exact=False).count()>=1
            page.locator('[data-action="cluster-link"]').first.click()
            page.locator('[name="opportunity_id"]').select_option(oid)
            page.locator('[name="acknowledgeUnverified"]').check()
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            after=call('/api/opportunities')
            linked=next(o for o in after['items'] if o['id']==oid)
            assert len(linked['sources'])==3
            assert all(e.get('firsthand')==False and e.get('independent')==False for e in linked['sources'][-2:])
            assert call('/api/discovery/clusters')['total']==0
            page.locator('[data-action="focus-source"]').first.click()
            page.wait_for_function("(feedId) => document.querySelector('#feed-filter')?.value === feedId",arg=feed_id,timeout=8000)
            page.locator('[data-action="show-opportunities"]').first.click()
            page.locator('[data-action="view-validation"]').first.click()
            page.locator('[data-action="validation-new"]').first.click()
            plan_inputs={
                'audience':'Adults keeping household receipts',
                'hypothesis':'Families sometimes fail to retrieve receipts from recent purchases.',
                'researchQuestion':'When did you most recently need a missing purchase receipt?',
                'channel':'Opt-in follow-ups with community members',
                'successCriterion':'Two people independently report concrete failure details',
                'stopCondition':'Pause after four hours with no meaningful interviews',
                'nextAction':'Invite three consenting volunteers for short interviews'
            }
            for key,value in plan_inputs.items():
                page.locator('[name="'+key+'"]').fill(value)
            page.locator('[name="timeBudgetHours"]').fill('4')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            validation=call('/api/opportunities/'+oid+'/validation')['result']
            assert validation['latestPlan']['status']=='active'
            page.locator('[data-action="view-validation"]').first.click()
            page.locator('[data-action="validation-observe"]').first.click()
            page.locator('[name="participantRef"]').fill('demo-only-01')
            page.locator('[name="kind"]').select_option('interview')
            page.locator('[name="stance"]').select_option('contradicts')
            page.locator('[name="note"]').fill('Synthetic end-to-end browser test note, never an actual consumer interview.')
            page.locator('[name="consentConfirmed"]').check()
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            assert call('/api/opportunities/'+oid+'/validation')['result']['counts']['contradicts']==1
            page.locator('[data-action="view-validation"]').first.click()
            page.locator('[data-action="validation-close"]').first.click()
            page.locator('[name="outcome"]').select_option('inconclusive')
            page.locator('[name="reason"]').fill('Only synthetic test records exist, so actual consumer need remains completely unknown.')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            assert call('/api/opportunities/'+oid+'/validation')['result']['latestPlan']['outcome']=='inconclusive'
            page.locator('[data-action="show-research"]').first.click()
            page.get_by_text('反证与未知项').wait_for(timeout=10000)
            assert page.get_by_text('核查来源').count()>=1
            page.locator('[data-action="review-source"]').first.click()
            page.locator('input[name="reviewed_original"]').check()
            page.locator('textarea[name="note"]').fill('The reviewer has read the source and verified it is a synthetic demo, not a genuine customer account.')
            page.locator('#dialog-form button[type="submit"]').click()
            page.wait_for_timeout(500)
            assert call('/api/opportunities/'+oid+'/research')['report']['stage']=='unverified'
            # An approved second research round becomes a linked, Owner-approved experiment.
            approved_plan=call('/api/opportunities/'+oid+'/validation',plan_inputs)['item']
            call('/api/opportunities/'+oid+'/validation/'+approved_plan['id']+'/observations',{
                'participantRef':'demo-consent-01','kind':'interview','stance':'supports',
                'note':'Only a browser fixture; this is NOT a genuine consumer observation.',
                'consentConfirmed':True
            })
            call('/api/opportunities/'+oid+'/validation/'+approved_plan['id']+'/close',{
                'outcome':'continue','reason':'The Owner approves the next prototype stage while consumer demand is unproven.',
                'acknowledgeUncertainty':True,'expected_revision':approved_plan['revision']
            })
            page.locator('[data-action="open-opportunity"]').first.click()
            page.locator('[name="goal"]').fill('Validate the minimal product journey')
            page.locator('[name="hypothesis"]').fill('Users can complete a single important task')
            page.locator('[name="criteria"]').fill('One usable end-to-end core task')
            page.locator('[name="stopCondition"]').fill('Stop after 10 hours or unresolved critical blockers')
            page.locator('[name="selectionRationale"]').fill('Chosen over the other synthetic candidates because two independent posts describe the same commute scenario')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            projects=call('/api/history')['projects']
            linked=next(p for p in projects if p['opportunityId']==oid)
            assert linked['researchBasis']['planId']==approved_plan['id']
            page.get_by_text('批准的研究依据').first.wait_for(timeout=8000)
            page.on('dialog',lambda dialog:dialog.accept())
            page.locator('[data-action="prepare-kickoff"]').click()
            try:
                page.get_by_text('已准备首个可领取任务').wait_for(timeout=10000)
            except Exception:
                # Dump the page state so a missed confirmation toast is diagnosable.
                out=ROOT/'artifacts'/'browser-smoke'
                out.mkdir(parents=True,exist_ok=True)
                page.screenshot(path=str(out/'kickoff-failure.png'),full_page=True)
                print('BROWSER ERRORS:',errors,flush=True)
                print('BROWSER URL:',page.url,flush=True)
                print('TOAST ROOT:',page.locator('#toast-root').inner_text(),flush=True)
                print('BROWSER TEXT:',page.locator('body').inner_text()[:3500],flush=True)
                raise
            assert any(t.get('ownerKickoff') for t in call('/api/projects/'+linked['id'])['tasks'])
            page.locator('[data-tab="agent"]').click()
            page.get_by_text('外部 Agent 同步可信度').first.wait_for(timeout=10000)
            page.get_by_text('5. 启动本地专业 Coding Agent（v1.3）').first.wait_for(timeout=10000)
            page.get_by_text('6. 查看交付与恢复中断任务（v1.4）').first.wait_for(timeout=10000)
            assert page.locator('[data-action="copy-pilot-status"]').count()==1
            assert page.locator('[data-action="copy-pilot-recover"]').count()==1
            assert page.locator('[data-action="copy-pilot-run"]').count()==1
            page.get_by_text('运行默认最长 90 分钟').first.wait_for(timeout=10000)
            assert page.locator('[data-action="copy-pilot-command"]').count()==1
            assert page.get_by_text('尚无 Agent 进度报告').count()>=1
            assert page.get_by_text('过期租约').count()>=1
            assert page.get_by_text('待返工').count()>=1
            # G4 guard prevents logging hypothetical post-acceptance usage.
            page.locator('[data-tab="ledger"]').click()
            assert page.locator('[data-action="add-product-feedback"]').is_disabled()
            # v2.9 Phase A: human task board round-trip (add → card visible).
            page.locator('[data-tab="tasks"]').click()
            page.locator('[data-action="create-owner-task"]').first.click()
            page.locator('[name="title"]').fill('Browser smoke human task')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            page.get_by_text('Browser smoke human task').first.wait_for(timeout=10000)
            # v2.9 Phase B: campaign → content → owner review → manual publish registration.
            page.locator('[data-tab="launch"]').click()
            page.locator('[data-action="new-campaign"]').first.click()
            page.locator('[name="name"]').fill('Browser smoke campaign')
            page.locator('[name="goal"]').fill('Collect real trial feedback for this smoke project only')
            page.locator('[name="channels"]').fill('example-channel')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            page.get_by_text('Browser smoke campaign').first.wait_for(timeout=10000)
            page.locator('[data-action="new-content"]').first.click()
            page.locator('[name="title"]').fill('Browser smoke published note')
            page.locator('[name="channel"]').fill('example-channel')
            page.locator('[name="body"]').fill('Synthetic smoke copy; nothing here is a real customer statement.')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            # Owner review is a native confirm (auto-accepted by the handler above).
            page.locator('[data-action="review-content"]').first.click()
            page.get_by_text('已人工审核').first.wait_for(timeout=10000)
            page.locator('[data-action="publish-content"]').first.click()
            page.locator('[name="url"]').fill('https://example.org/smoke/publication')
            page.locator('#dialog-form button[type="submit"]').click()
            page.locator('#modal-root .modal').wait_for(state='hidden',timeout=10000)
            page.get_by_text('已发布并登记').first.wait_for(timeout=10000)
            # v2.9 Phase C/D surfaces render (growth window totals + review entry point).
            page.locator('[data-tab="growth"]').click()
            page.get_by_text('窗口内合计').first.wait_for(timeout=10000)
            page.locator('[data-tab="review"]').click()
            page.get_by_text('创建周期复盘').first.wait_for(timeout=10000)
            page.locator('[data-nav="brief"]').click()
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
