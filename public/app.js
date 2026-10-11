import { LANGUAGES, LANGUAGE_STORAGE_KEY, initialLanguage, normalizeLanguage, translate, applyLanguage } from './i18n.js';
// Local-first UI. All approval actions are deliberately explicit and user initiated.
const I={radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12 18 6"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',layers:'<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',check:'<path d="m4 12 5 5L20 6"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',spark:'<path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3ZM19 18v4M17 20h4"/>',shield:'<path d="M12 22S4 18 4 11V5l8-3 8 3v6c0 7-8 11-8 11Z"/><path d="m9 12 2 2 4-4"/>',message:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 9 9 0 0 1-8.1 5.2 8.4 8.4 0 0 1-3.8-.9L3 21l1.4-5.2a8.4 8.4 0 0 1-.9-3.8 9 9 0 0 1 5.2-8.1 8.4 8.4 0 0 1 3.8-.9h.5a9 9 0 0 1 8 8v.5Z"/>',book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',chart:'<path d="M3 3v18h18M7 16l4-5 4 3 5-7"/>',file:'<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M13 2v7h7M8 13h8M8 17h8"/>',link:'<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 1 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 1 0 7.1 7.1l1.7-1.7"/>',pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',alert:'<path d="m10.3 3.3-8.2 14a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3l-8.2-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',bot:'<rect x="4" y="7" width="16" height="14" rx="3"/><path d="M12 3v4M8 13h.01M16 13h.01M9 17h6"/>',dollar:'<path d="M12 2v20M17 6H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6"/>',cross:'<path d="M18 6 6 18M6 6l12 12"/>',refresh:'<path d="M20 11a8 8 0 1 0-2.1 5.4M20 4v7h-7"/>',external:'<path d="M14 3h7v7m0-7-9 9"/><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>'};
const icon=(name,size=18)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]||I.layers}</svg>`;
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const locale=()=>S.locale;
const t=x=>translate(x,locale());
const fmtTime=x=>x?new Date(x).toLocaleString(locale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):t('尚未同步');
const S={view:'brief',briefTab:'opportunities',signalStatus:'new',signalQuery:'',signalSourceId:'',signalOffset:0,sources:null,sourceDiagnostics:null,readiness:null,sourceQuality:null,discovery:null,discoveryQuality:null,showDismissedClusters:false,catalog:[],validations:[],tab:'overview',dashboard:null,project:null,history:null,signals:null,opportunities:null,selected:null,agentSetup:null,productFeedback:null,ownerToken:sessionStorage.getItem('radar-owner-token')||'',busy:false,locale:initialLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY),navigator.language)};
async function api(path,opts={}){const r=await fetch('/api'+path,{...opts,headers:{'Content-Type':'application/json',...(S.ownerToken?{'X-Radar-Owner-Key':S.ownerToken}:{}),...opts.headers},body:opts.body===undefined?undefined:JSON.stringify(opts.body)});let v=await r.json();if(r.status===401){const t=window.prompt(translate('请输入你的 Radar Owner Token（仅存储于当前浏览器会话）',locale()));if(t){S.ownerToken=t;sessionStorage.setItem('radar-owner-token',t);return api(path,opts);}}if(!r.ok)throw new Error(v.message||v.error||'请求失败');return v;}
function toast(message,error=false){const wrap=document.getElementById('toast-root');wrap.innerHTML=`<div class="toast ${error?'error':''}">${esc(t(message))}</div>`;applyLanguage(wrap,locale());setTimeout(()=>{wrap.innerHTML=''},3300);}
function wrapPage(title,body){return `<div class="app"><aside class="sidebar"><div class="brand"><div class="brand-logo">${icon('radar',22)}</div><div><div class="brand-name">northstar<span style="color:#65a07f">.</span></div><span class="brand-sub">OPPORTUNITY RADAR</span></div></div><div class="nav-label">WORKSPACE</div><nav class="nav"><button data-nav="brief" class="${S.view==='brief'?'active':''}">${icon('grid',17)}机会简报</button><button data-nav="project" class="${S.view==='project'?'active':''}">${icon('layers',17)}当前主实验</button><button data-nav="history" class="${S.view==='history'?'active':''}">${icon('book',17)}历史与复盘</button></nav><div class="side-note">${icon('spark',16)}<strong style="margin-left:7px">做值得做的事</strong><p>专注真实需求。用最小的实验验证想法，再决定是否投入更多。</p></div><div class="side-bottom"><span class="status-dot"></span> LOCAL-FIRST · v1.8</div></aside><section class="main"><header class="topbar"><span class="breadcrumb">Workspace <span style="padding:0 11px;color:#ccd4cc">/</span> <b>${esc(title)}</b></span><div class="top-right"><label class="language-control" for="locale-switch"><span class="language-mark" aria-hidden="true">🌐</span><span class="sr-only">Language / 语言</span><select id="locale-switch" name="locale" aria-label="Language / 语言">${Object.entries(LANGUAGES).map(([code,label])=>`<option value="${code}" ${S.locale===code?'selected':''}>${label}</option>`).join('')}</select></label><span class="top-pill">个人工作空间</span><div class="avatar">R</div></div></header><main class="content">${body}<footer class="footer"><span>Northstar · 把时间留给真正值得尝试的事</span><span>所有实验结果需以真实证据为准</span></footer></main></section></div>`;}
const empty=(name,desc,action)=>`<div class="empty"><div class="empty-icon">${icon('search',22)}</div><h3>${name}</h3><p>${desc}</p>${action||''}</div>`;
function renderBrief(){const d=S.dashboard||{candidates:[],projects:[],active:null,allCount:0};const items=d.candidates||[];const active=d.active;const firstUse=!active&&d.allCount===0&&!(S.sources?.items||[]).length;
  const hero=`<div class="highlight card"><div><div class="hint">${icon('spark',14)}&nbsp; YOUR WEEKLY FOCUS</div><h2>${active?'先把当前实验做扎实':'每一个好机会，都从真实问题开始。'}</h2><p>${active?'你已有一个正在推进的主实验。先关注下一项关键证据，不因新点子打断已有进展。':'收集消费场景中的真实问题，整理证据、判断契合度，用最小投入决定是否值得实践。没有好机会时，也可以什么都不推荐。'}</p><button class="btn btn-primary" data-action="${active?'go-project':firstUse?'manage-sources':'new-opportunity'}">${active?'查看当前主实验':firstUse?'先配置信息源':'添加第一个机会'} ${icon('arrow',15)}</button></div><div class="highlight-side"><div class="halo">${icon('radar',63)}</div></div></div>`;
  const stats=`<div class="stats"><div class="card stat"><div class="stat-head">${icon('radar',16)} 待关注机会</div><strong>${items.length}</strong><div class="stat-foot">每周最多推送 3 项</div></div><div class="card stat"><div class="stat-head">${icon('layers',16)} 主实验</div><strong>${active?'01':'00'}</strong><div class="stat-foot">同一时间只推进一项</div></div><div class="card stat"><div class="stat-head">${icon('clock',16)} 本周时间基线</div><strong>10<span style="font-size:12px;font-weight:600;margin-left:5px">小时</span></strong><div class="stat-foot">额外投入需证据与批准</div></div></div>`;
  const validationById=new Map((S.validations||[]).map(x=>[x.opportunityId,x]));
  const cards=items.length?items.map(o=>`<article class="card opp"><div class="opp-top"><span class="tag">${icon('radar',12)} 待取证</span><span class="mini-chip">${esc(o.market)}</span></div><h3>${esc(o.title)}</h3><p>${esc(o.problem)}</p><div class="opp-meta"><small>独立线索 ${o.sources?.filter(x=>x.independent).length||0} · ${esc(o.language||'')}</small><button class="link" data-action="show-research" data-id="${o.id}">研究证据 ${icon('arrow',12)}</button><button class="link" data-action="view-validation" data-id="${o.id}">用户验证 ${validationById.get(o.id)?.status==='active'?'· 进行中':validationById.get(o.id)?.outcome?'· 已决策':'· 未开始'}</button></div></article>`).join(''): `<div class="card">${empty('还没有可评估的机会','目前没有录入任何真实线索。你可以先添加一条消费者问题和来源；雷达不会用虚构市场数据填满首页。','<button class="btn btn-sm" data-action="new-opportunity">'+icon('plus',14)+' 添加线索</button>')}</div>`;
  const all=S.opportunities?.items||[];
  const backlog=all.filter(x=>x.status!=='experiment');
  const pool=`<div class="section-heading"><h2>完整机会池</h2><span>${all.length} 项 · 仅前三项出现在本周聚焦</span></div><div class="card card-pad"><div class="source-controls"><p class="subtext">候选按可追溯来源优先呈现。可以观察或放弃，不必为所有想法启动项目。</p></div>${backlog.length?backlog.map(o=>`<div class="source-row"><div class="grow"><strong>${esc(o.title)}</strong><p class="subtext">${esc(o.market)} · ${o.sources.length} 条来源 · ${o.status==='candidate'?'候选':o.status==='watching'?'观察中':'已放弃'}</p><p class="subtext">${esc(o.problem)}</p></div><div class="source-buttons">${o.status!=='candidate'?`<button class="btn btn-sm" data-action="opportunity-status" data-status="candidate" data-id="${o.id}">恢复候选</button>`:''}${o.status==='candidate'?`<button class="btn btn-sm" data-action="opportunity-status" data-status="watching" data-id="${o.id}">继续观察</button>`:''}${o.status!=='dismissed'?`<button class="btn btn-sm" data-action="opportunity-status" data-status="dismissed" data-id="${o.id}">放弃</button>`:''}<button class="btn btn-sm" data-action="show-research" data-id="${o.id}">研究证据</button>${o.status==='candidate'?`<button class="btn btn-sm btn-primary" data-action="view-validation" data-id="${o.id}">用户验证</button><button class="btn btn-sm" data-action="open-opportunity" data-id="${o.id}">启动产品实验</button>`:''}</div></div>`).join(''):empty('机会池还没有其他候选','通过原始信息源添加真实线索。')}</div>`;
  const signals=(S.signals?.items||[]).filter(x=>x.status==='new'||x.status==='saved');const signalsPanel=`<div class="card mini-card"><div class="flex between"><div class="small-title">${icon('search',16)}&nbsp; 公开信号收集</div><button class="btn btn-sm" data-action="scan-signals">${icon('refresh',12)} 扫描</button></div><p class="subtext">${S.signals?.configuredFeedCount?`已启用 ${S.signals.configuredFeedCount} 个 RSS 源`:'尚未添加 RSS 来源，前往信息源管理添加'}。原始信号不能直接当成真实市场需求。</p><button class="btn btn-sm mt" data-action="manage-sources">${icon('layers',13)} 管理信息源与信号</button>${signals.length?signals.slice(0,3).map(item=>`<div class="milestone"><div class="grow"><strong style="font-size:11px">${esc(item.title)}</strong><p class="subtext">${esc(item.description).slice(0,95)}</p><div class="flex"><button class="link" data-action="import-signal" data-id="${item.id}">转为机会线索</button><button class="link" data-action="analyze-signal" data-id="${item.id}">AI 辅助研判</button></div></div></div>`).join(''):''}</div>`;const right=`<div class="right-stack">${signalsPanel}<div class="card mini-card"><div class="small-title">${icon('shield',16)}&nbsp; 雷达的判断原则 <span class="mini-chip">已锁定</span></div><div class="fact-list"><div class="fact-row"><div class="fact-icon">${icon('check',15)}</div><div><strong>证据优先</strong><p>来源、独立性与未知信息分开记录，不生成虚假的机会评分。</p></div></div><div class="fact-row"><div class="fact-icon">${icon('clock',15)}</div><div><strong>精力有限</strong><p>10 小时基线，最多一个主实验；新增预算需要理由。</p></div></div><div class="fact-row"><div class="fact-icon">${icon('message',15)}</div><div><strong>你来决策</strong><p>外部 Agent 可以准备和汇报，项目验收与对外发布由你批准。</p></div></div></div></div><div class="card mini-card"><div class="small-title">${icon('book',16)}&nbsp; 今日备忘</div><p class="subtext mt">${esc(d.note||'没有足够证据时，可以暂不作决定。')}</p><button class="btn btn-sm" data-action="new-opportunity">${icon('plus',13)} 记录新发现</button></div></div>`;
  if(S.briefTab==='sources')return renderSourceHub();
  return wrapPage('机会简报',`<div class="headline"><div><div class="eyebrow">YOUR OPPORTUNITY SPACE</div><h1 class="hero-title">今天，值得关注什么？</h1><p class="hero-desc">少一点信息噪音，多一点确定行动。优先发现真正与你有关、并且有机会被验证的消费者需求。</p></div><button class="btn" data-action="new-opportunity">${icon('plus',15)} 添加机会</button></div><div class="source-toolbar mt"><button data-action="show-opportunities" class="btn btn-sm">${icon('radar',13)} 机会简报</button><button data-action="manage-sources" class="btn btn-sm">${icon('layers',13)} 信息源与信号</button></div><div class="mt">${hero}${stats}</div><div class="grid-main"><div><div class="section-heading"><h2>本周机会</h2><span>最多 3 项 · 非自动推荐数据</span></div><div class="list">${cards}</div></div><div><div class="section-heading"><h2>决策指南</h2><span>聚焦真实结果</span></div>${right}</div></div><div class="mt">${pool}</div>`);}
const stLabel=x=>({'pending':'待验收','accepted':'已验收','rejected':'已退回','not_verified':'待验证','verified':'已核验','execution':'执行中','research':'需求研究','paused':'已暂停','stopped':'已停止'}[x]||x||'未知');
function renderProject(){const p=S.project;if(!p)return wrapPage('当前主实验',`<div class="eyebrow">CURRENT EXPERIMENT</div><h1 class="hero-title">先选定一个值得尝试的方向。</h1><p class="hero-desc">每次只推进一个主实验；Coding Agent 在外部完成研发，平台只关注交付、证据和你需要作出的决定。</p><div class="card mt">${empty('当前没有进行中的实验','从机会简报中选择一个消费者问题，定义可证伪假设、预算和验收标准，再批准开始。','<button class="btn btn-primary" data-nav="brief">查看机会</button>')}</div>`);
  const b=p.baselines.at(-1),accepted=p.milestones.filter(x=>x.acceptanceState==='accepted').length;
  const risk=p.status==='paused'?'项目处于暂停状态。平台不再允许 Agent 写入，外部执行是否停止仍未知。':p.status==='stopped'?'项目已停止。历史成果仍然保留。':p.decisions.some(x=>x.status==='pending')?'有一项 Agent 变更申请等待你决定。':p.submissions.some(x=>x.acceptanceState==='pending')?'有交付待你验收。':'当前无必须处理的决策。';
  const nav=`<div class="tab-strip">${[{k:'overview',n:'项目概览'},{k:'tasks',n:'任务与进度'},{k:'evidence',n:'交付证据'},{k:'launch',n:'内容宣发'},{k:'ledger',n:'结果与复盘'},{k:'agent',n:'Agent 接入'}].map(x=>`<button data-tab="${x.k}" class="${S.tab===x.k?'on':''}">${x.n}</button>`).join('')}</div>`;
  let detail='';
  if(S.tab==='overview')detail=`<section class="card card-pad" style="margin-bottom:18px"><div class="small-title">从选定机会到真实发布</div><p class="subtext">验收进度：${esc(p.pipeline?.progressLabel||'未取得进度')} · 当前基线 r${Number(p.pipeline?.baselineRevision||0)}。Agent 自报执行中不代表完成。</p><div class="source-quality-stats"><div><strong>${Number(p.pipeline?.totalTasks||0)}</strong><small>当前基线任务</small></div><div><strong>${Number(p.pipeline?.pendingAcceptance||0)}</strong><small>待人工验收</small></div><div><strong>${Number(p.pipeline?.contentCounts?.approved||0)}</strong><small>已批准待发布</small></div><div><strong>${Number(p.pipeline?.contentCounts?.published||0)}</strong><small>发布已登记</small></div></div><div class="small-title" style="margin-top:14px">任务执行看板</div><div class="source-quality-stats"><div><strong>${Number(p.pipeline?.taskCounts?.open||0)}</strong><small>待领取</small></div><div><strong>${Number(p.pipeline?.taskCounts?.in_progress||0)}</strong><small>执行中</small></div><div><strong>${Number(p.pipeline?.taskCounts?.rework||0)+Number(p.pipeline?.taskCounts?.blocked||0)}</strong><small>返工 / 阻塞</small></div><div><strong>${Number(p.pipeline?.taskCounts?.submitted||0)}</strong><small>已提交（非验收）</small></div></div><div class="small-title" style="margin-top:14px">下一步与宣发关卡</div><p class="subtext">${p.pipeline?.launchReady?'全部里程碑已验收，允许进入内容发布准备。':'产品里程碑尚未全部验收，宣发只能准备草稿，不视为可发布。'} 已发布条目仅代表人工登记，不代表平台代发。</p><div class="small-title" style="margin-top:14px">建议下一步</div>${p.pipeline?.nextActions?.length?p.pipeline.nextActions.map(x=>`<div class="source-row"><div class="grow"><strong>${esc(x.label)}</strong></div><button class="btn btn-sm" data-pipeline-tab="${esc(x.tab)}">查看</button></div>`).join(''):'<p class="subtext">暂无阻塞事项。请检查真实使用反馈与结果账本。</p>'}</section><div class="flex between"><div class="small-title">批准基线的首个任务</div><button class="btn btn-sm" data-action="prepare-kickoff">准备首个研发任务</button></div><p class="subtext">只有你主动操作，才根据当前基线生成可领取的 Agent 任务。基线变化后旧任务不再作为新版本任务。</p>${p.tasks.filter(x=>x.ownerKickoff).map(x=>`<p class="subtext">${esc(x.title)} · ${esc(x.status)} · 基线 r${x.baselineRevision}</p>`).join('')}<div class="source-tips"><div><strong>批准的研究依据</strong><p>${p.researchBasis?.status==='linked_owner_decision'?`已关联用户批准的验证计划 · ${p.researchBasis.observationCount} 条人工观察，${p.researchBasis.stanceCounts.contradicts} 条反证。决策依据：${esc(p.researchBasis.decisionReason)}`:'没有关联获批准的研究结论，不能声称消费者需求已经成立。'}</p><p>外部 Agent 只能查看去标识化的研究摘要，访谈内容及参与者代号不会传给 Agent。</p></div></div><div class="small-title">${icon('layers',16)}&nbsp; 产品里程碑 <span class="mini-chip">${accepted}/${p.milestones.length} 已验收</span></div><div class="progress-track">${p.milestones.map(m=>`<div class="progress-tick ${m.acceptanceState==='accepted'?'done':''}"></div>`).join('')}</div>${p.milestones.map((m,i)=>`<div class="milestone"><div class="milestone-number ${m.acceptanceState==='accepted'?'done':''}">${m.acceptanceState==='accepted'?icon('check',15):i+1}</div><div class="milestone-details"><strong>${esc(m.title)}</strong><p>执行 ${esc(m.executionState)} · 证据 ${esc(m.evidenceState)} · 验收 ${esc(stLabel(m.acceptanceState))}</p></div></div>`).join('')}<div class="section-heading"><h2>Agent 工作摘要</h2></div>${p.latestAgentReport?`<p class="subtext">${esc(p.latestAgentReport)}</p>`:`<p class="subtext">尚未收到真实 Coding Agent 的进度报告。你需要在外部启动 Agent，并配置独立的 Agent Token。</p>`}<div class="note-box">Agent 上报状态不等于测试通过。里程碑只有在外部证据核验并由你验收后才会标记为完成。</div>`;
  else if(S.tab==='tasks')detail=`<div class="section-heading"><h2>我的任务计划</h2><button class="btn btn-sm" data-action="create-owner-task">添加任务</button></div>
  <div class="card card-pad"><p class="subtext">这里用于人工安排研究、验收与宣发工作；与 Agent 执行租约分开，不自动认定研发交付完成。</p>
  ${(p.ownerTasks||[]).length?p.ownerTasks.map(t=>`<div class="source-row"><div class="grow"><strong>${esc(t.title)}</strong><p class="subtext">${esc(t.description||'无描述')} · ${esc(t.owner||'本人')} · ${esc(t.dueDate||'无截止日期')} · ${esc(({todo:'待办',doing:'进行中',blocked:'阻塞',done:'完成'})[t.state]||t.state)}</p><p class="subtext">前置任务：${(t.dependencies||[]).length?(t.dependencies||[]).map(id=>{const d=p.ownerTasks.find(x=>x.id===id);return esc(d?.title||'已移除任务')+'（'+(d?.state==='done'?'完成':'未完成')+'）';}).join(' → '):'无'} · ${t.dueDate&&t.state!=='done'&&t.dueDate<new Date().toISOString().slice(0,10)?'已逾期':'未逾期或未设期限'}</p></div><div class="flex"><button class="btn btn-sm" data-action="task-history" data-id="${esc(t.id)}">历史</button><button class="btn btn-sm" data-action="edit-owner-task" data-id="${esc(t.id)}">编辑</button></div></div>`).join(''):'<p class="subtext">没有人工规划任务，可添加访谈、测试、审核或宣发待办。</p>'}</div>`;
  if(S.tab==='tasks')detail+=`<div class="section-heading"><h2>当前基线任务</h2><span>仅展示批准基线 r${Number(b.revision)} 下的任务，任务提交并不代表人工验收</span></div>
  <div class="card card-pad">
    <div class="source-quality-stats"><div><strong>${Number(p.pipeline?.taskCounts?.open||0)}</strong><small>待领取</small></div><div><strong>${Number(p.pipeline?.taskCounts?.in_progress||0)}</strong><small>执行中</small></div><div><strong>${Number(p.pipeline?.taskCounts?.rework||0)+Number(p.pipeline?.taskCounts?.blocked||0)}</strong><small>返工/阻塞</small></div><div><strong>${Number(p.pipeline?.taskCounts?.submitted||0)}</strong><small>待核验提交</small></div></div>
    ${p.tasks.filter(t=>!t.baselineRevision||t.baselineRevision===b.revision).length?p.tasks.filter(t=>!t.baselineRevision||t.baselineRevision===b.revision).map(task=>`<div class="source-row"><div class="grow"><div class="flex"><strong>${esc(task.title)}</strong><span class="tag ${['blocked','rework'].includes(task.status)?'tag-warn':'tag-gray'}">${esc(({open:'待领取',in_progress:'执行中',blocked:'已阻塞',rework:'待返工',submitted:'已提交待验收'})[task.status]||task.status)}</span></div><p class="subtext">${esc(task.description||'无任务说明')}</p><p class="subtext">里程碑：${esc(p.milestones.find(m=>m.id===task.milestoneId)?.title||'未知')} · 依赖 ${Number(task.dependencies?.length||0)} 项 · 租约：${task.lease?'存在（不代表外部进程仍在运行）':'无'}</p></div></div>`).join(''):'<p class="subtext">尚未创建执行任务。在项目概览准备首个研发任务，后续由外部 Agent 拆解并执行。</p>'}
  </div><div class="section-heading"><h2>最近 Agent 汇报</h2></div><div class="card card-pad"><p class="subtext">${esc(p.latestAgentReport||'目前还没有收到外部 Agent 的真实进度汇报。')}</p><p class="subtext">上次同步：${fmtTime(p.agentLastSync)}。汇报仅用于参考；最终完成以证据核验和人工验收为准。</p><button class="btn btn-sm" data-pipeline-tab="evidence">前往交付验收</button><button class="btn btn-sm" data-pipeline-tab="agent">Agent 接入说明</button></div>`;
  else if(S.tab==='evidence')detail=`<div class="flex between"><div class="small-title">${icon('file',16)}&nbsp; 交付与核验</div><span class="mini-chip">GitHub exact SHA</span></div><div class="mt">${p.evidence.length?p.evidence.map(e=>`<div class="milestone"><div class="info-icon">${icon(e.verificationState==='verified'?'check':'file',15)}</div><div class="grow"><strong style="font-size:12px">${esc(e.type)}</strong><div class="subtext mono">${esc((e.commitSha||'未知提交').slice(0,40))} · ${esc(e.verificationState)}</div><div class="subtext">${esc(e.verificationReason||'等待核验')}</div><a class="external" href="${esc(e.sourceUri||'#')}" target="_blank" rel="noopener noreferrer">查看来源 ${icon('external',12)}</a></div><button class="btn btn-sm" data-action="${e.type?.startsWith('github')?'verify-evidence':'attest-evidence'}" data-id="${e.id}">${e.type?.startsWith('github')?'GitHub 核验':'人工核查'}</button></div>`).join(''):`${empty('尚无真实交付证据','Coding Agent 提交 GitHub PR、Commit 和检查结果后，才能进入证据核验。')}`}</div><div class="section-heading"><h2>待验收交付</h2></div>${p.submissions.length?p.submissions.map(s=>`<div class="card" style="padding:17px;margin-bottom:10px"><div class="flex between"><strong style="font-size:12px">${esc(s.commitSha?.slice(0,11)||'无提交 SHA')}</strong><span class="tag ${s.acceptanceState==='pending'?'tag-warn':'tag-gray'}">${esc(stLabel(s.acceptanceState))}</span></div><p class="subtext">基线 r${s.baselineRevision} · 条件覆盖 ${esc(s.g2State)} · 证据 ${s.evidenceIds.length} 项</p>${s.acceptanceState==='pending'?`<div class="flex"><button class="btn btn-primary btn-sm" data-action="accept-submission" data-id="${s.id}">正式验收</button><button class="btn btn-sm" data-action="reject-submission" data-id="${s.id}">退回修改</button></div>`:''}</div>`).join(''):'<p class="subtext">尚无待验收交付。</p>'}`;
  else if(S.tab==='launch')detail=`<div class="flex between"><div class="small-title">${icon('send',16)}&nbsp; 个人创作者宣发</div><div class="flex"><button class="btn btn-sm" data-action="generate-content">${icon('spark',13)} AI 起草</button><button class="btn btn-sm" data-action="new-content">${icon('plus',13)} 新建内容包</button></div></div><p class="subtext mt">内容基于已实现能力与真实素材。你亲自审核并在外部渠道发布，系统只记录事实，不会代发。</p><div class="list mt">${p.contents.length?p.contents.map(c=>`<div class="card" style="padding:19px"><div class="flex between"><span class="tag ${c.reviewState==='published'?'':'tag-gray'}">${esc(c.reviewState)}</span><small class="muted">${esc(c.channel)} · v${c.revision}</small></div><h3 style="font-size:14px;margin:12px 0 6px">${esc(c.title)}</h3><p class="subtext">${esc(c.body).slice(0,170)}</p><div class="flex" style="margin-top:12px"><button class="btn btn-sm" data-action="edit-content" data-id="${c.id}">编辑</button>${c.reviewState==='draft'?`<button class="btn btn-sm btn-primary" data-action="review-content" data-id="${c.id}">审核草稿</button>`:''}${c.reviewState==='approved'?`<button class="btn btn-sm btn-primary" data-action="publish-content" data-id="${c.id}">登记手动发布</button>`:''}</div></div>`).join(''):`${empty('还没有宣发内容','当你有已核验的产品事实或真实的需求研究进展，可以先准备一份草稿。')}`}</div>`;
  else if(S.tab==='agent'){
    const a=S.agentSetup||{};
    const serverUrl=location.origin==='null'?'/mcp':`${location.origin}/mcp`;
    const commands=`# Run from the Opportunity Radar repository\\nnpm run mcp:stdio`;
    detail=`<div class="flex between"><div class="small-title">${icon('bot',16)}&nbsp; Agent 接入中心</div><button class="btn btn-sm" data-action="refresh-agent">${icon('refresh',13)} 刷新状态</button></div>
      <p class="subtext mt">让专业 Coding Agent 在外部环境执行。雷达只维护项目目标、执行任务、GitHub 证据与验收，不启动或控制外部进程。</p>
      <div class="agent-metrics">
        <div class="metric"><small>Agent API</small><b class="${a.enabled?'ready':'warn'}">${a.enabled?'已配置':'未配置'}</b></div>
        <div class="metric"><small>任务工具</small><b>${Number(a.toolCount||12)} <span>P0 工具</span></b></div>
        <div class="metric"><small>有效任务租约</small><b>${Number(a.activeLeases||0)}</b></div>
      </div>
      ${a.enabled?'':'<div class="note-box mt">请先在服务端设置 RADAR_AGENT_TOKEN，并重启 Radar 服务。Agent Token 仅由外部 Coding Agent 使用，不会显示在网页里。</div>'}
      <div class="integration-step"><strong>1. 连接外部 Coding Agent</strong><p class="subtext">MCP stdio：从雷达项目目录启动。请自行在 Agent 配置里安全设置独立 Token。</p><pre class="agent-code">${esc(commands)}</pre><button class="btn btn-sm" data-action="copy-agent-stdio">${icon('file',12)} 复制命令</button></div>
      <div class="integration-step"><strong>2. 选择连接方式</strong><p class="subtext">HTTP MCP 地址（仅支持正确协议头和独立 Bearer Token）：</p><pre class="agent-code">${esc(serverUrl)}</pre><button class="btn btn-sm" data-action="copy-agent-endpoint">${icon('link',12)} 复制地址</button></div>
      <div class="integration-step"><strong>3. 提供当前实验 ID</strong><p class="subtext">Agent 可以用此 ID 调用 project.get_context、project.get_next_work、task.claim 等工具，无需读取你的所有实验。</p><pre class="agent-code">${esc(p.id)}</pre><button class="btn btn-sm" data-action="copy-agent-project">${icon('file',12)} 复制实验 ID</button></div>
      <div class="note-box"><strong>外部 Agent 同步可信度：</strong>
        ${a.freshness==='paused'?'项目已暂停，平台撤销了新的执行授权。':
          a.freshness==='stale'?'最后一次报告超过 30 分钟，状态可能已过期，必须先核查外部进程。':
          a.freshness==='recent_report'?'最近有 Agent 自报（不代表 Agent 当前在线）。':
          '尚无 Agent 进度报告；已配置 MCP 不等于外部进程在运行。'}
        <p>待返工 ${Number(a.reworkTasks||0)} · 过期租约 ${Number(a.expiredLeases||0)} · 等待人工验收 ${Number(a.pendingSubmissions||0)} · 被阻塞任务 ${Number(a.blockedTasks||0)}</p>
        <p>旧租约过期后重新领取，需要先核对外部实际工作和副作用。租约有效也无法证明外部进程仍然存在。</p>
      </div>
      <div class="integration-step"><strong>4. 确认同步状态</strong><p class="subtext">${p.agentLastSync?'<span>最近一次已记录的 Agent 汇报：</span>'+esc(fmtTime(p.agentLastSync)):'尚未收到真实 Agent 汇报。配置完成不代表 Agent 正在运行。'}</p><p class="subtext"><span>待领取任务</span> ${Number(a.openTasks||0)} · <span>待决策申请</span> ${Number(a.pendingDecisions||0)}。<span>租约过期不代表外部进程已停止。</span></p></div>
      <div class="integration-step">
        <strong>5. 启动本地专业 Coding Agent（v1.3）</strong>
        <p class="subtext">在 Radar 仓库终端运行。要求目标工程为干净的独立 Git 功能分支，并已安装登录 Codex 或 Claude Code CLI。所有真正的编码执行都需要单独添加 --confirm。</p>
        <pre class="agent-code">npm run agent:pilot -- doctor --project ${esc(p.id)} --workspace /path/to/your-product --provider codex
npm run agent:pilot -- plan --project ${esc(p.id)} --workspace /path/to/your-product</pre>
        <button class="btn btn-sm" data-action="copy-pilot-command">复制接入诊断命令</button><button class="btn btn-sm" data-action="copy-pilot-run">复制受控运行命令</button>
        <p class="subtext">运行默认最长 90 分钟，可用 --timeout-minutes 设置 1–240 分钟；Ctrl+C 会请求取消。仅在本机保存脱敏执行记录（~/.opportunity-radar/runs），可通过 status 查看。执行完成不代表 PR 已提交，仍需人工检查源码、CI 和验收。</p>
      </div>
      <div class="integration-step">
        <strong>6. 查看交付与恢复中断任务（v1.4）</strong>
        <p class="subtext">交付失败或终端关闭后，先查看任务、证据及提交状态。重复提交同一 PR 和 SHA 不会重复生成交付申请。</p>
        <pre class="agent-code">npm run agent:pilot -- status --project ${esc(p.id)}
npm run agent:pilot -- recover --project ${esc(p.id)} --task &lt;TASK_ID&gt; --recovery-note "Checked external process and side effects" --confirm</pre>
        <div class="flex" style="flex-wrap:wrap;gap:8px"><button class="btn btn-sm" data-action="copy-pilot-status">复制状态检查命令</button><button class="btn btn-sm" data-action="copy-pilot-recover">复制人工恢复模板</button></div>
        <p class="subtext">仅在确认旧进程的实际工作、副作用以及租约确已过期后才能恢复；这不会自动终止外部进程。</p>
      </div>
      <div class="note-box">安全边界：Agent 可更新授权内执行任务，但不能修改批准的产品基线、预算或正式验收状态；对外发布仍由你决定。</div>`;
  }
  else if(S.tab==='ledger')detail=`<div class="flex between"><div class="small-title">${icon('chart',16)}&nbsp; 真实结果账本</div><button class="btn btn-sm" data-action="add-ledger">${icon('plus',13)} 记录结果</button></div><div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="card stat"><div class="stat-head">${icon('dollar',14)} 贡献金额</div><strong>¥${Number(p.ledgerSummary.contribution).toFixed(0)}</strong><div class="stat-foot">不含人工与固定成本</div></div><div class="card stat"><div class="stat-head">${icon('clock',14)} 你的时间</div><strong>${p.ledgerSummary.userHours}h</strong><div class="stat-foot">与 Agent 运行分开</div></div><div class="card stat"><div class="stat-head">${icon('bot',14)} Agent 运行</div><strong>${p.ledgerSummary.agentHours}h</strong><div class="stat-foot">单独统计</div></div></div><div class="section-heading"><h2>实际记录</h2><span>预测数据不会计入实际收益</span></div>${p.ledger.length?p.ledger.slice(0,12).map(x=>`<div class="milestone"><div class="info-icon">${icon('file',15)}</div><div class="grow"><strong style="font-size:12px">${esc(x.type)} · ${esc(x.value)} ${esc(x.unit)}</strong><p class="subtext">${esc(x.source)} · ${x.actual?'实际记录':'未核实/估计'} · ${fmtTime(x.at)}</p></div></div>`).join(''):'<p class="subtext">暂无真实消费者反馈或收支记录。</p>'}`;
  if(S.tab==='ledger'){
    const campaigns=p.contents.filter(c=>c.reviewState==='published');
    const campaignReport=`<div class="section-heading"><h2>宣发效果按内容归因</h2><span>仅依据手动登记的实际数据，不代表平台自动统计</span></div>
      ${campaigns.length?campaigns.map(c=>{
        const rows=p.ledger.filter(x=>x.contentId===c.id&&x.actual);
        const total=type=>rows.filter(x=>x.type===type).reduce((a,x)=>a+Number(x.value||0),0);
        return `<div class="source-row"><div class="grow"><strong>${esc(c.title)}</strong><p class="subtext">${esc(c.channel)} · 曝光 ${total('impressions')} · 访问 ${total('visits')} · 试用 ${total('trials')} · 实收 ${total('income')}</p><a class="external" href="${esc(c.publication?.url||'#')}" target="_blank" rel="noopener noreferrer">打开发布记录</a></div></div>`;
      }).join(''):'<p class="subtext">暂无已登记的宣发内容；发布完成后，可将实际效果关联到对应内容。</p>'}`;
    detail+=campaignReport;
    const byChannel=new Map();
    for(const c of campaigns){
      const key=c.publication?.platform||c.channel||'未指定';
      const row=byChannel.get(key)||{name:key,posts:0,impressions:0,visits:0,trials:0,income:0};
      row.posts++;
      for(const x of p.ledger.filter(x=>x.actual&&x.contentId===c.id&&['impressions','visits','trials','income'].includes(x.type)))row[x.type]+=Number(x.value||0);
      byChannel.set(key,row);
    }
    detail+=`<div class="section-heading"><h2>宣发渠道对比</h2><span>按已发布内容关联的实际记录汇总，无记录不能视为零效果</span></div>
      ${[...byChannel.values()].map(r=>`<div class="source-row"><div class="grow"><strong>${esc(r.name)} · ${r.posts} 篇已发布</strong><p class="subtext">登记曝光 ${r.impressions} · 访问 ${r.visits} · 试用 ${r.trials} · 实收 ¥${r.income}</p></div></div>`).join('')||'<p class="subtext">暂无可对比的已发布渠道。</p>'}`;

    const feedback=S.productFeedback||{feedback:[],counts:{},productMilestoneAccepted:false};
    detail+=`<div class="section-heading"><h2>产品真实使用反馈</h2><span>与收入、访问数据分开记录</span></div>
      <div class="flex between"><p class="subtext">已记录 ${feedback.totalRecords||0} 条 · ${feedback.distinctAnonymousRefs||0} 个匿名代号 · 未经独立核验</p>
      <button class="btn btn-sm" data-action="add-product-feedback" ${feedback.productMilestoneAccepted?'':'disabled'}>记录产品使用反馈</button></div>
      ${feedback.productMilestoneAccepted?'':'<div class="note-box">产品交付里程碑尚未由你正式验收，不能登记为“已交付后的使用反馈”。</div>'}
      ${(feedback.feedback||[]).map(x=>`<div class="source-row"><div class="grow"><strong>${esc(x.kind)} · ${esc(x.participantRef)}</strong><p class="subtext" data-i18n-skip>${esc(x.summary)}</p><p class="subtext">用户手动记录 · 未独立核验 · ${fmtTime(x.observedAt)}</p>${x.evidenceUrl?`<a class="external" target="_blank" rel="noopener noreferrer" href="${esc(x.evidenceUrl)}">查看原始凭证</a>`:''}</div></div>`).join('')}`;
  }
  const side=`<div class="right-stack"><div class="card mini-card"><div class="small-title">${icon('shield',16)}&nbsp; 本轮实验契约</div><div class="fact-list"><div class="fact-row"><div class="fact-icon">${icon('search',14)}</div><div><strong>核心假设</strong><p>${esc(b.hypothesis)}</p></div></div><div class="fact-row"><div class="fact-icon">${icon('alert',14)}</div><div><strong>停止条件</strong><p>${esc(b.stopCondition)}</p></div></div><div class="fact-row"><div class="fact-icon">${icon('clock',14)}</div><div><strong>批准预算</strong><p>每周 ${esc(b.budget.weeklyUserHours)} 小时 · 现金 ¥${esc(b.budget.cash)}</p></div></div></div></div><div class="card mini-card"><div class="small-title">${icon('message',16)}&nbsp; 需要关注</div><p class="subtext mt">${esc(risk)}</p>${p.decisions.filter(x=>x.status==='pending').map(x=>`<div class="note-box" style="margin-top:12px"><strong>${esc(x.summary)}</strong><p>${esc(x.impact)}</p><button class="btn btn-sm" data-action="resolve-decision" data-id="${x.id}">处理申请</button></div>`).join('')}<div class="divider"></div><div class="small-title">${icon('refresh',15)}&nbsp; 同步状态</div><p class="subtext">${p.agentLastSync?'最近报告 '+fmtTime(p.agentLastSync):'从未连接外部 Agent'}</p><p class="subtext">租约过期不能证明 Agent 已停止。</p></div><div class="card mini-card"><div class="small-title">项目决策</div><div class="flex mt">${p.status==='paused'?`<button class="btn btn-sm" data-action="resume-project">恢复项目</button>`:p.status==='stopped'?'项目已停止':`<button class="btn btn-sm" data-action="pause-project">${icon('pause',13)} 暂停实验</button><button class="btn btn-sm" data-action="change-budget">调整预算</button><button class="btn btn-sm" data-action="revise-baseline">修订目标</button>`}</div></div></div>`;
  return wrapPage('当前主实验',`<div class="eyebrow">ONE ACTIVE EXPERIMENT · BASELINE R${b.revision}</div><div class="project-head"><div><h1 class="hero-title">${esc(p.name)}</h1><p class="hero-desc">${esc(b.goal)} <span style="margin-left:6px" class="tag">${esc(stLabel(p.status))}</span></p></div><span class="mini-chip">最近同步 ${fmtTime(p.agentLastSync)}</span></div><div class="grid-main mt"><div><div class="card card-pad">${nav}${detail}</div></div><div>${side}</div></div>`);}
