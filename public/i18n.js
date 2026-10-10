// Browser i18n: explicit UI-copy catalog. Stored customer/experiment content is never translated.
// Add another locale by expanding COPY and LANGUAGES; business values are left unchanged.
export const LANGUAGES = Object.freeze({ 'zh-CN': '简体中文', 'en-US': 'English' });
export const LANGUAGE_STORAGE_KEY = 'radar-locale';

const en = {
 '语言':'Language','Language / 语言':'Language','主实验':'Main experiment', 'Northstar · 把时间留给真正值得尝试的事':'Northstar · Make time for ideas worth testing',
 '尚未配置 RSS 来源；在 .env 中设置 RADAR_FEED_URLS。原始信号不能直接当成真实市场需求。':'No RSS feeds configured. Set RADAR_FEED_URLS in .env. Raw signals are not proof of consumer demand.',
 '尚未同步':'Not synced yet', '请输入你的 Radar Owner Token（仅存储于当前浏览器会话）':'Enter your Radar Owner Token (stored only for this browser session)', '请求失败':'Request failed',
 '机会简报':'Opportunity brief','当前主实验':'Current experiment','历史与复盘':'History & review', '做值得做的事':'Build what matters',
 '专注真实需求。用最小的实验验证想法，再决定是否投入更多。':'Focus on real customer needs. Validate an idea through the smallest experiment before investing more.',
 '个人工作空间':'Personal workspace', '把时间留给真正值得尝试的事':'Save time for ideas worth testing', '所有实验结果需以真实证据为准':'All results require real evidence',
 '先把当前实验做扎实':'Focus on your current experiment', '每一个好机会，都从真实问题开始。':'Every good opportunity starts with a real problem.',
 '你已有一个正在推进的主实验。先关注下一项关键证据，不因新点子打断已有进展。':'You already have an active experiment. Gather the next critical piece of evidence before switching to another idea.',
 '收集消费场景中的真实问题，整理证据、判断契合度，用最小投入决定是否值得实践。没有好机会时，也可以什么都不推荐。':'Find genuine consumer problems, evaluate the evidence and your fit, then make the smallest possible bet. Recommending nothing is also valid.',
 '查看当前主实验':'View current experiment','添加第一个机会':'Add your first opportunity','待关注机会':'Opportunities to review',
 '同一时间只推进一项':'Only one active experiment','本周时间基线':'Weekly time baseline', '小时':'hours','额外投入需证据与批准':'Extra time needs evidence and approval',
 '待取证':'Needs evidence','查看判断':'Review opportunity','还没有可评估的机会':'No opportunities to assess yet',
 '目前没有录入任何真实线索。你可以先添加一条消费者问题和来源；雷达不会用虚构市场数据填满首页。':'No real signals recorded yet. Add a consumer problem and its source; the radar will not fill this page with invented market data.',
 '添加线索':'Add signal','公开信号收集':'Public signal collection','扫描':'Scan',
 '尚未配置 RSS 来源；在 .env 中设置 RADAR_FEED_URLS':'No RSS feeds configured. Set RADAR_FEED_URLS in .env',
 '原始信号不能直接当成真实市场需求。':'A signal is not proof of real market demand.',
 '转为机会线索':'Save as opportunity','AI 辅助研判':'AI-assisted review','雷达的判断原则':'Decision principles','已锁定':'Locked',
 '证据优先':'Evidence first','来源、独立性与未知信息分开记录，不生成虚假的机会评分。':'Track sources, independence and unknowns separately; do not manufacture precise opportunity scores.',
 '精力有限':'Time is limited','10 小时基线，最多一个主实验；新增预算需要理由。':'10-hour baseline and one experiment at a time; extra spending requires justification.',
 '你来决策':'You decide','外部 Agent 可以准备和汇报，项目验收与对外发布由你批准。':'External Agents prepare and report; you approve acceptance and publishing.',
 '今日备忘':'Today’s note','没有足够证据时，可以暂不作决定。':'Not enough evidence? You can defer the decision.','记录新发现':'Capture a signal',
 '今天，值得关注什么？':'What is worth your attention today?',
 '少一点信息噪音，多一点确定行动。优先发现真正与你有关、并且有机会被验证的消费者需求。':'Less noise, clearer next steps. Discover consumer needs that fit your strengths and can be validated.',
 '添加机会':'Add opportunity','本周机会':'This week’s opportunities','最多 3 项 · 非自动推荐数据':'Up to 3 · Not automated recommendations','决策指南':'Decision guide','聚焦真实结果':'Focus on real outcomes',
 '待验收':'Pending review','已验收':'Accepted','已退回':'Returned','待验证':'Unverified','已核验':'Verified','执行中':'In progress','需求研究':'Customer research',
 '已暂停':'Paused','已停止':'Stopped','未知':'Unknown','先选定一个值得尝试的方向。':'Start with an opportunity worth testing.',
 '每次只推进一个主实验；Coding Agent 在外部完成研发，平台只关注交付、证据和你需要作出的决定。':'Run only one main experiment. Coding Agents build externally; this workspace tracks deliverables, evidence, and decisions.',
 '当前没有进行中的实验':'No active experiment','从机会简报中选择一个消费者问题，定义可证伪假设、预算和验收标准，再批准开始。':'Choose a customer problem, define a falsifiable hypothesis, budget, and acceptance criteria before starting.',
 '查看机会':'View opportunities','项目处于暂停状态。平台不再允许 Agent 写入，外部执行是否停止仍未知。':'The project is paused. Agent writes are blocked, but external execution may still be running.',
 '项目已停止。历史成果仍然保留。':'The project has stopped. Its history is preserved.','有一项 Agent 变更申请等待你决定。':'An Agent change request needs your decision.',
 '有交付待你验收。':'A deliverable needs your review.','当前无必须处理的决策。':'Nothing currently requires your decision.',
 '项目概览':'Overview','交付证据':'Delivery evidence','内容宣发':'Promotion','结果与复盘':'Results & review','产品里程碑':'Product milestones',
 '已验收':'Accepted','执行':'Execution','证据':'Evidence','验收':'Acceptance','Agent 工作摘要':'Agent activity',
 '尚未收到真实 Coding Agent 的进度报告。你需要在外部启动 Agent，并配置独立的 Agent Token。':'No real Coding Agent reports yet. Launch an Agent externally and configure its separate Agent Token.',
 'Agent 上报状态不等于测试通过。里程碑只有在外部证据核验并由你验收后才会标记为完成。':'An Agent report is not a passing test. Milestones are complete only after independent verification and your acceptance.',
 '交付与核验':'Delivery & verification','未知提交':'Unknown commit','等待核验':'Awaiting verification','查看来源':'Open source','核验':'Verify','人工核查':'Manual review',
 'GitHub 核验':'Verify on GitHub','尚无真实交付证据':'No genuine delivery evidence yet',
 'Coding Agent 提交 GitHub PR、Commit 和检查结果后，才能进入证据核验。':'Coding Agents must provide a GitHub PR, commit, and checks before evidence verification.',
 '待验收交付':'Deliverables awaiting approval','无提交 SHA':'No commit SHA','尚无待验收交付。':'No deliverables awaiting review.',
 '正式验收':'Accept delivery','退回修改':'Request changes','个人创作者宣发':'Creator promotion','AI 起草':'AI draft','新建内容包':'New content package',
 '内容基于已实现能力与真实素材。你亲自审核并在外部渠道发布，系统只记录事实，不会代发。':'Use only genuine product features and real materials. You review and publish externally; this app only records the facts.',
 '编辑':'Edit','审核草稿':'Review draft','登记手动发布':'Record publication','还没有宣发内容':'No promotional content yet',
 '当你有已核验的产品事实或真实的需求研究进展，可以先准备一份草稿。':'Create a draft once you have verified product facts or genuine customer research.',
 '真实结果账本':'Outcome ledger','记录结果':'Record outcome','贡献金额':'Contribution','不含人工与固定成本':'Excludes labor and fixed costs',
 '你的时间':'Your time','与 Agent 运行分开':'Separate from Agent run time','Agent 运行':'Agent run time','单独统计':'Tracked separately',
 '实际记录':'Actual records','预测数据不会计入实际收益':'Forecasts are excluded from actual returns','未核实/估计':'Unverified / estimate',
 '暂无真实消费者反馈或收支记录。':'No actual customer feedback or financial records yet.','本轮实验契约':'Experiment agreement',
 '核心假设':'Core hypothesis','停止条件':'Stop conditions','批准预算':'Approved budget','需要关注':'Needs attention','处理申请':'Resolve request',
 '同步状态':'Sync status','最近报告':'Latest report','从未连接外部 Agent':'No external Agent connected','租约过期不能证明 Agent 已停止。':'An expired lease does not prove the Agent stopped.',
 '项目决策':'Project decisions','恢复项目':'Resume project','暂停实验':'Pause experiment','调整预算':'Adjust budget','修订目标':'Revise goal','最近同步':'Last sync',
 '每一次尝试，都应该留下价值。':'Every experiment should leave something valuable.',
 '保存历史项目的决策、成本、真实证据与停止原因。经验可以帮助下一次选择，但不会被当成普适规律。':'Keep project decisions, actual costs, evidence, and reasons for stopping. Reuse insights without mistaking them for universal truths.',
 '实验历史':'Experiment history','查看':'View','还没有历史实验':'No experiment history yet','首次批准机会并完成实验后，这里会保留可回溯的项目记录。':'Approved experiments and their results will appear here.',
 '关闭':'Close','取消':'Cancel','确认':'Confirm','操作已保存':'Changes saved',
 '记录新的消费者机会':'Record a consumer opportunity','机会名称':'Opportunity name','例如：家庭重要文件查找':'e.g. Finding important family documents',
 '消费者具体遇到了什么问题？':'What problem do consumers actually face?','描述真实场景，不要先写解决方案':'Describe the real situation, not the solution',
 '市场 / 地区':'Market / region','中国大陆':'Mainland China','目标消费者':'Target consumers','例如：需要管理家庭资料的人':'e.g. People organizing family records',
 '可追溯来源 URL（可选）':'Traceable source URL (optional)','https://... 没有来源时标记为未知':'https://... If no source exists, mark as unknown',
 '来源摘要（非编造）':'Source summary (no fabrication)','我有什么个人优势？':'What is my unique advantage?','最可能失败的理由':'Strongest counterargument','下一步最小验证动作':'Cheapest next validation step',
 '批准最小实验':'Approve minimum experiment','真实来源：':'Real sources:','条（尚未核验）':' (unverified)','反对理由：':'Counterargument:','最低成本取证：':'Cheapest evidence:','本轮实验目标':'Experiment goal',
 '可证伪的核心假设':'Falsifiable hypothesis','假设什么用户会在什么场景需要它？':'Which consumers would need this, and when?',
 '产品交付验收标准（每行一条）':'Product acceptance criteria (one per line)','例如：用户可以完成一次关键任务':'e.g. A consumer can complete one core task',
 '停止或暂停条件':'Stopping or pause conditions','预算耗尽或没有新增有效证据时暂停':'Pause if the budget runs out or no new evidence emerges',
 '个人每周时间预算（≤10）':'Weekly personal time budget (≤10)','首轮现金上限（元）':'Initial cash budget (CNY)','本轮明确范围':'In scope','本轮不做什么':'Out of scope',
 '修改宣发草稿':'Edit promotional draft','创建个人创作者宣发草稿':'Create creator promotion draft','文章标题':'Article title',
 '本次唯一目标':'Single goal of this post','获取目标用户真实试用反馈':'Get genuine feedback from target users','主要传播渠道':'Primary channel','待选择':'To be selected',
 '内容草稿（必须来自真实素材）':'Content draft (based on real evidence)','真实问题 → 已实现的能力 → 限制 → 试用邀请':'Real problem → Actual features → Limits → Trial invitation',
 '系统不会编造你的经历或未经实现的功能。本版先提供可审核的内容管理，不会自动发布到第三方平台。':'Never invent first-hand experience or unbuilt features. This version supports reviewable drafts, not automatic posting.',
 '记录真实实验结果':'Record actual experiment results','结果类型':'Outcome type','有效兴趣':'Qualified interest','真实试用':'Actual trials',
 '完成核心任务':'Core task completed','自然周期内再次使用':'Reused on next natural occasion','内容曝光':'Content impressions','访问':'Visits',
 '实收':'Money received','退款':'Refund','交易费用':'Transaction fees','直接服务成本':'Direct service costs','其他现金支出':'Other cash costs',
 '个人主动时间':'Personal active hours','Agent 运行时间':'Agent run hours','品牌反馈':'Brand feedback','技术学习':'Technical learning',
 '数量 / 金额':'Quantity / amount','单位':'Unit','实际来源':'Actual source','例如：手动记录 / 平台分析 / 交易凭证':'e.g. Manual record / analytics / receipt',
 '证据补充':'Supporting evidence','这是已经发生、有证据的实际结果（不包含预测）':'This is an actual outcome with evidence (not a forecast)',
 '请先配置 RADAR_FEED_URLS':'Configure RADAR_FEED_URLS first','AI 提供的只是待核实草稿，请编辑并确认来源':'AI produced an unverified draft. Edit it and check its source.',
 '邀请目标消费者提供真实反馈':'Invite target consumers to provide real feedback',
 'AI 草稿已生成，发布前请逐句检查事实。':'AI draft created. Check every factual claim before publishing.',
 '当前产品仍未通过验收，只能描述为调研中。':'The product has not been accepted yet; describe it as research only.',
 '人工确认外部证据':'Manually attest external evidence',
 '只适用于你亲自打开和核查的非 GitHub 来源。这会被标注为“用户人工核查”，不是自动验证。对虚假来源不要批准。':'Only for non-GitHub sources that you personally opened and checked. This is labeled as user attestation, not automatic verification. Never approve false sources.',
 '具体如何核查？（至少8个字）':'How did you verify it? (at least 8 characters)',
 '已执行真实来源核验，请查看状态':'External verification requested. Check its status.',
 '确认本内容的所有陈述真实可核实、素材拥有使用权限且不存在需遮盖的隐私信息？':'Are all claims verifiable, do you own the materials, and have you removed private information?',
 '已批准确切内容版本':'This content revision was approved','登记你已手动发布的内容':'Record manually published content','实际发布链接':'Publication URL','发布平台':'Platform',
 '退回交付':'Return deliverable','请检查原型和实际提交版本。只有当前版本的有效 GitHub 证据及验收项覆盖完整，系统才允许正式通过。':'Inspect the prototype and exact commit. Acceptance requires valid GitHub evidence and full criteria coverage.',
 '验收说明 / 退回原因':'Acceptance notes / reason for rejection',
 '确定暂停项目？平台停止授予新工作，但无法保证外部进程已经停机。':'Pause the project? New work authorization will stop, but external processes may still be running.',
 '确定恢复项目？恢复前需要重新核验外部状态。':'Resume the project? Recheck external state before continuing.',
 '用户主动操作':'User initiated','修订产品基线（生成新版本）':'Revise baseline (new version)','正式产品目标':'Approved product goal',
 '验收标准（每行一条）':'Acceptance criteria (one per line)','批准范围':'Approved scope','本轮不做':'Out of scope',
 '为什么需要这次变更？':'Why is this change necessary?','申请追加个人时间预算':'Request additional personal time',
 '每周总投入（上限20小时）':'Total weekly commitment (max 20 hours)','支持追加投入的新证据':'New evidence supporting extra work',
 '审批 Agent 的变更申请':'Review Agent change request','处理结果':'Resolution','拒绝':'Reject',
 '同意申请（实际基线仍须单独批准）':'Approve request (baseline requires separate approval)','审批理由':'Decision rationale',
 '状态':'Status','记录':'records','小时 · 现金 ¥':'hours · cash ¥',
};
export const COPY = Object.freeze({'en-US': Object.freeze(en)});
const dynamic = [
 [/^每周最多推送\s*(\d+)\s*项$/,(_m,n)=>`Up to ${n} opportunities per week`],
 [/^独立线索\s*(\d+)\s*·\s*(.*)$/,(_m,n,l)=>`Independent sources ${n} · ${l}`],
 [/^已配置\s*(\d+)\s*个可信 RSS 源$/,(_m,n)=>`${n} trusted RSS feeds configured`],
 [/^已扫描\s*(\d+)\s*个来源，新增\s*(\d+)\s*条未核实信号$/,(_m,a,b)=>`Scanned ${a} sources; ${b} new unverified signals`],
 [/^(\d+)\s*项记录$/,(_m,n)=>`${n} records`],
 [/^(\d+)\s*项$/,(_m,n)=>`${n} items`],
 [/^每周\s*(\d+)\s*小时\s*·\s*现金\s*¥(.*)$/,(_m,a,b)=>`${a} hours/week · cash ¥${b}`],
 [/^执行\s*(\w+)\s*·\s*证据\s*(\w+)\s*·\s*验收\s*(.*)$/,(_m,a,b,c)=>`Execution ${a} · Evidence ${b} · Acceptance ${en[c]||c}`],
 [/^基线 r(\d+)\s*·\s*条件覆盖\s*(\w+)\s*·\s*证据\s*(\d+)\s*项$/,(_m,b,c,n)=>`Baseline r${b} · Criteria ${c} · ${n} evidence items`],
 [/^状态\s*(.*)\s*·\s*基线 r(\d+)\s*·\s*(.*)$/,(_m,s,r,t)=>`Status ${en[s]||s} · Baseline r${r} · ${t}`],
 [/^最近同步\s*(.+)$/,(_m,t)=>`Last sync: ${t}`],
 [/^最近报告\s*(.+)$/,(_m,t)=>`Latest report: ${t}`],
 [/^验证「(.+)」是否为真实消费者提供价值$/,(_m,title)=>`Validate whether “${title}” provides value to consumers`],
 [/^(\d+)\s*条（尚未核验）$/,(_m,n)=>`${n} unverified sources`]
];
export function normalizeLanguage(locale){return Object.hasOwn(LANGUAGES,locale)?locale:'zh-CN';}
export function initialLanguage(storageValue,browserLanguage='zh-CN'){
  if(Object.hasOwn(LANGUAGES,storageValue))return storageValue;
  return /^en(?:-|$)/i.test(browserLanguage)?'en-US':'zh-CN';
}
export function translate(input,locale='zh-CN'){
  const text=String(input??'');if(locale==='zh-CN')return text;
  const phrase=text.trim();if(!phrase)return text;
  let converted=COPY[locale]?.[phrase];
  if(converted===undefined){for(const [pattern,format] of dynamic){const m=pattern.exec(phrase);if(m){converted=format(...m);break;}}}
  if(converted===undefined)return text;
  const leading=text.match(/^\s*/)[0],trailing=text.match(/\s*$/)[0];
  return leading+converted+trailing;
}
export function applyLanguage(root,locale='zh-CN'){
  if(!root||locale==='zh-CN')return;
  const document=root.ownerDocument||globalThis.document;
  const walker=document.createTreeWalker(root,4/* NodeFilter.SHOW_TEXT */);
  let node;
  while((node=walker.nextNode())){
    if(node.parentElement?.closest('[data-i18n-skip], script, style, pre, code, textarea'))continue;
    const next=translate(node.nodeValue,locale);if(next!==node.nodeValue)node.nodeValue=next;
  }
  for(const elem of root.querySelectorAll('[placeholder], [aria-label], [title]')){
    if(elem.closest('[data-i18n-skip]'))continue;
    for(const key of ['placeholder','aria-label','title']){
      const value=elem.getAttribute(key);
      if(value!==null)elem.setAttribute(key,translate(value,locale));
    }
  }
}
