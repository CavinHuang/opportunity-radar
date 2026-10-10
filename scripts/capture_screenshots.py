"""Reproducible UI capture from real frontend and isolated demo API responses.
Requires playwright + pillow and a Chromium binary; never opens the real app database.
"""
import base64, json, os, shutil, subprocess, tempfile, time, urllib.request
from io import BytesIO
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'docs'/'screenshots'
OUT.mkdir(parents=True,exist_ok=True)
PORT=49177
BASE=f'http://127.0.0.1:{PORT}'

def call(path,body=None,agent=False):
    data=json.dumps(body).encode() if body is not None else None
    headers={'Content-Type':'application/json'}
    if agent: headers['Authorization']='Bearer local-demo-only'
    request=urllib.request.Request(BASE+path,data=data,headers=headers,method='POST' if data else 'GET')
    with urllib.request.urlopen(request,timeout=8) as resp:
        return json.load(resp)

with tempfile.TemporaryDirectory(prefix='radar-screenshot-') as directory:
    env={**os.environ,'RADAR_DB':str(Path(directory)/'demo.sqlite'),'RADAR_PORT':str(PORT),
         'RADAR_HOST':'127.0.0.1','RADAR_AGENT_TOKEN':'local-demo-only'}
    server=subprocess.Popen(['node','src/server.mjs'],cwd=ROOT,env=env,
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(70):
            try:
                call('/api/health')
                break
            except Exception: time.sleep(.12)
        else: raise RuntimeError('demo server did not start')
        opportunity=call('/api/opportunities',{
          'title':'[DEMO] Find follow-ups hidden in screenshots',
          'problem':'[DEMO DATA] Consumers save screenshots as reminders but forget to revisit them.',
          'market':'International / EN','sources':[],
          'risk':'Real customer demand has not been validated'
        })['item']
        call('/api/opportunities',{
          'title':'[DEMO] 家庭保修资料整理',
          'problem':'[演示数据] 购买家电后难以找到保修凭证，仍需真实消费者访谈。',
          'market':'中国大陆','sources':[]
        })
        project=call('/api/experiments',{
          'opportunityId':opportunity['id'],
          'goal':'[DEMO] Validate screenshot-based reminder workflow',
          'hypothesis':'[DEMO] Consumers forget actionable screenshots',
          'criteria':['[DEMO] Complete a single core reminder task'],
          'stopCondition':'Stop after ten hours without useful evidence',
          'hours':10,'cash':0
        })['project']
        call('/api/agent/tools/progress.report',{
          'project_id':project['id'],
          'summary':'[DEMO] Scope reviewed. Preparing a minimal prototype.',
          'idempotency_key':'screenshot-demo-progress'
        },True)
        with sync_playwright() as playwright:
            chrome=shutil.which('chromium') or shutil.which('google-chrome')
            browser=playwright.chromium.launch(**({'executable_path':chrome} if chrome else {}),
                 headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'])
            context=browser.new_context(viewport={'width':1480,'height':950},
                device_scale_factor=1,locale='zh-CN',reduced_motion='reduce')
            page=context.new_page()
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            # Some execution environments block browser-to-localhost navigation.
            # Forward fetch calls into the real local Node HTTP API, rendering
            # the actual frontend JS rather than mocking business data or UI.
            def backend(url,opts=None):
                opts=opts or {}
                body=opts.get('body')
                return {'status':200,'data':call(url if url.startswith('/api/') else '/api'+url,
                    json.loads(body) if isinstance(body,str) else body)}
            page.expose_function('__backendProxy',backend)
            page.set_content((ROOT/'public'/'index.html').read_text())
            page.add_style_tag(content=(ROOT/'public'/'style.css').read_text())
            page.evaluate("""(() => {
              const memory = new Map();
              const storage={getItem:key=>memory.get(key)??null,
                setItem:(key,value)=>memory.set(key,String(value)),
                removeItem:key=>memory.delete(key)};
              Object.defineProperty(window,'localStorage',{configurable:true,value:storage});
              Object.defineProperty(window,'sessionStorage',{configurable:true,value:storage});
              window.fetch=async(url,opts={})=>{
                const result=await window.__backendProxy(url,opts);
                return {ok:result.status>=200&&result.status<400,
                        status:result.status,json:async()=>result.data};
              };
            })()""")
            dictionary=base64.b64encode((ROOT/'public'/'i18n.js').read_bytes()).decode()
            app=(ROOT/'public'/'app.js').read_text()
            app=app.replace("from './i18n.js'",f"from 'data:text/javascript;base64,{dictionary}'")
            page.add_script_tag(type='module',content=app)
            def capture(name):
                pixels=page.screenshot(full_page=True)
                image=Image.open(BytesIO(pixels)).convert('RGB')
                image.thumbnail((1160,940),Image.Resampling.LANCZOS)
                image.save(OUT/f'{name}.webp','WEBP',quality=45,method=6)
            page.locator('.hero-title').wait_for(timeout=15000)
            assert page.get_by_text('机会简报').count()>0
            capture('dashboard-zh')
            page.locator('#locale-switch').select_option('en-US')
            assert 'What is worth your attention today?' in page.locator('h1').inner_text()
            page.locator('[data-nav="project"]').click()
            page.locator('[data-tab="agent"]').click()
            assert page.get_by_text('Agent connection').count()>0
            assert page.get_by_text('Configured',exact=True).count()>0
            capture('agent-setup-en')
            assert not errors,errors
            browser.close()
    finally:
        server.terminate()
        try: server.wait(timeout=5)
        except subprocess.TimeoutExpired: server.kill()