function renderSourceHub(){
  const feeds=S.sources?.items||[],data=S.signals||{items:[],counts:{},total:0,offset:0,limit:30};
  const formatStatus=x=>({new:'待处理',saved:'已收藏',dismissed:'已忽略',converted:'已转机会'})[x]||x;
  const qualityMap=new Map((S.sourceQuality?.items||[]).map(x=>[x.feedId,x]));
  const diagnostics=new Map((S.sourceDiagnostics?.items||[]).map(x=>[x.feedId,x]));
  const diagnosticPanel=`<section class="card card-pad"><div class="section-heading"><h2>来源运行诊断</h2><span>基于本地 SQLite 采集事件 · 最近 5 条/来源</span></div>
    ${feeds.length?feeds.map(f=>{
      const d=diagnostics.get(f.id),history=d?.recent||[];
      const state=d?.state==='healthy'?'正常':d?.state==='degraded'?'采集异常':d?.state==='paused'?'已暂停':'等待首次成功';
      const retryButton=d?.state==='degraded'? `<button class="btn btn-sm" data-action="retry-source" data-id="${esc(f.id)}">立即重试</button>`:'';
      return `<details class="source-row"><summary><strong>${esc(f.title)}</strong> · ${esc(state)} · 连续失败 ${Number(d?.consecutiveFailures||0)} 次</summary>
        <p class="subtext">最近检查：${fmtTime(d?.lastCheckedAt)} · 下次尝试：${fmtTime(d?.nextScanAt)} ${retryButton}</p>
        ${d?.lastError?`<p class="subtext">最近错误：${esc(d.lastError)}</p>`:''}
        ${history.length?history.map(h=>`<p class="subtext">#${Number(h.seq)} · ${fmtTime(h.at)} · ${h.kind==='source.scan_succeeded'?'成功（新增 '+Number(h.added||0)+' 条）':h.kind==='source.scan_failed'?'失败（'+esc(h.code||'SOURCE_ERROR')+'）':'跳过（'+esc(h.reason||'source_changed')+'）'}</p>`).join(''):'<p class="subtext">暂无采集审计事件</p>'}
      </details>`;
    }).join(''):'<p class="subtext">暂无订阅的信息源</p>'}
  </section>`;

  const rd=S.readiness||{checks:[],counts:{}};
  const readinessPanel=`<section class='card card-pad readiness-panel'>
  <div class='flex between'><div><strong>首次使用与数据安全</strong><p class='subtext'>先订阅真实信息源，确认至少一次扫描成功，再判断消费者问题。SQLite 数据仍由本机负责保管。</p></div><span class='mini-chip'>本地操作检查</span></div>
  <div class='readiness-grid'>${rd.checks.map(c=>'<div class=\'readiness-check\'><span class=\'readiness-state\'>'+ (c.ok===true?'✓':c.ok===false?'!':'·') +'</span><span>'+esc(c.description)+'</span></div>').join('')}</div>
  <p class='subtext'>已启用 ${rd.counts?.enabledFeeds||0} 个来源 · 成功扫描过 ${rd.counts?.previouslySuccessfulFeeds||0} 个 · 当前异常 ${rd.counts?.failingFeeds||0} 个 · 已保存 ${rd.counts?.publicSignals||0} 条公开信号。</p>
  <div class='readiness-backup'><strong>备份你的研究资料</strong><p class='subtext'>备份是含私人研究内容的未加密 SQLite 文件。请在可信的本地终端运行，保存数据库文件与同名 manifest.json，定期校验。</p>
  <pre class='agent-code'>npm run data -- backup --output ./private-backups/radar-YYYYMMDD.sqlite
npm run data -- verify --input ./private-backups/radar-YYYYMMDD.sqlite</pre>
  <button class='btn btn-sm' data-action='copy-data-backup'>复制今日备份命令</button><p class='subtext'>还原需要应用停机，并使用全新的目标路径；本页面不提供远程数据库下载，也不宣称已有可用备份。</p></div>
  </section>`;
  const qTotal=S.sourceQuality?.overview||{};
  const qualityPanel=`<section class="card card-pad source-quality-panel">
    <div class="flex between"><div><strong>信息源质量反馈</strong><p class="subtext">优先衡量可追溯的消费者经历，而不是抓取数量。所有记录随人工研判实时更新。</p></div><span class="mini-chip">观察数据 · 非商机评分</span></div>
    <div class="source-quality-stats">
      <div><strong>${Number(qTotal.uniqueSignals||0)}</strong><small>去重公开信号</small></div>
      <div><strong>${Number(qTotal.linkedOpportunities||0)}</strong><small>已关联机会</small></div>
      <div><strong>${Number(qTotal.sourcesWithOwnerReviewedFirsthand||0)}</strong><small>含人工核查经历的来源</small></div>
      <div><strong>${Number(qTotal.failingSources||0)}</strong><small>当前采集异常</small></div>
    </div>
    <p class="subtext">同一帖子可被多个来源收录，来源统计不可相加为独立用户；“第一手经历”仅代表人工阅读分类，未验证发帖人身份，也不能证明付费意愿。</p>
  </section>`;
  const clusters=S.discovery?.items||[],cs=S.discovery?.stats||{},dq=S.discoveryQuality||{};
  const discoveryRows=clusters.map(g=>`<div class="discovery-group ${g.state==='dismissed'?'is-dismissed':''}">
    <div class="flex between"><div class="grow"><div class="flex"><strong>${esc(g.representativeTitle)}</strong><span class="tag ${g.domainCount>1?'':'tag-gray'}">${g.domainCount>1?'跨站点候选':'同站点候选'}</span></div><p class="subtext">${g.signalCount} 条不同 URL · ${g.domainCount} 个站点 · 独立消费者数量未知 · ${g.state==='dismissed'?'已人工忽略':g.state==='reviewed_related'?'人工标记待进一步验证':'待人工核查'}</p></div></div>
    <div class="discovery-explain"><span>共同标题词：${esc(g.diagnostics?.sharedTerms?.slice(0,6).join(' · ')||'未知')}</span><span>组内最低标题相似度：${Number(g.diagnostics?.minimumTitleSimilarity||0).toFixed(2)}</span>
    ${g.diagnostics?.possibleRepost?'<span class="discovery-warning">可能转载 / 重复发帖 · 请逐条对照原文</span>':''}</div>
    <div class="discovery-evidence">${g.signals.map(x=>`<div class="discovery-evidence-row"><span class="subtext">${esc(x.domain)}${x.author?' · '+esc(x.author):''}</span><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)} ${icon('external',11)}</a></div>`).join('')}</div>
    <div class="flex discovery-actions"><button class="btn btn-primary btn-sm" data-action="cluster-import" data-id="${esc(g.id)}" ${g.state==='dismissed'?'disabled':''}>从首条建立待验证机会</button><button class="btn btn-sm" data-action="cluster-link" data-id="${esc(g.id)}" ${g.state==='dismissed'?'disabled':''}>批量关联已有机会</button>
      <button class="btn btn-sm" data-action="cluster-confirm" data-id="${esc(g.id)}" ${g.state==='dismissed'||g.state==='reviewed_related'?'disabled':''}>标记为同一问题线索</button>
      <button class="btn btn-sm" data-action="${g.state==='dismissed'?'cluster-restore':'cluster-dismiss'}" data-id="${esc(g.id)}">${g.state==='dismissed'?'恢复候选':'忽略这组'}</button></div>
    ${g.reviewNote?'<p class="subtext">人工研判：'+esc(g.reviewNote)+'</p>':''}
  </div>`).join('');
  const discoveryDesk=`<section class="discovery-desk"><div class="section-heading"><h2>重复问题候选</h2><span>仅标题相似 · 需要人工核查</span><button class="btn btn-sm" data-action="toggle-cluster-history">${S.showDismissedClusters?'仅看待核查':'查看已忽略'}</button></div>
  <div class="card card-pad"><p class="subtext">已检查最近 ${cs.examinedSignals||0} 条信号，找到 ${cs.proposedGroups||0} 组候选；其中 ${cs.withMultipleDomains||0} 组来自多个站点，${cs.dismissedGroups||0} 组已人工忽略。${cs.unexaminedSignals?' 较早的 '+cs.unexaminedSignals+' 条线索尚未参与本次聚合。':''}</p>
  <p class="subtext">仅进行保守的词汇匹配，不使用 AI 补写经历。多个帖子可能是转载、同作者或者不同问题；绝不代表独立消费者或已经证明的需求。</p>
  <div class="discovery-metrics"><span>疑似重复转发 ${dq.possibleReposts||0} 组</span><span>已人工标注 ${dq.currentLabeledGroups||0} 组</span><span>同一问题待验证 ${dq.ownerMarkedRelated||0} 组</span><span>人工排除 ${dq.ownerDismissed||0} 组</span><span>不同问题误报 ${dq.classificationCounts?.different_problem||0} 组</span></div>
  <p class="subtext">这些仅是当前候选窗口的人工判断计数，不是模型准确率、独立用户数量或市场需求指标。</p>
  ${clusters.length?discoveryRows:empty('暂无重复问题候选','继续扫描来源并研判真实原文；只发现一篇帖子时不会生成“重复需求”结论。')}</div></section>`;
  const sourceRows=feeds.map(f=>`<div class="source-row"><div class="grow"><div class="flex"><strong>${esc(f.title)}</strong><span class="tag ${f.enabled?'':'tag-gray'}">${f.enabled?'已启用':'已暂停'}</span></div><a class="external mono" target="_blank" rel="noopener noreferrer" href="${esc(f.url)}">${esc(f.url)}</a><p class="subtext">${esc(f.market||'未指定市场')} · ${f.keywords.length?'关键词：'+esc(f.keywords.join('、')):'全部主题'} · 最近成功：${fmtTime(f.lastSuccessAt)} · 下次扫描：${f.enabled?fmtTime(f.nextScanAt):'已暂停'} · 间隔：${f.intervalMinutes||360} 分钟</p>${qualityMap.get(f.id)?`<div class="source-feedback"><span>收录 ${qualityMap.get(f.id).captured} 条</span><span>收藏 ${qualityMap.get(f.id).counts.saved} · 忽略 ${qualityMap.get(f.id).counts.dismissed}</span><span>关联机会 ${qualityMap.get(f.id).linkedOpportunities}</span><span>人工核查原文 ${qualityMap.get(f.id).reviewedEvidenceUrls}</span><span>归类独立第一手 ${qualityMap.get(f.id).ownerReviewedIndependentFirsthand}</span>${qualityMap.get(f.id).unreviewedLinked?`<span class="source-review-pending">${qualityMap.get(f.id).unreviewedLinked} 条关联证据待核查</span>`:''}</div>`:''}${f.lastError?`<p class="source-error">连续失败 ${Number(f.consecutiveFailures||1)} 次 · 最近错误：${esc(f.lastError)}</p>`:''}</div><div class="source-buttons"><button class="btn btn-sm" data-action="focus-source" data-id="${f.id}">研判该来源</button><button class="btn btn-sm" data-action="scan-source" data-id="${f.id}">${icon('refresh',12)} 扫描</button><button class="btn btn-sm" data-action="edit-source" data-id="${f.id}">编辑</button><button class="btn btn-sm" data-action="toggle-source" data-id="${f.id}">${f.enabled?'暂停':'启用'}</button></div></div>`).join('');
  const catalog=(S.catalog||[]).map(c=>`<div class="source-row"><div class="grow"><strong>${esc(c.title)}</strong><p class="subtext">${esc(c.market)} · ${esc(c.reason)}</p><p class="subtext">${esc(c.caution)} · ${esc(c.verifiedLive?'最近扫描成功':'需在当前网络扫描')}</p></div><button class="btn btn-sm" data-action="install-catalog" data-id="${esc(c.id)}" ${c.installedFeedId?'disabled':''}>${c.installedFeedId?'已订阅':'订阅来源'}</button></div>`).join('');
  const signalRows=data.items.map(x=>`<div class="source-row signal-row"><div class="grow"><div class="flex"><span class="tag ${x.status==='dismissed'?'tag-gray':''}">${formatStatus(x.status)}</span><span class="subtext">${fmtTime(x.publishedAt||x.createdAt)}</span></div><h3>${esc(x.title)}</h3><p class="subtext">${esc(x.description||'暂无文章摘要')}</p><div class="flex"><a class="external" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">查看原始来源 ${icon('external',12)}</a><span class="subtext">${esc(x.author||new URL(x.url).hostname)}</span></div></div><div class="source-buttons">${x.status!=='converted'?`<button class="btn btn-primary btn-sm" data-action="import-signal" data-id="${x.id}">新建机会</button><button class="btn btn-sm" data-action="link-signal" data-id="${x.id}">关联现有机会</button>${x.status!=='saved'?`<button class="btn btn-sm" data-action="triage-signal" data-status="saved" data-id="${x.id}">收藏</button>`:''}${x.status!=='dismissed'?`<button class="btn btn-sm" data-action="triage-signal" data-status="dismissed" data-id="${x.id}">忽略</button>`:''}${x.status!=='new'?`<button class="btn btn-sm" data-action="triage-signal" data-status="new" data-id="${x.id}">恢复</button>`:''}`:`<span class="subtext">已关联机会，不再重复导入</span>`}</div></div>`).join('');
  const statusTabs=['new','saved','dismissed','converted','all'].map(status=>`<button data-action="filter-signals" data-status="${status}" class="${S.signalStatus===status?'active':''}">${status==='all'?'全部':formatStatus(status)} ${status==='all'?Object.values(data.counts||{}).reduce((a,b)=>a+b,0):data.counts?.[status]||0}</button>`).join('');
  const info=`<div class="source-tips">${icon('shield',16)}<div><strong>真实信息源 ≠ 已验证的消费者需求</strong><p>来源文章只是待研判信号。你可以收藏、忽略或进一步取证后转换为机会；雷达保留原始 URL，不会自动生成付费结论。</p></div></div>`;
  return wrapPage('信息源与机会发现',`<div class="eyebrow">SOURCE RESEARCH DESK</div><div class="headline"><div><h1 class="hero-title">把信息，变成值得验证的机会。</h1><p class="hero-desc">订阅可信来源、关注真实场景、筛除噪音。没有足够证据，就继续观察。</p></div><button class="btn" data-action="show-opportunities">${icon('arrow',14)} 返回机会简报</button></div>${info}${readinessPanel}${qualityPanel}${diagnosticPanel}${discoveryDesk}
    <div class="section-heading"><h2>信息源管理</h2><span>已启用 ${S.sources?.health?.enabled||0} · 到期 ${S.sources?.health?.due||0} · 异常 ${S.sources?.health?.failing||0}</span><div class="flex"><button class="btn btn-sm" data-action="add-source">${icon('plus',13)} 添加 RSS</button><button class="btn btn-primary btn-sm" data-action="scan-signals">${icon('refresh',13)} 扫描全部</button></div></div>
    <div class="card card-pad">${feeds.length?sourceRows:empty('还没有订阅信息源','粘贴一个公开 RSS / Atom 的 HTTPS 地址，即可开始从真实内容中发现信号。<br>无须先配置 AI 模型。','<button class="btn btn-primary" data-action="add-source">添加第一个 RSS 来源</button>')}</div>
    <div class="section-heading"><h2>精选公开信息源</h2><span>按需订阅，再通过扫描核验可用性</span></div><div class="card card-pad"><p class="subtext">论坛帖子是可追溯线索，不等于已经验证的消费者需求。</p>${catalog}</div>
    <div class="section-heading"><h2>待研判信号</h2><div class="flex"><span>匹配 ${data.total||0} 项 · ${data.counts?.new||0} 项待处理</span><button class="btn btn-sm" data-action="manual-signal">${icon('plus',13)} 保存网页线索</button></div></div>
    <div class="card card-pad"><div class="source-controls"><div class="subnav">${statusTabs}</div><label class="subtext" for="feed-filter">来源</label><select id="feed-filter"><option value="">全部来源</option>${feeds.map(f=>`<option value="${esc(f.id)}" ${S.signalSourceId===f.id?'selected':''}>${esc(f.title)}</option>`).join('')}</select><form id="search-signals-form" class="signal-search"><input name="q" aria-label="信号关键词" value="${esc(S.signalQuery)}" placeholder="搜索标题或摘要"><button type="submit" class="btn btn-sm">${icon('search',13)} 搜索</button></form></div>${data.items.length?signalRows:empty('此筛选条件下没有信号','可以扫描订阅源、尝试其他筛选或清除搜索关键词。')}
    <div class="flex between mt"><small class="subtext">第 ${Math.floor((data.offset||0)/Math.max(data.limit||30,1))+1} 页 · 每页 ${data.limit||30} 条</small><div class="flex"><button class="btn btn-sm" data-action="previous-signals" ${(data.offset||0)===0?'disabled':''}>上一页</button><button class="btn btn-sm" data-action="next-signals" ${(data.offset||0)+(data.limit||30)>=data.total?'disabled':''}>下一页</button></div></div></div>`);
}
function editSource(feed,seed={}){modal(feed?'编辑信息源':'添加 RSS / Atom 来源',(feed?'':field('url','HTTPS RSS / Atom 地址',{wide:true,required:true,value:seed.url,placeholder:'https://example.org/feed.xml'}))+field('title','来源名称',{wide:true,value:feed?.title||seed.title||'',placeholder:'例如：消费体验讨论'})+field('market','关注市场',{value:feed?.market||seed.market||'',placeholder:'中国大陆 / International'})+field('keywords','关键词筛选（英文逗号分隔；留空收集全部）',{wide:true,type:'textarea',value:feed?.keywords?.join(', ')||seed.keywords||''})+field('intervalMinutes','采集间隔（分钟，15–1440）',{type:'number',min:15,value:feed?.intervalMinutes||360})+`<div class="field wide"><div class="note-box">只收集真实公开文章，关键词是标题和摘要的简单筛选，不自动认定消费者需求。来源只能访问允许的公网 HTTPS 地址。</div></div>`,async d=>{if(feed)await api('/sources/'+feed.id,{method:'PATCH',body:{...d,expected_revision:feed.revision,keywords:d.keywords,intervalMinutes:Number(d.intervalMinutes)}});else await api('/sources',{method:'POST',body:{...d,intervalMinutes:Number(d.intervalMinutes)}});});}
function renderHistory(){const list=S.history?.projects||[];return wrapPage('历史与复盘',`<div class="eyebrow">YOUR EXPERIMENTS</div><h1 class="hero-title">每一次尝试，都应该留下价值。</h1><p class="hero-desc">保存历史项目的决策、成本、真实证据与停止原因。经验可以帮助下一次选择，但不会被当成普适规律。</p><div class="section-heading"><h2>实验历史</h2><span>${list.length} 项记录</span></div><div class="list">${list.length?list.map(p=>`<div class="card history-row"><div><h3>${esc(p.name)}</h3><p>状态 ${esc(stLabel(p.status))} · 基线 r${p.baselines.at(-1).revision} · ${fmtTime(p.createdAt)}</p></div><button class="btn btn-sm" data-action="select-project" data-id="${p.id}">查看 ${icon('arrow',13)}</button></div>`).join(''):`<div class="card">${empty('还没有历史实验','首次批准机会并完成实验后，这里会保留可回溯的项目记录。')}</div>`}</div>`);}
async function refresh(){try{S.dashboard=await api('/dashboard');if(S.view==='project'){const active=S.selected||S.dashboard.active?.id||S.dashboard.projects?.[0]?.id;S.project=active?await api(`/projects/${active}`):null;S.agentSetup=S.project?await api(`/agent/setup?project_id=${encodeURIComponent(active)}`):null;S.productFeedback=S.project?(await api(`/projects/${encodeURIComponent(active)}/feedback`)).result:null;}if(S.view==='history')S.history=await api('/history');if(S.view==='brief'){S.sources=await api('/sources');S.sourceDiagnostics=S.briefTab==='sources'?await api('/sources/diagnostics?limit=5'):null;S.readiness=S.briefTab==='sources'?await api('/operations/readiness'):null;S.sourceQuality=S.briefTab==='sources'?await api('/source-quality'):null;S.discovery=S.briefTab==='sources'?await api('/discovery/clusters'+(S.showDismissedClusters?'?include_dismissed=1':'')):null;S.discoveryQuality=S.briefTab==='sources'?await api('/discovery/quality'):null;S.catalog=(await api('/source-catalog')).items;S.opportunities=await api('/opportunities');S.validations=(await api('/validations/overview')).items;S.signals=await api('/signals?status='+encodeURIComponent(S.briefTab==='sources'?S.signalStatus:'all')+'&limit=30&offset='+encodeURIComponent(S.briefTab==='sources'?S.signalOffset:0)+'&q='+encodeURIComponent(S.briefTab==='sources'?S.signalQuery:'')+'&source_id='+encodeURIComponent(S.briefTab==='sources'?S.signalSourceId:''));}render();}catch(e){toast(e.message,true);}}
function render(){const root=document.getElementById('app');root.innerHTML=S.view==='brief'?renderBrief():S.view==='project'?renderProject():renderHistory();document.documentElement.lang=locale();document.title=locale()==='en-US'?'Northstar · Opportunity Radar':'Northstar · 个人机会雷达';applyLanguage(root,locale());}
function modal(title,fields,submit){const root=document.getElementById('modal-root');root.innerHTML=`<div class="modal-overlay" id="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-header"><h2>${esc(title)}</h2><button type="button" class="modal-close" data-modal-close aria-label="关闭">×</button></div><form id="dialog-form"><div class="form-grid">${fields}</div><div class="modal-actions"><button type="button" class="btn" data-modal-close>取消</button><button class="btn btn-primary" type="submit">确认 ${icon('arrow',13)}</button></div></form></div></div>`;applyLanguage(root,locale());const form=document.getElementById('dialog-form');form.addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));try{S.busy=true;form.querySelector('button[type=submit]').disabled=true;await submit(data);root.innerHTML='';await refresh();toast('操作已保存');}catch(err){toast(err.message,true);form.querySelector('button[type=submit]').disabled=false;}finally{S.busy=false;}});}
const field=(name,label,opts={})=>`<div class="field ${opts.wide?'wide':''}"><label for="f-${name}">${label}</label>${opts.type==='textarea'?`<textarea id="f-${name}" name="${name}" ${opts.required?'required':''} placeholder="${esc(opts.placeholder||'')}">${esc(opts.value||'')}</textarea>`:`<input id="f-${name}" name="${name}" type="${opts.type||'text'}" ${opts.required?'required':''} ${opts.min!==undefined?`min="${opts.min}"`:''} value="${esc(opts.value??'')}" placeholder="${esc(opts.placeholder||'')}"/>`}</div>`;
function newOpportunity(seed={}){modal('记录新的消费者机会',field('title','机会名称',{required:true,wide:true,value:seed.title,placeholder:'例如：家庭重要文件查找'} )+field('problem','消费者具体遇到了什么问题？',{required:true,wide:true,type:'textarea',value:seed.problem,placeholder:'描述真实场景，不要先写解决方案'})+field('market','市场 / 地区',{required:true,value:seed.market||'中国大陆'})+field('audience','目标消费者',{value:seed.audience,placeholder:'例如：需要管理家庭资料的人'})+field('source','可追溯来源 URL（可选）',{wide:true,value:seed.source,placeholder:'https://... 没有来源时标记为未知'})+field('quote','来源摘要（非编造）',{wide:true,type:'textarea',value:seed.quote})+field('advantage','我有什么个人优势？',{wide:true})+field('risk','最可能失败的理由',{wide:true,value:seed.risk})+field('nextAction','下一步最小验证动作',{wide:true,value:seed.nextAction}),async d=>{if(seed.signalId)await api('/signals/'+encodeURIComponent(seed.signalId)+'/import',{method:'POST',body:d});else await api('/opportunities',{method:'POST',body:{...d,sources:d.source?[{url:d.source,quote:d.quote,independent:false}]:[]}});S.briefTab='opportunities';});}
async function showResearch(id){
  const report=(await api('/opportunities/'+encodeURIComponent(id)+'/research')).report;
  const sourceRows=report.evidence.map((x,i)=>`<div class="source-row"><div class="grow"><strong>${esc(x.domain)} · ${x.reviewedAt?'人工核查':'待核查'}</strong><p class="subtext">${esc(x.quote)}</p><a class="external" target="_blank" rel="noopener noreferrer" href="${esc(x.url)}">查看原文</a><p class="subtext">${x.independent&&x.firsthand?'已核查独立第一手经历':'尚未确认为独立第一手经历'}</p></div><button type="button" class="btn btn-sm" data-action="review-source" data-id="${esc(id)}" data-status="${i}">核查来源</button></div>`).join('');
  const caveats=report.caveats.map(x=>`<p class="subtext">· ${esc(x)}</p>`).join('');
  const suggested=(report.relatedCandidates||[]).map(x=>`<p class="subtext"><a target="_blank" rel="noopener noreferrer" href="${esc(x.url)}">${esc(x.title)}</a> · 只是标题相似，尚未关联证据</p>`).join('');
  modal('机会证据研究 · '+report.title,`<div class="field wide"><div class="note-box"><strong>${esc(report.stageDescription)}</strong><p>公开链接 ${report.evidenceCount} · 独立第一手经历 ${report.reviewedIndependentFirsthandCount} · 尚未人工核查 ${report.pendingReviewCount}</p><p>${esc(report.recommendation)}</p></div></div><div class="field wide"><strong>原始证据</strong>${sourceRows||'<p>无来源证据</p>'}</div><div class="field wide"><strong>反证与未知项</strong><p>${esc(report.opposingReason)}</p>${caveats}<p>${esc(report.nextValidation)}</p><strong>可能相关的线索（仅供人工核查）</strong>${suggested}</div>`,async()=>{});
}

function validationPlanForm(o){
 if(!o)throw new Error('请先选择真实消费者机会');
 modal('制定用户验证计划 · '+o.title,
   '<div class="field wide"><div class="note-box">开发前先验证需求，记录可证伪的假设、成功标准、停止条件。计划由你批准，不会启动 Coding Agent 或发布宣传。</div></div>'+
   field('audience','明确的目标消费者',{required:true,wide:true,placeholder:'谁在什么场景遇到问题？'})+
   field('hypothesis','可证伪的用户需求假设',{required:true,wide:true,type:'textarea',placeholder:'怎样的真实行为会反驳这个假设？'})+
   field('researchQuestion','要向真实用户核实什么？',{required:true,wide:true,type:'textarea'})+
   field('channel','联系真实消费者的渠道',{required:true,wide:true,placeholder:'例如公开社区征求自愿访谈'})+
   field('successCriterion','判定有价值的最低证据',{required:true,wide:true,type:'textarea'})+
   field('stopCondition','何时停止或调整研究',{required:true,wide:true,type:'textarea'})+
   field('nextAction','你接下来实际要做的事',{required:true,wide:true,type:'textarea'})+
   field('timeBudgetHours','投入时间上限（小时，≤10）',{type:'number',value:4,min:0})+
   field('cashBudget','现金上限（元）',{type:'number',value:0,min:0}),
   async d=>await api('/opportunities/'+encodeURIComponent(o.id)+'/validation',{method:'POST',body:{...d,timeBudgetHours:Number(d.timeBudgetHours),cashBudget:Number(d.cashBudget)}}));
}
async function showValidation(id){
 const o=(S.opportunities?.items||[]).find(x=>x.id===id);
 if(!o)throw new Error('机会不在当前列表中');
 const r=(await api('/opportunities/'+encodeURIComponent(id)+'/validation')).result;
 const p=r.latestPlan;
 const observations=r.observations.map(x=>
  '<div class="source-row"><div class="grow"><strong>'+esc(x.kind)+' · '+esc(x.stance)+' · '+esc(x.participantRef)+'</strong><p class="subtext" data-i18n-skip>'+esc(x.note)+'</p>'+
  (x.evidenceUrl?'<a class="external" href="'+esc(x.evidenceUrl)+'" target="_blank" rel="noopener noreferrer">查看附带来源</a>':'')+
  '<p class="subtext">由用户记录 · 未独立核实身份或真实性</p></div></div>').join('');
 const decisionList=r.decisions.map(d=>'<p class="subtext">'+esc(d.outcome)+' · '+esc(d.reason)+'</p>').join('');
 const actions=p?.status==='active'
 ?'<div class="flex"><button type="button" class="btn btn-primary btn-sm" data-action="validation-observe" data-id="'+esc(id)+'">记录真实访谈 / 行为</button><button type="button" class="btn btn-sm" data-action="validation-close" data-id="'+esc(id)+'">形成验证决策</button></div>'
 :'<button type="button" class="btn btn-primary btn-sm" data-action="validation-new" data-id="'+esc(id)+'">'+(p?'发起下一轮用户验证':'制定第一份用户验证计划')+'</button>';
 const summary=p?'<strong data-i18n-skip>'+esc(p.hypothesis)+'</strong><p class="subtext">目标人群：'+esc(p.audience)+' · 渠道：'+esc(p.channel)+'</p><p class="subtext">成功标准：'+esc(p.successCriterion)+'</p><p class="subtext">停止条件：'+esc(p.stopCondition)+'</p><p class="subtext">下一步：'+esc(p.nextAction)+'</p><p class="subtext">投入：'+p.timeBudgetHours+' 小时 / ¥'+p.cashBudget+' · 状态：'+(p.status==='active'?'进行中':'已结束')+'</p>':'<p class="subtext">没有用户验证计划。论坛热度不是实际消费者需求证据。</p>';
 const totals='<div class="note-box"><strong>实际验证记录 '+r.observationCount+' 条 · 匿名参与者 '+r.distinctParticipantRefs+' 位</strong><p>支持 '+r.counts.supports+' · 反驳 '+r.counts.contradicts+' · 不确定 '+r.counts.unclear+'</p><p>所有记录由用户手工录入，未独立验证身份或原始事实，不能自动证明付费意愿。</p></div>';
 modal('用户验证 · '+o.title,
 '<div class="field wide">'+summary+'</div><div class="field wide">'+totals+'</div><div class="field wide">'+actions+'</div>'+
 '<div class="field wide"><strong>记录与反例</strong>'+ (observations||'<p class="subtext">尚未记录真实访谈或行为观察。</p>')+'</div>'+
 (decisionList?'<div class="field wide"><strong>历史决策</strong>'+decisionList+'</div>':''),
 async()=>{});
}
async function addValidationObservation(id){
 const r=(await api('/opportunities/'+encodeURIComponent(id)+'/validation')).result;
 if(r.latestPlan?.status!=='active')throw new Error('请先制定并批准用户验证计划');
 const planId=r.latestPlan.id;
 modal('记录真实消费者反馈',
 '<div class="field wide"><div class="note-box">只使用匿名参与者代号，不要填写真实姓名、邮箱、电话或敏感个人信息。保存前确认已获得记录反馈的同意；不能把虚构示例当成真实用户。</div></div>'+
 field('participantRef','匿名参与者代号',{required:true,wide:true,placeholder:'例如 U-01，复访时使用同一代号'})+
 '<div class="field"><label for="val-kind">证据类型</label><select name="kind" id="val-kind"><option value="interview">访谈自述</option><option value="observed_use">亲眼观察使用</option><option value="repeat_use">重复使用记录</option><option value="payment">实际支付记录</option><option value="other">其他</option></select></div>'+
 '<div class="field"><label for="val-stance">该条证据的方向</label><select name="stance" id="val-stance"><option value="unclear">尚不确定</option><option value="supports">支持假设</option><option value="contradicts">反驳假设</option></select></div>'+
 field('note','具体事实、原话与反例',{required:true,wide:true,type:'textarea',placeholder:'记录发生了什么，不要只写“用户觉得不错”'})+
 field('evidenceUrl','可复查来源 URL（可选）',{wide:true,type:'url',placeholder:'https://'})+
 '<div class="field wide"><label><input type="checkbox" name="consentConfirmed" required> 已获得记录反馈所需的同意</label></div>',
 async d=>await api('/opportunities/'+encodeURIComponent(id)+'/validation/'+encodeURIComponent(planId)+'/observations',{method:'POST',body:{...d,consentConfirmed:d.consentConfirmed==='on'}}));
}
async function decideValidation(id){
 const r=(await api('/opportunities/'+encodeURIComponent(id)+'/validation')).result;
 const p=r.latestPlan;
 if(p?.status!=='active')throw new Error('没有进行中的验证计划');
 modal('结束这轮用户验证',
 '<div class="field wide"><div class="note-box">记录 '+r.observationCount+' 条 · 匿名参与者 '+r.distinctParticipantRefs+' 位。正反证据均应考虑；“继续”不是自动批准研发、预算或真实消费者需求成立。</div></div>'+
 '<div class="field wide"><label for="val-outcome">验证后的用户决策</label><select id="val-outcome" name="outcome"><option value="inconclusive">证据不足，仍未知</option><option value="continue">继续验证 / 考虑下一步</option><option value="pivot">调整假设</option><option value="stop">停止投入</option></select></div>'+
 field('reason','决策依据和反对理由',{required:true,wide:true,type:'textarea'})+
 '<div class="field wide"><label><input type="checkbox" name="acknowledgeUncertainty"> 我理解现有观察未经独立事实核验，不代表付费和留存已成立</label></div>',
 async d=>await api('/opportunities/'+encodeURIComponent(id)+'/validation/'+encodeURIComponent(p.id)+'/close',{method:'POST',body:{expected_revision:p.revision,outcome:d.outcome,reason:d.reason,acknowledgeUncertainty:d.acknowledgeUncertainty==='on'}}));
}
function showOpportunity(o){return startExperiment(o);}
async function startExperiment(o){
  const research=(await api('/opportunities/'+encodeURIComponent(o.id)+'/validation')).result;
  const latest=research.latestPlan;
  const approved=latest?.status==='closed'&&latest.outcome==='continue';
  const link=approved?latest.id:null;
  const notice=approved
    ?'将关联你已批准的研究决策（'+research.observationCount+' 条人工观察）；其真实性仍未经独立核验。'
    :'没有可关联的“继续”研究决策。本次实验将标注为未关联用户验证，不能将未经验证的消费者需求写成既定事实。';
  modal('批准最小实验 · '+o.title,
    '<div class="field wide"><div class="note-box">'+esc(notice)+'<p>产品开发仍需你单独批准目标、范围、预算和验收条件。</p></div></div>'+
    field('goal','本轮实验目标',{required:true,wide:true,value:'验证「'+o.title+'」是否为真实消费者提供价值'})+
    field('hypothesis','可证伪的核心假设',{required:true,wide:true,type:'textarea'})+
    field('criteria','产品交付验收标准（每行一条）',{required:true,wide:true,type:'textarea'})+
    field('stopCondition','停止或暂停条件',{required:true,wide:true})+
    field('hours','个人每周时间预算（≤10）',{type:'number',value:10,min:0})+
    field('cash','首轮现金上限（元）',{type:'number',value:0,min:0})+
    field('scope','本轮明确范围',{wide:true,type:'textarea'})+
    field('nonGoals','本轮不做什么',{wide:true,type:'textarea'}),
    async d=>{
      await api('/experiments',{method:'POST',body:{...d,opportunityId:o.id,
        validationPlanId:link,criteria:d.criteria.split('\n').map(x=>x.trim()).filter(Boolean),
        hours:Number(d.hours),cash:Number(d.cash)}});
      S.view='project';S.tab='overview';S.selected=null;
    });
}
function addProductFeedback(){
  const p=S.project,feedback=S.productFeedback;
  if(!feedback?.productMilestoneAccepted)throw new Error('产品尚未正式验收，不能登记为交付后反馈');
  modal('记录真实产品使用反馈',
   '<div class="field wide"><div class="note-box">只有实际发生、获得记录同意的产品使用才可以填入。请使用匿名代号，勿填写姓名、电话或邮箱。每条记录都会被标注为人工填报、未经独立核验。</div></div>'+
   field('participantRef','匿名用户代号',{wide:true,required:true,placeholder:'U-01'})+
   '<div class="field"><label for="usage-kind">反馈类型</label><select id="usage-kind" name="kind"><option value="activation">完成核心任务</option><option value="reuse">再次使用</option><option value="issue">使用障碍</option><option value="request">功能请求</option><option value="other">其他</option></select></div>'+
   field('summary','实际发生的行为或原话',{wide:true,type:'textarea',required:true})+
   field('evidenceUrl','可复核链接（选填）',{wide:true,type:'url',placeholder:'https://'})+
   '<div class="field wide"><label><input type="checkbox" name="consentConfirmed" required/> 已获得记录反馈所需的同意</label></div>',
   async d=>await api('/projects/'+encodeURIComponent(p.id)+'/feedback',{method:'POST',
     body:{...d,consentConfirmed:d.consentConfirmed==='on'}}));
}
function newContent(c){const p=S.project;modal(c?'修改宣发草稿':'创建个人创作者宣发草稿',field('title','文章标题',{required:true,wide:true,value:c?.title})+field('objective','本次唯一目标',{required:true,wide:true,value:c?.objective||'获取目标用户真实试用反馈'})+field('channel','主要传播渠道',{required:true,value:c?.channel||p.channel||'待选择'})+field('body','内容草稿（必须来自真实素材）',{required:true,wide:true,type:'textarea',value:c?.body||'',placeholder:'真实问题 → 已实现的能力 → 限制 → 试用邀请'})+`<div class="field wide"><div class="note-box">系统不会编造你的经历或未经实现的功能。本版先提供可审核的内容管理，不会自动发布到第三方平台。</div></div>`,async d=>{await api(`/projects/${p.id}/contents`,{method:'POST',body:{...d,id:c?.id,expected_revision:c?.revision,claims:c?.claims||[]}});});}
function addLedger(){const p=S.project;modal('记录真实实验结果',`<div class="field"><label>结果类型</label><select name="type"><option value="interest">有效兴趣</option><option value="trials">真实试用</option><option value="activation">完成核心任务</option><option value="reuse">自然周期内再次使用</option><option value="impressions">内容曝光</option><option value="visits">访问</option><option value="income">实收</option><option value="refund">退款</option><option value="transaction_fee">交易费用</option><option value="service_cost">直接服务成本</option><option value="cash_cost">其他现金支出</option><option value="user_hours">个人主动时间</option><option value="agent_hours">Agent 运行时间</option><option value="brand">品牌反馈</option><option value="learning">技术学习</option></select></div>`+field('value','数量 / 金额',{required:true,type:'number',value:0,min:0})+field('unit','单位',{value:'count'})+field('source','实际来源',{wide:true,placeholder:'例如：手动记录 / 平台分析 / 交易凭证'})+field('notes','证据补充',{wide:true,type:'textarea'})+`<div class="field wide"><label>关联已发布内容</label><select name="contentId"><option value="">不关联宣发内容</option>${p.contents.filter(c=>c.reviewState==='published').map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></div><div class="field wide"><label><input type="checkbox" name="actual" value="yes" style="width:auto;margin-right:8px"/>这是已经发生、有证据的实际结果（不包含预测）</label></div>`,async d=>{await api(`/projects/${p.id}/ledger`,{method:'POST',body:{...d,value:Number(d.value),actual:d.actual==='yes'}});});}
function getCurrentContent(id){return S.project.contents.find(x=>x.id===id)};
async function perform(action,id,statusParam){const p=S.project;switch(action){
  case 'show-opportunities':S.briefTab='opportunities';S.signalOffset=0;await refresh();break;
  case 'manage-sources':S.view='brief';S.briefTab='sources';S.signalStatus='new';S.signalOffset=0;await refresh();break;
  case 'focus-source':S.view='brief';S.briefTab='sources';S.signalSourceId=id;S.signalStatus='new';S.signalOffset=0;S.signalQuery='';await refresh();document.getElementById('feed-filter')?.scrollIntoView({block:'center',behavior:'smooth'});break;
  case 'manual-signal':modal('保存公开网页线索',field('url','原始网页 URL',{required:true,wide:true,type:'url',placeholder:'https://example.org/post'})+field('title','原始内容标题',{required:true,wide:true})+field('description','内容摘要（来自真实网页，非 AI 推断）',{required:true,wide:true,type:'textarea'})+field('market','关注市场',{value:'待判断'}),async d=>await api('/signals/manual',{method:'POST',body:d}));break;
  case 'preset-source':{
    const presets={product:{title:'Product Hunt · New products',url:'https://www.producthunt.com/feed',market:'International'},cn:{title:'Google News · 生活需求',url:'https://news.google.com/rss/search?q=%E7%94%9F%E6%B4%BB%20%E7%83%A6%E6%81%BC&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',market:'中国大陆'},en:{title:'Google News · Consumer problems',url:'https://news.google.com/rss/search?q=consumer%20problems&hl=en-US&gl=US&ceid=US:en',market:'International'}};
    if(presets[statusParam])editSource(null,presets[statusParam]);break;
  }
  case 'install-catalog':{const result=await api('/source-catalog/install',{method:'POST',body:{id}});await refresh();toast(result.alreadyInstalled?'来源已存在':'已订阅，请实际扫描检查可用性');break;}
  case 'view-validation':await showValidation(id);break;
  case 'validation-new':validationPlanForm((S.opportunities?.items||[]).find(o=>o.id===id));break;
  case 'validation-observe':await addValidationObservation(id);break;
  case 'validation-close':await decideValidation(id);break;
  case 'show-research':await showResearch(id);break;
  case 'review-source':{
    const report=(await api('/opportunities/'+encodeURIComponent(id)+'/research')).report;
    const selected=report.evidence[Number(statusParam)];
    const opp=(S.opportunities?.items||[]).find(o=>o.id===id);
    if(!selected||!opp)throw new Error('请刷新后重新核查');
    modal('核查来源',`<div class="field wide"><a href="${esc(selected.url)}" rel="noopener noreferrer" target="_blank">${esc(selected.url)}</a><p>${esc(selected.quote)}</p></div><div class="field wide"><label><input type="checkbox" name="reviewed_original" required/> 我已阅读原文</label></div><div class="field wide"><label><input type="checkbox" name="firsthand"/> 确认是当事人的第一手经历</label></div><div class="field wide"><label><input type="checkbox" name="independent"/> 确认与现有消费者描述独立</label></div>`+field('note','核查依据（至少12字）',{required:true,type:'textarea',wide:true,value:selected.reviewNote,placeholder:'请记录原文与独立性判断依据'}),
      async d=>await api('/opportunities/'+encodeURIComponent(id)+'/evidence/review',{method:'POST',body:{expected_revision:opp.revision,source_url:selected.url,reviewed_original:d.reviewed_original==='on',firsthand:d.firsthand==='on',independent:d.independent==='on',note:d.note}}));break;
  }
  case 'copy-data-backup':{
    if(!navigator.clipboard?.writeText){toast('当前浏览器不允许访问剪贴板，请手动复制',true);break;}
    const day=new Date().toISOString().slice(0,10).replaceAll('-','');
    const cmd='npm run data -- backup --output ./private-backups/radar-'+day+'-'+Date.now().toString(36)+'.sqlite';
    await navigator.clipboard.writeText(cmd);toast('已复制到剪贴板');break;
  }
  case 'toggle-cluster-history':S.showDismissedClusters=!S.showDismissedClusters;await refresh();break;
  case 'cluster-import':{
    const g=S.discovery?.items?.find(x=>x.id===id);
    if(!g||g.state==='dismissed')throw new Error('候选组已变化，请刷新');
    const seed=g.signals[0];
    newOpportunity({signalId:seed.id,title:seed.title,problem:seed.description||seed.title,
      market:seed.market||'待判断',source:seed.url,quote:seed.description||'',
      risk:'标题相似不等于独立真实需求，可能是转载或同一作者发帖。',
      nextAction:'逐条阅读原文并确认是否为不同真实消费者经历'});
    break;
  }
  case 'cluster-link':{
    const g=S.discovery?.items?.find(x=>x.id===id);
    if(!g||g.state==='dismissed')throw new Error('候选组已变化，请刷新');
    const choices=(S.opportunities?.items||[]).filter(o=>['candidate','watching','experiment'].includes(o.status));
    if(!choices.length){toast('请先创建一个机会，再关联公开信号',true);break;}
    modal('批量关联原始证据',`<div class="field wide"><label>选择要关联的机会</label><select name="opportunity_id">${choices.map(o=>`<option value="${esc(o.id)}">${esc(o.title)}</option>`).join('')}</select></div>
      <div class="field wide"><div class="note-box">将这组 ${g.signalCount} 条原始 URL 添加为“待人工核查”的证据。词汇相近不证明是独立用户或真实付费需求。</div>
      <label><input type="checkbox" name="acknowledgeUnverified" required/> 我理解这些原文仍需逐条核查</label></div>`,
      async d=>await api('/discovery/clusters/'+encodeURIComponent(g.id)+'/link',{method:'POST',body:{
       opportunity_id:d.opportunity_id,fingerprint:g.fingerprint,acknowledgeUnverified:d.acknowledgeUnverified==='on'}}));break;
  }
  case 'cluster-confirm':{
    const g=S.discovery?.items?.find(x=>x.id===id);
    if(!g||g.state==='dismissed')throw new Error('请刷新候选组');
    modal('标记为同一问题线索',`<div class="note-box">只是人工认为同类问题，仍不代表不同消费者或付费需求。请先阅读原文。</div>`+
      field('reason','人工核查理由（至少10字）',{required:true,wide:true,type:'textarea',
       placeholder:'描述两条原文为什么可能是同一消费者问题，以及仍缺什么证据'}),
      async d=>await api('/discovery/clusters/'+encodeURIComponent(g.id)+'/review',{method:'POST',body:{
       action:'confirm',fingerprint:g.fingerprint,reason:d.reason,expected_revision:g.reviewRevision}}));break;
  }
  case 'cluster-dismiss':{
    const g=S.discovery?.items?.find(x=>x.id===id);
    if(!g)throw new Error('请刷新候选组');
    modal('忽略重复问题候选',`<div class="field wide"><label>误报原因分类</label><select name="classification" required><option value="possible_repost">疑似转载或重复发帖</option><option value="different_problem">实际是不同问题</option><option value="not_consumer_problem">与消费者问题无关</option><option value="other">其他原因</option></select></div>`+field('reason','忽略原因（至少10字）',{required:true,wide:true,type:'textarea',
      placeholder:'例如同一作者多次转载、帖子与消费者问题无关'}),
      async d=>await api('/discovery/clusters/'+encodeURIComponent(g.id)+'/review',{method:'POST',
       body:{action:'dismiss',fingerprint:g.fingerprint,classification:d.classification,reason:d.reason,expected_revision:g.reviewRevision}}));break;
  }
  case 'cluster-restore':{
    const g=S.discovery?.items?.find(x=>x.id===id);
    if(!g)throw new Error('请刷新候选组');
    await api('/discovery/clusters/'+encodeURIComponent(id)+'/review',{method:'POST',
     body:{action:'restore',fingerprint:g.fingerprint,expected_revision:g.reviewRevision}});
    await refresh();break;
  }
  case 'add-source':editSource();break;
  case 'edit-source':editSource(S.sources.items.find(x=>x.id===id));break;
  case 'toggle-source':{const x=S.sources.items.find(x=>x.id===id);await api('/sources/'+id,{method:'PATCH',body:{enabled:!x.enabled,expected_revision:x.revision}});await refresh();break;}
  case 'retry-source':{
    const feed=S.sources?.items?.find(f=>f.id===id);
    if(!feed)throw new Error('来源已不存在，请刷新');
    const r=await api('/sources/'+encodeURIComponent(id)+'/retry',{method:'POST',body:{expected_revision:feed.revision}});
    await refresh();
    toast(r.result.errors.length?'重试已完成，但来源仍存在采集异常':'重试成功，新增 '+r.result.added+' 条信号');
    break;
  }
  case 'scan-source':case 'scan-signals':{const r=await api('/signals/scan',{method:'POST',body:action==='scan-source'?{source_id:id}:{}});await refresh();toast(`已扫描 ${r.result.feeds} 个来源，新增 ${r.result.added} 条未核实信号${r.result.errors.length?'；'+r.result.errors.length+' 个来源失败':''}`);break;}
  case 'filter-signals':S.signalStatus=statusParam||id||S.signalStatus;S.signalOffset=0;await refresh();break;
  case 'previous-signals':S.signalOffset=Math.max(0,S.signalOffset-30);await refresh();break;
  case 'next-signals':S.signalOffset+=30;await refresh();break;
  case 'triage-signal':{const item=S.signals.items.find(x=>x.id===id);const status=statusParam||'saved';await api('/signals/'+id+'/triage',{method:'POST',body:{status,expected_revision:item.revision}});await refresh();break;}
  case 'link-signal':{
    const choices=(S.opportunities?.items||[]).filter(o=>['candidate','watching','experiment'].includes(o.status));
    if(!choices.length){toast('请先创建一个机会，再关联原始信号',true);break;}
    modal('关联到现有机会',`<div class="field wide"><label>选择现有机会</label><select name="opportunity_id">${choices.map(o=>`<option value="${o.id}">${esc(o.title)}</option>`).join('')}</select></div><div class="note-box">关联只增加原始来源记录，不会把这条文章自动认定为独立需求。</div>`,async d=>await api('/signals/'+id+'/link',{method:'POST',body:d}));break;
  }
  case 'opportunity-status':{
    const item=S.opportunities.items.find(x=>x.id===id);
    await api('/opportunities/'+id+'/status',{method:'POST',body:{status:statusParam,expected_revision:item.revision}});
    await refresh();break;
  }
  case 'new-opportunity':newOpportunity();break;case 'import-signal':{const item=S.signals.items.find(x=>x.id===id);newOpportunity({signalId:item.id,title:item.title,problem:item.description,market:item.market||'待判断',source:item.url,quote:item.description});break;}case 'analyze-signal':{const result=await api(`/signals/${id}/analyze`,{method:'POST',body:{locale:locale()}});const r=result.suggestion;newOpportunity({signalId:result.source.id,title:r.title,problem:r.consumer_problem,market:result.source.market||'待判断',source:result.source.url,quote:result.source.description,audience:r.target_consumer,risk:r.strongest_counterargument,nextAction:r.cheapest_validation});toast('AI 提供的只是待核实草稿，请编辑并确认来源');break;}case 'go-project':case 'select-project':S.view='project';S.selected=id||S.dashboard?.active?.id||null;S.tab='overview';await refresh();break;case 'open-opportunity':await showOpportunity((S.opportunities?.items||[]).find(x=>x.id===id));break;
  case 'refresh-agent':await refresh();toast('Agent 状态已更新');break;
  case 'copy-pilot-status':case 'copy-pilot-recover':{
    if(!navigator.clipboard?.writeText){toast('当前浏览器不允许访问剪贴板，请手动复制',true);break;}
    const status='npm run agent:pilot -- status --project '+p.id;
    const recover='npm run agent:pilot -- recover --project '+p.id+' --task <TASK_ID> --recovery-note "Checked external process and side effects" --confirm';
    await navigator.clipboard.writeText(action==='copy-pilot-status'?status:recover);
    toast('已复制到剪贴板');break;
  }
  case 'copy-pilot-run':{
    if(!navigator.clipboard?.writeText){toast('当前浏览器不允许访问剪贴板，请手动复制',true);break;}
    await navigator.clipboard.writeText('npm run agent:pilot -- run --project '+p.id+' --workspace /path/to/your-product --provider codex --timeout-minutes 90 --confirm');
    toast('已复制到剪贴板');break;
  }
  case 'copy-pilot-command':{
    if(!navigator.clipboard?.writeText){toast('当前浏览器不允许访问剪贴板，请手动复制',true);break;}
    await navigator.clipboard.writeText('npm run agent:pilot -- doctor --project '+p.id+' --workspace /path/to/your-product --provider codex');
    toast('已复制到剪贴板');break;
  }
  case 'copy-agent-stdio':case 'copy-agent-endpoint':case 'copy-agent-project':{
    const value=action==='copy-agent-stdio'?'npm run mcp:stdio':action==='copy-agent-endpoint'?(location.origin==='null'?'/mcp':`${location.origin}/mcp`):p?.id;
    if(!navigator.clipboard?.writeText){toast('当前浏览器不允许访问剪贴板，请手动复制',true);break;}
    await navigator.clipboard.writeText(value);toast('已复制到剪贴板');break;
  }
  case 'task-history':{
    const rows=(await api('/projects/'+encodeURIComponent(p.id)+'/owner-tasks/'+encodeURIComponent(id)+'/history')).items;
    modal('任务变更历史',`<div class="field wide">${rows.length?rows.map(e=>`<p class="subtext">${fmtTime(e.created_at)} · ${esc(e.kind)} · ${esc(e.detail?.previousState||'首次创建')} → ${esc(e.detail?.state||'未知')}</p>`).join(''):'暂无任务变更记录'}</div>`,async()=>{});
    break;
  }
  case 'create-owner-task':case 'edit-owner-task':{
    const current=action==='edit-owner-task'?(p.ownerTasks||[]).find(x=>x.id===id):null;
    const states='<option value="todo">待办</option><option value="doing">进行中</option><option value="blocked">阻塞</option><option value="done">完成</option>';
    modal(current?'编辑人工任务':'添加人工任务',
      field('title','任务名称',{required:true,wide:true,value:current?.title||''})+
      field('description','任务说明',{type:'textarea',wide:true,value:current?.description||''})+
      field('owner','负责人',{value:current?.owner||'本人'})+
      field('dueDate','截止日期',{type:'date',value:current?.dueDate||''})+'<div class="field wide"><label for="f-dependencies">前置任务</label><select id="f-dependencies" multiple size="3">'+(p.ownerTasks||[]).filter(t=>t.id!==current?.id).map(t=>'<option value="'+esc(t.id)+'" '+((current?.dependencies||[]).includes(t.id)?'selected':'')+'>'+esc(t.title)+'</option>').join('')+'</select><small>按 Ctrl / Command 多选，完成前置任务后才能标记完成</small></div>'+
      '<div class="field"><label for="f-state">任务状态</label><select id="f-state" name="state">'+states+'</select></div>',
      async data=>await api('/projects/'+encodeURIComponent(p.id)+'/owner-tasks',{method:'POST',body:{...data,dependencies:JSON.parse(data.dependencies||'[]'),dueDate:data.dueDate||null,...(current?{id:current.id,expected_revision:current.revision}:{})}}));
    const depSelect=document.getElementById('f-dependencies');if(depSelect){const hidden=document.createElement('input');hidden.name='dependencies';hidden.type='hidden';const sync=()=>{hidden.value=JSON.stringify([...depSelect.selectedOptions].map(x=>x.value));};depSelect.addEventListener('change',sync);sync();depSelect.after(hidden);}const select=document.getElementById('f-state');if(select)select.value=current?.state||'todo';
    break;
  }
  case 'new-content':newContent();break;case 'generate-content':{const r=await api(`/projects/${p.id}/contents/generate`,{method:'POST',body:{objective:'邀请目标消费者提供真实反馈',channel:p.channel||'待选择',audience:p.opportunity?.audience||'目标消费者',locale:locale()}});newContent({title:r.draft.title,body:r.draft.body,objective:'邀请目标消费者提供真实反馈',channel:p.channel||'待选择',claims:[]});toast('AI 草稿已生成，发布前请逐句检查事实。'+(r.draft.researchOnly?'当前产品仍未通过验收，只能描述为调研中。':''));break;}case 'edit-content':newContent(getCurrentContent(id));break;case 'add-ledger':addLedger();break;case 'add-product-feedback':addProductFeedback();break;case 'prepare-kickoff':if(!window.confirm(t('根据当前已批准的产品基线生成可领取的首个研发任务？这不会启动外部 Agent。')))break;await api('/projects/'+encodeURIComponent(p.id)+'/kickoff',{method:'POST',body:{}});await refresh();toast('已准备首个可领取任务');break;
  case 'attest-evidence':modal('人工确认外部证据',`<div class="field wide"><div class="note-box">只适用于你亲自打开和核查的非 GitHub 来源。这会被标注为“用户人工核查”，不是自动验证。对虚假来源不要批准。</div></div>`+field('reason','具体如何核查？（至少8个字）',{wide:true,required:true,type:'textarea'}),async d=>await api(`/projects/${p.id}/evidence/${id}/attest`,{method:'POST',body:d}));break;case 'verify-evidence':await api(`/projects/${p.id}/evidence/${id}/verify`,{method:'POST',body:{}});await refresh();toast('已执行真实来源核验，请查看状态');break;
  case 'review-content':if(!window.confirm(t('确认本内容的所有陈述真实可核实、素材拥有使用权限且不存在需遮盖的隐私信息？')))return;await api(`/projects/${p.id}/contents/${id}/review`,{method:'POST',body:{action:'approve',factsChecked:true,privacyChecked:true}});await refresh();toast('已批准确切内容版本');break;
  case 'publish-content':modal('登记你已手动发布的内容',field('url','实际发布链接',{required:true,wide:true,type:'url',placeholder:'https://...'})+field('platform','发布平台',{required:true,value:getCurrentContent(id).channel}),async d=>await api(`/projects/${p.id}/contents/${id}/review`,{method:'POST',body:{action:'publish_record',...d}}));break;
  case 'accept-submission':case 'reject-submission':modal(action==='accept-submission'?'正式产品验收':'退回交付',`<div class="field wide"><div class="note-box">请检查原型和实际提交版本。只有当前版本的有效 GitHub 证据及验收项覆盖完整，系统才允许正式通过。</div></div>`+field('reason','验收说明 / 退回原因',{required:true,wide:true,type:'textarea'}),async d=>await api(`/projects/${p.id}/decide`,{method:'POST',body:{action:action==='accept-submission'?'accept':'reject',submissionId:id,reason:d.reason}}));break;
  case 'pause-project':case 'resume-project':if(!window.confirm(t(action==='pause-project'?'确定暂停项目？平台停止授予新工作，但无法保证外部进程已经停机。':'确定恢复项目？恢复前需要重新核验外部状态。')))return;await api(`/projects/${p.id}/decide`,{method:'POST',body:{action:action==='pause-project'?'pause':'resume',reason:'用户主动操作'}});await refresh();break;
  case 'revise-baseline':{const b=p.baselines.at(-1);modal('修订产品基线（生成新版本）',field('goal','正式产品目标',{required:true,wide:true,value:b.goal})+field('criteria','验收标准（每行一条）',{required:true,wide:true,type:'textarea',value:b.criteria.map(x=>x.text).join('\n')})+field('scope','批准范围',{wide:true,type:'textarea',value:b.scope})+field('nonGoals','本轮不做',{wide:true,type:'textarea',value:b.nonGoals})+field('stopCondition','停止条件',{required:true,wide:true,value:b.stopCondition})+field('reason','为什么需要这次变更？',{required:true,wide:true,type:'textarea'}),async d=>await api(`/projects/${p.id}/decide`,{method:'POST',body:{action:'revise_baseline',...d,criteria:d.criteria.split('\n').filter(Boolean)}}));break;}case 'change-budget':modal('申请追加个人时间预算',field('hours','每周总投入（上限20小时）',{required:true,type:'number',min:0,value:12})+field('newEvidence','支持追加投入的新证据',{required:true,wide:true,type:'textarea'}),async d=>await api(`/projects/${p.id}/decide`,{method:'POST',body:{action:'approve_budget',hours:Number(d.hours),newEvidence:d.newEvidence}}));break;
  case 'resolve-decision':modal('审批 Agent 的变更申请',`<div class="field wide"><label>处理结果</label><select name="resolution"><option value="rejected">拒绝</option><option value="approved">同意申请（实际基线仍须单独批准）</option></select></div>`+field('reason','审批理由',{required:true,wide:true,type:'textarea'}),async d=>await api(`/projects/${p.id}/decide`,{method:'POST',body:{action:'resolve_request',requestId:id,...d}}));break;
}}
document.addEventListener('change',e=>{if(e.target.id==='feed-filter'){S.signalSourceId=e.target.value;S.signalOffset=0;void refresh();return;}if(e.target.id!=='locale-switch')return;const next=normalizeLanguage(e.target.value);if(next===S.locale)return;S.locale=next;localStorage.setItem(LANGUAGE_STORAGE_KEY,next);document.getElementById('modal-root').replaceChildren();document.getElementById('toast-root').replaceChildren();render();});
document.addEventListener('submit',async e=>{if(e.target?.id==='search-signals-form'){e.preventDefault();S.signalQuery=String(new FormData(e.target).get('q')||'').trim();S.signalOffset=0;await refresh();}});
document.addEventListener('click',async e=>{const close=e.target.closest('[data-modal-close]');if(close){document.getElementById('modal-root').innerHTML='';return;}if(e.target.id==='modal-bg'){document.getElementById('modal-root').innerHTML='';return;}const nav=e.target.closest('[data-nav]');if(nav){S.view=nav.dataset.nav;S.tab='overview';S.selected=null;await refresh();return;}const tab=e.target.closest('[data-tab],[data-pipeline-tab]');if(tab){S.tab=tab.dataset.pipelineTab||tab.dataset.tab;render();return;}const a=e.target.closest('[data-action]');if(a){try{await perform(a.dataset.action,a.dataset.id||a.dataset.status||a.dataset.preset,a.dataset.status||a.dataset.preset);}catch(err){toast(err.message,true);}}});
refresh();
