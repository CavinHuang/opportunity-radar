# Opportunity Radar 实施审计报告（IMPLEMENTATION_AUDIT）

> 审计基线：`main@8e926e1`（8e926e195f9b61e881ee451f69a6dd3b79eec214，"feat: v2.8 publication scheduling and evidence-based investment review (#29)"）
> 版本：v2.8.0（`package.json`）· 报告日期：2026-10-11
> 结论速览：61 项审计条目中，**37 项为已有能力，24 项为能力缺口（P1×5、P2×19、P0×0）**。缺口中 7 项已复核确认、3 项部分成立、14 项未复核、**0 项被驳回**。未发现任何 P0 风险级缺陷（即未发现会直接丢失/损坏数据或必然崩溃的问题）；最高风险为 3 项 P1（备份纯手动、默认无 token 时 DNS rebinding、Windows 权限位失效）。

---

## 1. 概述

### 1.1 仓库基线与环境

| 项 | 值 | 依据 |
|---|---|---|
| 基线提交 | `main@8e926e1`（v2.8，PR #29：发布排期 + 证据化投入复盘） | 本次撰写时 `git log -1` 核实 |
| 版本 | 2.8.0 | 本次撰写时读取 `package.json` 核实 |
| 运行平台 | Windows win32 本机（开发机即目标运行平台之一） | 审计运行环境 |
| Node 要求 | `engines: ">=22.16.0"`（node:sqlite 为实验特性）；审计机实为 node v24.1.0，满足要求 | `package.json` engines + 审计运行记录 |
| 外部依赖 | **零外部依赖**：`package.json` 无 dependencies/devDependencies（本次撰写时核实均为 null）；SQLite 经 `node:sqlite` 内置模块，测试经 `node:test`；浏览器 E2E 依赖仓库外的 Python 3.11 + Playwright（仅 CI 与手动冒烟使用） | `package.json` + 审计记录 |
| 测试规模 | 27 个 node:test 文件、156 个用例（审计提问中"26 个文件"有误，实测 `ls tests/*.test.mjs` 为 27） | 审计记录 claim#20 |
| 代码规模 | 约 2647 行测试 / 3147 行源码，24 个 src 模块 | 审计记录 claim#36 |

### 1.2 审计方法

1. **静态阅读**：src 全部模块、`public/app.js`、`scripts/browser-smoke.py`（211 行完整阅读）、`.github/workflows/*.yml`、`tests/*.test.mjs`。
2. **本机实跑**（Windows，本次审计执行）：
   - `npm test`（= `node --test tests/*.test.mjs`，package.json:16）**两次完整运行**，结果一致：`ℹ tests 156 / pass 152 / fail 4`；
   - 单独运行 `node --test tests/http.test.mjs`：**全部通过**（该文件仅在全量并行运行时因 teardown 失败）；
   - `npm run check`（package.json:17）中的全部 15 个 `node --check` 语法检查通过（输出 `syntax-check-done`，无 SYNTAX FAIL）。
3. **一次性运行时探针**（自编 node 脚本，审计后已删除，未改动任何仓库文件）：对 `src/db.mjs` 实测——过期 revision 写入被 `REVISION_CONFLICT` 拒绝；嵌套事务抛 `cannot start a transaction within a transaction`；幂等重放 `calls=1` 且签名不匹配抛 `IDEMPOTENCY_CONFLICT`；事务抛错后回滚生效；文件库 `PRAGMA journal_mode=wal / busy_timeout=3000 / user_version=0`；第二连接顺序写入正常。
4. **独立复核**：61 条中 10 条（条目 #1、#5、#10、#13、#14、#16、#17、#18、#31、#32）经二次逐条复核，含运行时复现（内存库驱动 createService、`node --input-type=module` 实测 experiment-decision），复核过程未修改任何文件。
5. **未执行项（如实声明）**：`scripts/browser-smoke.py` **未在本机运行**——环境具备（Python 3.11.7 + Playwright 可导入），但脚本成功路径会向仓库内 `artifacts/browser-smoke/` 写截图，受只读审计约束未执行；其绿灯由 CI 的 `browser-smoke.yml` 保障。涉及该脚本的结论基于完整阅读而非运行。

**撰写时抽查**：本文档撰写人对 `src/db.mjs` 全文抽查，确认审计记录中对 db.mjs 的全部行号引用（:5 实体白名单、:9 PRAGMA、:10-13 建表与 idem.signature 迁移、:17 list 无 LIMIT、:18-22 乐观锁、:24-25 事件 LIMIT 100、:26 事务、:27-31 幂等）逐一吻合。

### 1.3 基线测试结果（Windows 本机）

| 命令 | 结果 | 失败明细 |
|---|---|---|
| `npm test`（两次全量） | 156 用例：152 通过 / **4 失败** | 全部为 Windows 文件系统语义问题，**无业务断言失败**（见下） |
| `node --test tests/http.test.mjs`（单独） | 全部通过 | — |
| `npm run check` 的 15 个 `node --check` | 全部通过 | — |
| Linux CI（ci.yml，ubuntu-latest + Node 22） | 全量通过 | — |

4 个失败逐一定位（claim#35，未复核）：

| 文件:行 | 现象 | 根因 |
|---|---|---|
| `tests/pilot-journal.test.mjs:26` | 断言 chmod 0600=384 实得 438 | Windows 无 POSIX 权限位（0o666 vs 0o600） |
| `tests/mcp-http.test.mjs:23` | after 钩子 `rmSync` 报 EPERM | 临时目录被 SQLite 句柄锁定 |
| `tests/pilot-http-e2e.test.mjs`（finally） | 同类 `rmSync` EPERM | 同上 |
| `tests/http.test.mjs:7` | after 钩子 `rmSync` EPERM（仅全量并行时；单独运行全过） | 同上 |

含义：当前开发机（win32）上 `npm run check` 末尾的 `npm test` **必然红**，属环境性失败而非功能回归。

### 1.4 复核状态标记说明

本文档对每条缺口标注独立复核的最终裁定（四档）：

- **已复核确认**：复核逐条验证属实、缺口按复核口径成立（含由 partial 升级为 confirmed 者）；
- **部分成立**：复核确认主要事实，但缺口范围/定性需修正（部分能力实际已由其他机制实现）；
- **未复核**：原始审计结论，未经二次独立复核；
- **已驳回**：复核认定结论不成立（**本次为 0 条**，见第 5 节）。

---

## 2. 已有能力清单（按模块）

共 37 项（审计条目 #0–#60 中 status=present 者）。标注 🧪 的条目在审计本机有运行时探针/测试绿灯等直接运行证据；其余为静态阅读结论（未独立复核），但绝大多数经 152 个通过用例直接或间接背书。

### 2.1 数据模型（src/db.mjs）
- **通用 JSON 记录存储**（#0，P0）：16 种实体白名单（db.mjs:5，撰写时核实）、单表 `records(kind,id,json,revision)`、乐观锁冲突检测（db.mjs:18-22，`REVISION_CONFLICT` 409）、幂等表含 signature 列自动迁移（db.mjs:13,27-31）。🧪（探针实测乐观锁与幂等）
- **事件溯源**（#2，P1）：events 表记录 project_id/kind/entity_id/actor/detail，按项目过滤 + 游标增量读取，单次上限 100 条（db.mjs:11,24-25；service.mjs:216-220）；sourceDiagnostics 亦直接 SQL 读事件（source-hub.mjs:250）。
- **迁移与 PRAGMA 基线**（#54，P1）：WAL + foreign_keys + busy_timeout=3000 每次打开设置（db.mjs:9，🧪 实测 journal_mode=wal）；engines 要求 node>=22.16。

### 2.2 HTTP 服务、鉴权与错误处理（src/server.mjs）
- **双通道鉴权与防护**（#3，P0）：owner 走 `x-radar-owner-key`、agent 走 Bearer；非回环绑定强制设 token（server.mjs:26）；Origin 校验（:36-39）、300KB body 上限（:35）、静态资源严格 CSP（:43）。未设 owner token 时本机回环完全开放，符合 local-first 定位。
- **角色隔离与边界**（#49，P0）：agent 端点未配置 token 一律 401（:32）；agent 工具有项目归属/基线版本/暂停状态边界检查（service.mjs:18 assertActive、:222,238,240,249-251）。
- **服务端错误处理**（#55，P1）：全局 catch 返回 500 通用中文消息（不泄内部细节），原始错误带时间戳写 stderr（server.mjs:172）；GitHub 证据核验失败降级为 pending 而非崩溃（github.mjs:44）；SHA/URL 格式不符直接 unverified 不发网络请求（github.mjs:5-10）。

### 2.3 状态机（src/service.mjs）
- **机会分诊状态机**（#4，P1）：candidate/watching/dismissed 互转，experiment 状态禁止直接隐藏（service.mjs:30-36），信号转 converted 后不可重复关联（service.mjs:37-45，`SIGNAL_CONVERTED` 409）；triage 状态白名单（source-hub.mjs:226-232）。
- **项目状态机**（#6，P0）：research→execution/promotion/review 随里程碑验收推进（service.mjs:166）；pause/stop/resume（:120-127，externalProcessState 恒为 unknown）；基线修订与预算审批（≤20h/周，:128-143）；旧基线 kickoff 任务自动封锁（:98-99）。⚠️ 内含一处缺陷见缺口 G01 相关（resume 后 status/stage 不一致，:124-125，未复核）。
- **任务状态机与执行围栏**（#7，P0）：open/in_progress/blocked/submitted/rework；15 分钟租约（领取/续期/释放）、过期接管强制 reconciliation、基线过期拒绝领取（`BASELINE_STALE`）、依赖未完成拒绝领取（`DEPENDENCY_UNMET`）（service.mjs:221-245、:215；owner-tasks.mjs:26-31 含环检测 `DEPENDENCY_CYCLE`）。全部写操作经 withIdem 幂等包装（service.mjs:16）。
- **内容→发布→账本链**（#8，P1）：draft→approved（强制事实/隐私勾选 + 主张带产品版本与证据）→published（仅人工登记真实 URL）；编辑重置为草稿（service.mjs:177-178,193-206）；账本 15 种指标白名单且 contentId 只能挂已发布内容（:207-210）。

### 2.4 Agent 工具（src/service.mjs、src/mcp.mjs、src/mcp-stdio.mjs）
- **12 个工具三通道暴露**（#9，P0）：HTTP `/api/agent/tools`、MCP HTTP（2026-07-28 协议头强校验，mcp.mjs:56-65）、stdio（legacy，mcp-stdio.mjs:16）；协作交接工具显式禁用 501（service.mjs:261）。dispatchMcp 不按 inputSchema 校验参数，靠 service 层 required/ensureRevision 兜底；Agent 工具全部不触及 contents/schedule/ledger（发布域归 owner）。
- **任务租约机制**（#50，P0）：15 分钟过期、leaseCheck 校验 token/holder/过期、续期仅限原持有人、过期接管必须 recovery_checked + ≥8 字外部核对说明（service.mjs:20,226-235）。🧪（tests/reliability 全过）UI 诚实提示"租约过期不能证明外部进程已停止"（app.js:63）。

### 2.5 v2.8 宣发排期（提交 8e926e1 新增）
- **排期 API**（#11，P1）：`POST /api/projects/:id/contents/:cid/schedule`，要求带时区未来时间、乐观锁 expected_revision、已发布内容禁止重排（service.mjs:179-192；server.mjs:151-152；tests/service.test.mjs:50-61 三个负例 + 成功断言）。
- **排期/审批版本围栏**（#12，P1）：排期同步推进 approvedRevision 不丢人工审批（service.mjs:189）；编辑重置 plannedAt/scheduledRevision/approval 回草稿（:177）；测试断言排期后仍可正常 publish_record（tests/service.test.mjs:54-58）。⚠️ scheduledRevision 本身为死字段，见缺口 G07。

### 2.6 v2.8 投入复盘（src/experiment-decision.mjs）
- **evidence-based investment review**（#15，P1）：仅汇总 actual===true 的账本；未记录指标按未知（null）绝不按零（⚠️ refund 除外，见缺口 G10）；里程碑全部人工验收 + 无待验收交付才可能 ready；输出三态（delivery_unverified / evidence_incomplete / ready_for_owner_review）+ 明示 caveats（experiment-decision.mjs:2-22；server.mjs:144；tests/experiment-decision.test.mjs:4-17）。纯只读决策支持，最终决策仍走既有 /decide 端点。

### 2.7 v2.8 前端接线（public/app.js）
- **排期入口与决策卡**（#19，P2）：内容卡"设置排期"入口与计划时间展示（app.js:41,452）；账本页"继续投入决策依据"卡（四项指标、缺失清单、试用/访问率、净现金及口径警示，app.js:86-90）。decisionReview 仅 owner 可见，不进 Agent 上下文。

### 2.8 输入验证（src/validation.mjs）
- **严格输入验证**（#37，P0）：长度区间、枚举白名单、强制同意确认、参与者匿名代号正则拦截联系方式（`/[@\s]|\d{11}/`）、证据 URL 强制无凭据 HTTPS（validation.mjs:4-17,67-72）；关闭计划强制 expected_revision（:86）；continue 需观察记录 + 不确定性确认（:89-90）；观察全部标注 owner_reported/未独立核实（:31），无信任提升路径。

### 2.9 数据安全（src/data-safety.mjs）
- **备份流程**（#38，P0）：先 inspectRadarDatabase 校验 schema + integrity_check + 逐记录 JSON/revision 一致性，再 VACUUM INTO 事务一致性快照（:55-58）、chmod 0600（:59）、sha256 manifest、硬链接 no-clobber 原子提交（:67-72）、失败回滚清理（:74-81）。🧪（tests/data-safety 6 用例全过）manifest 自述仅防意外损坏不防恶意篡改（:66）。
- **恢复机制**（#39，P1）：强制 `--confirm` + 全新空目标路径（含 -wal/-shm 检查），从不覆盖已有库（:107 RESTORE_EXISTS）；复制后二次校验 sha256 与记录数（:114-115 RESTORE_VERIFY_FAILED）；verify 校验 manifest/校验和/字节数/记录计数（:92-99）。恢复需停机手工切 RADAR_DB——安全优先取舍。

### 2.10 并发控制与幂等
- **乐观锁**（#43，P0）：store.put 校验 expected_revision，不匹配抛 409 `REVISION_CONFLICT`（db.mjs:18-21，🧪 实测拒绝过期写入）；HTTP 层写路由普遍传递 expected_revision（server.mjs:95、source-hub.mjs:76,275、validation.mjs:86、owner-tasks.mjs:15）。
- **事务机制**（#44，P1）：BEGIN IMMEDIATE/COMMIT/ROLLBACK，🧪 实测抛错即回滚；嵌套事务会抛错（当前全部事务调用方——server.mjs:93、service.mjs:37,73,90,144、source-hub.mjs:161,200、delivery-trace.mjs:48、discovery.mjs:155——已核对无嵌套调用路径；属未来脆弱点而非现行为缺陷）。
- **采集并发防护**（#45，P1）：scanSources 全局 in-flight 锁（source-hub.mjs:12,142 `SCAN_IN_PROGRESS` 409）；每源提交在事务内做 revision fence（:161-164）；采集期间来源被改/删则跳过且不误标失败（:186-195）；调度器防重入 running 标志（source-scheduler.mjs:7-17）。
- **Agent 工具幂等键**（#46，P0）：idem 表存响应 + 参数签名 sha256；重放返回缓存、同键不同参数 409 `IDEMPOTENCY_CONFLICT`（db.mjs:27-31；service.mjs:16 包装全部 12 工具；mcp.mjs:11-19 idempotency_key required）。🧪 实测重放 calls=1、签名冲突被拒；tests/reliability.test.mjs:18-28 通过。

### 2.11 采集可靠性（SSRF 防线，src/source-hub.mjs、src/pinned-https.mjs）
- **RSS 采集防护链**（#52，P0）：DNS 全 A 记录必须公网 IP（私段/ULA/链路本地/回环黑名单，source-hub.mjs:28-46,90-101）；socket 级 DNS pinning（TLS SNI 保持原域名防 rebinding，pinned-https.mjs:8-24,38-41）；每跳重定向重新校验且 ≤3 跳（:102-139）；10s 超时、1MB 流式长度上限（:129-134）。🧪（tests/secure-feed-transport.test.mjs，239 行 12 用例，全过）

### 2.12 测试套件
- **27 文件 156 用例**（#20，P0）：覆盖 service/HTTP 契约/MCP/数据安全/发现聚类/来源可靠性/Agent 传输等；24 个 src 模块全部有直接或间接测试（data-cli、mcp-stdio、server 经 spawn/import 覆盖）。🧪 各测试文件主题速览：agent-pilot(17)、agent-process-e2e(3)、agent-setup(4)、data-safety(6)、delivery-trace(7)、discovery-clusters(6)、discovery-precision(6)、discovery-quality(5)、experiment-decision(3)、github(2)、http(9)、i18n(13)、mcp-http(1)、mcp(3)、owner-tasks(5)、pilot-http-e2e(1)、pilot-journal(3)、project-pipeline(4)、reliability(7)、secure-feed-transport(12)、service(10)、signals(2)、source-diagnostics(2)、source-hub(5)、source-quality(4)、source-reliability(9)、validation(6)。
- **npm test / npm run check 脚本**（#21/#22，P0/P1）：`node --test tests/*.test.mjs` 全量无分片（package.json:16）；check = 15 个文件语法检查 + 末尾再跑一次完整 npm test（package.json:17，🧪 15 个 node --check 本次全过）。⚠️ check 未覆盖 11 个模块（均被测试导入兜底）；同一套件在单次 CI 内执行两次。
- **测试基线结论**（#57，P1）：152/156 通过，4 失败均为 Windows 环境问题而非功能回归。🧪

### 2.13 CI 工作流（.github/workflows/）
- **ci.yml**（#23，P0）：push + PR 全触发，ubuntu-latest + Node 22，依次 npm test 与 npm run check（ci.yml:2-14）。无 concurrency 组、无覆盖率/产物上传、无 OS 矩阵。
- **browser-smoke.yml**（#24，P1）：paths 过滤触发（public/src/probe 脚本/自身）+ 手动；Python 3.11 + Playwright Chromium 真实浏览器 E2E，5 分钟超时，always() 上传证据。是唯一覆盖前端真实渲染的门禁。
- **agent-github-evidence.yml**（#25，P1）：paths 触发 + 手动；github.token 经真实 GitHub REST 校验固定历史提交 ace6e15（CavinHuang/opportunity-radar）的 required check=test（:3-31）。验证对象是历史提交而非当前 PR，存在外部脆弱性。
- **catalog-probe.yml**（#26，P2）：paths 触发 + 手动；对 6 个固定公开源做真实网络可达性探测（:3-25）。有天然抖动，非确定性门禁。
- **readme-screenshots.yml**（#27，P2）：仅手动；采集本地化前端截图并自动提交到固定分支（:2-36）。文档工具而非质量门禁。

### 2.14 E2E 三层（同一设计原则：真实服务器/真实子进程 + 一次性 SQLite，零 mock）
- **浏览器 E2E**（#28，P0）：`scripts/browser-smoke.py`（Playwright 同步 API）真实 headless Chromium（zh-CN）直连真实 Node 服务器，覆盖源目录安装→源质量反馈、信号→聚类全链、验证计划、研究核查、批准研究依据→开实验→kickoff 可领取、Agent 标签页、G4 禁用、语言切换，最后断言零 pageerror（:16-211，失败时截图+dump 现场）。**本次未在本机运行**（见 1.2 第 5 条），绿灯由 CI 保障。
- **HTTP E2E**（#29，P1）：tests/pilot-http-e2e.test.mjs 起真实 HTTP 端口，owner 审批→kickoff→Agent bearer→精确 PR 证据提交→G4 pending 全链；覆盖 401、重复提交幂等、租约释放、未验证证据 accept 409（GitHub 侧经 fetchImpl mock，:56-58）。
- **进程级 E2E**（#30，P1）：tests/agent-process-e2e.test.mjs spawn 独立 mcp-stdio 子进程走 JSON-RPC（12 工具），覆盖 T1 证据交接与拒绝→返工→再提交、T3 崩溃→租约过期→RECONCILIATION_REQUIRED→安全恢复→旧令牌 LEASE_INVALID→release、DEPENDENCY_UNMET/BASELINE_STALE 阻断（:64-167）。🧪（该文件在本机全量运行中通过）是唯一验证 MCP stdio 真实子进程边界的测试。

### 2.15 Web UI 体验（public/app.js、public/i18n.js）
- **空状态与错误反馈**（#58，P1）：9 处 empty() 空态；所有 API 错误经 toast 展示服务端 message；modal 提交失败恢复按钮（app.js:13,183-193,466）。esc() 统一转义（:5）+ CSP 'self' + i18n 仅改文本节点（i18n.js:360-370），XSS 面收敛。

### 2.16 其他经观察确认的能力
- **GitHub 证据链**（观察记录）：verifyGitHubEvidence 要求 40 位 SHA、PR head 一致、必需 CI 全部成功且属同一提交（github.mjs:3-45）；ownerDecision 的 G1 门强制产品交付有 SHA 一致的已核验 GitHub 证据（service.mjs:153-158）；人工 attest 明确禁止 GitHub 证据绕过 CI（server.mjs:162）。
- **Agent pilot 闭环**（观察记录）：agent-pilot.mjs plan/run/submit/recover/status；submit 前先远端校验 PR head（:202-203）；幂等键按 projectId+taskId+sha+pr 稳定派生（deliveryKey，:149-151）；失败后 finally 释放租约（:244-254）。

---

## 3. 能力缺口清单

共 24 项：**P1×5、P2×19、P0×0**。复核状态分布：已复核确认 7、部分成立 3、未复核 14、已驳回 0。

### 3.0 缺口总表

| # | 审计条目 | 模块 | 缺口（一句话） | 优先级 | 复核状态 | 开发阶段 |
|---|---|---|---|---|---|---|
| G01 | #5 | 状态机 | 机会↔实验联动：入口无门槛、出口无路径 | **P1** | 已复核确认 | Phase A 任务管理 |
| G02 | #10 | 状态机 | 研究→实验衔接是软约束，unlinked 仅附 warning 即可开工 | **P1** | 部分成立 | Phase A 任务管理 |
| G03 | #35 | 测试/可靠性 | Windows 上 npm test 4/156 失败，开发机无法全绿 | **P1** | 未复核 | Phase E 可靠性 |
| G04 | #40 | 数据安全 | 备份完全依赖用户手动执行 CLI，无调度/自动备份 | **P1** | 未复核 | Phase E 可靠性 |
| G05 | #48 | API | 默认无 token 时 DNS rebinding 可绕过 Origin 校验获得 owner 全权读写 | **P1** | 未复核 | Phase E 可靠性 |
| G06 | #1 | 数据模型 | 实体关联无 SQL 约束/级联；list 全量无分页；getFullProject 每次全表聚合 | P2 | 已复核确认 | Phase E 可靠性（基础设施） |
| G07 | #13 | v2.8 宣发 | scheduledRevision 版本围栏字段只写不读，属死字段 | P2 | 部分成立 | Phase B 宣发 |
| G08 | #14 | v2.8 宣发 | 排期到期消费缺失：到点不提醒、逾期不标记、无"今日应发布"行动项 | P2 | 已复核确认 | Phase B 宣发 |
| G09 | #16 | v2.8 复盘 | pendingAcceptance 未按当前基线过滤，旧 pending 永久压死状态 | P2 | 已复核确认 | Phase D 复盘决策 |
| G10 | #17 | v2.8 复盘 | missingMetrics 漏 refund，净现金把未记录退款按 0 扣减 | P2 | 已复核确认 | Phase D 复盘决策 |
| G11 | #18 | v2.8 复盘 | 复盘数据面未纳入 product_feedback 与按内容归因数据 | P2 | 部分成立 | Phase D 复盘决策（数据源自 Phase C 增长数据） |
| G12 | #31 | E2E | 历史与复盘视图（renderHistory）零浏览器 E2E | P2 | 已复核确认 | Phase E 可靠性 |
| G13 | #32 | 测试 | AI 能力路由（analyze / contents/generate）无 HTTP 层测试 | P2 | 已复核确认 | Phase E 可靠性 |
| G14 | #33 | 测试 | 外围路由（verify/retry/schedule/owner-tasks）无 HTTP 测试；CSP 头无断言 | P2 | 未复核 | Phase E 可靠性 |
| G15 | #34 | 测试 | 前端 app.js（467 行）无单元测试 | P2 | 未复核 | Phase E 可靠性 |
| G16 | #36 | 工程化 | 无 lint、无覆盖率、无依赖更新自动化、无测试产物上报 | P2 | 未复核 | Phase E 可靠性 |
| G17 | #41 | 数据安全 | 0o600 权限设置在 Windows 上无效 | P2 | 未复核 | Phase E 可靠性 |
| G18 | #42 | 数据模型 | 无 schema 版本管理（PRAGMA user_version=0），无降级/半迁移检测 | P2 | 未复核 | Phase E 可靠性 |
| G19 | #47 | 幂等 | Owner API 创建类端点无幂等去重，双击/重试可产生重复记录 | P2 | 未复核 | Phase E 可靠性 |
| G20 | #51 | Agent 工具 | mcp-stdio 通道无鉴权即获全量写权限，边界仅是"本地进程可信" | P2 | 未复核 | Phase E 可靠性 |
| G21 | #53 | 可靠性 | 遗留 scanFeeds 用普通 fetch，属未引用死代码，复用即绕过 SSRF 防线 | P2 | 未复核 | Phase E 可靠性 |
| G22 | #56 | 可靠性 | events 表只增不清；store.list 每请求全量 JSON.parse；聚类 O(n²) | P2 | 未复核 | Phase E 可靠性 |
| G23 | #59 | UI | 无任何加载/骨架态；refresh 串行 10 个请求，失败停留空白/旧数据 | P2 | 未复核 | Phase E 可靠性 |
| G24 | #60 | UI | 渲染对异常数据不健壮，单条坏记录可致整视图渲染失败 | P2 | 未复核 | Phase E 可靠性 |

> 阶段覆盖说明：**Phase C 增长数据无独立缺口**——账本（15 指标白名单 + contentId 归因校验，service.mjs:207-210）与产品反馈（delivery-trace.mjs:47-68）的采集与归因能力已具备（#8、#15，且 G11 复核确认"数据采集、归因与同页展示均已实现"），缺口仅在复盘计算未汇入（G11）。Phase A 为 G01/G02，Phase B 为 G07/G08，Phase D 为 G09/G10/G11，其余 17 项归 Phase E。

### 3.1 P1 缺口（5 项）

#### G01 机会↔实验状态联动不完整：进入无门槛、退出无路径（审计条目 #5）
- **复核状态**：已复核确认（复核对两条缺陷均独立复证，含运行时复现；判定"partial 准确"，即联动能力不完整）
- **证据**：`src/service.mjs:74`（startExperiment 直接 get 机会，未校验 o.status）、service.mjs:87（置 experiment）、service.mjs:32（experiment 禁止 triage）、service.mjs:120-127（ownerDecision pause/stop 不改机会状态）。复核补充：运行时复现——dismissed 机会可成功 startExperiment（researchBasis.status='unlinked'）；ownerDecision stop 后机会仍为 experiment，向 candidate/dismissed/watching triage 全部返回 409 PROJECT_IN_PROGRESS。全仓 `put('opportunities')` 仅 6 处生产写入（复核逐一排除替代命名）。
- **说明**：停止实验后，机会既不能重新分诊也不能被简报 candidates 收录（brief 只取 candidate，service.mjs:72），只能再开新实验（且受单活跃实验限制）。复核措辞修正：代码不存在项目"归档"动作，'archived' 从未被赋值（仅出现在 9 处守卫数组），实际仅有 pause/stop/resume——退出路径比原审计描述的更少。
- **阶段**：Phase A 任务管理

#### G02 研究→实验衔接为软约束，unlinked 仅附 warning 即可开工（审计条目 #10）
- **复核状态**：部分成立（复核确认"参数可空、无任何强制"属实；"部分"指衔接机制本身已实现且关联时校验严格）
- **证据**：`src/delivery-trace.mjs:17-33`（approvedResearchBasis：仅 owner 关闭的 continue 决策有效且须最新一轮，否则 409）；`src/service.mjs:80`（`data.validationPlanId||null` 直接放行）；service.mjs:82-87（researchBasis 写入基线与项目，事件记录 status；复核修正：原引 84-87 有 1-2 行偏移，84-85 实为里程碑创建，实质无误）。复核穷尽搜索确认无其他强制机制；tests/delivery-trace.test.mjs:61-67 明确固化"unlinked 可开工仅标记"行为（该文件本机实跑 7 pass）。
- **说明**：证据链已打通且防伪造（计划不匹配/已被取代均 409），但"先验证后开发"不强制，主流程可不消费研究结论。符合产品定位，是否收紧为产品决策。
- **阶段**：Phase A 任务管理

#### G03 Windows 上测试套件 4/156 失败，当前开发机无法全绿（审计条目 #35）
- **复核状态**：未复核（但为本审计实跑结果，见 1.3）
- **证据**：win32 运行 `npm test`：tests/pilot-journal.test.mjs:26 断言 chmod 0600=384 实得 438；tests/http.test.mjs:7、tests/mcp-http.test.mjs:23、tests/pilot-http-e2e.test.mjs finally 的 rmSync EPERM（临时目录被 SQLite 句柄锁定）。CI 仅 ubuntu-latest 故未暴露。
- **说明**：失败均为环境性（POSIX 权限位 + 文件句柄锁定），无业务断言失败，但 `npm run check` 在 Windows 开发机必然红。
- **阶段**：Phase E 可靠性

#### G04 备份完全依赖用户手动执行，无调度/自动触发（审计条目 #40）
- **复核状态**：未复核
- **证据**：`src/data-safety.mjs:132`（backup check ok:null）；`public/app.js:144-146` 仅展示命令并复制到剪贴板；仓库内无任何定时备份代码。readiness 页明确声明"此页面不能证明离线备份已保存"。
- **说明**：备份/恢复/校验闭环本身很强（#38/#39），但数据丢失风险实际取决于用户是否执行 `npm run data -- backup`。
- **阶段**：Phase E 可靠性

#### G05 默认无 token 时 DNS rebinding 可绕过 Origin 校验（审计条目 #48）
- **复核状态**：未复核
- **证据**：`src/server.mjs:36-39`（protectOrigin 仅比较 origin.host===req.headers.host，无 127.0.0.1/localhost 白名单）；:31-34（未设 RADAR_OWNER_TOKEN 时 authorize 直接放行）；:26（仅绑定非 loopback 时强制 token）。
- **说明**（按审计观察的准确表述）：protectOrigin 可防普通跨站 CSRF；但在默认 loopback + 未设 RADAR_OWNER_TOKEN 组合下，恶意页面通过 DNS rebinding 使 Origin 与 Host 同为恶意域名即可绕过并读写全部数据。**设置 RADAR_OWNER_TOKEN 即完全免疫**（.env.example 已警示）。建议增加 Host 头白名单。
- **阶段**：Phase E 可靠性

### 3.2 P2 缺口（19 项）

#### G06 数据模型：无 SQL 约束/级联、list 无分页、getFullProject 每次全表聚合（审计条目 #1）
- **复核状态**：已复核确认（原判 partial 偏保守，复核升级为 confirmed："缺失属实"）
- **证据**：`src/db.mjs:10`（单一通用表，无外键列；db.mjs:9 的 PRAGMA foreign_keys=ON 无约束可 enforce）；db.mjs:17（list 无 LIMIT，逐行 JSON.parse）；`src/service.mjs:119`（getFullProject = 1 次 PK get + 8 类全量 list+filter，聚合 9 类实体，其中 8 类全表扫描；server.mjs:107,144,148 每请求重新聚合无缓存）。复核运行时验证：foreign_key_list(records)=[]、无触发器；grep 全库无 DELETE 端点/语句（级联删除不存在）；16 类实体的 q.list 路径均无分页（存在的分页要么是内存切片 source-hub.mjs:233-241、service.mjs:215，要么只作用于 events 表 db.mjs:25、owner-tasks.mjs:41、source-hub.mjs:250）。
- **说明**：本地单机数据量小可接受；孤儿记录（如指向已删除项目的任务）无数据库层防护，删除类操作无级联。
- **阶段**：Phase E 可靠性（基础设施）

#### G07 scheduledRevision 版本围栏字段只写不读，属死字段（审计条目 #13）
- **复核状态**：部分成立（复核确认字段级结论完全成立——删除该字段不改变任何行为；但驳回了"排期发布版本围栏整体缺失"的引申：同一安全属性已由 approvedRevision 围栏实现）
- **证据**：全仓 grep 仅 `src/service.mjs:177`（置 null）与 `src/service.mjs:189`（写 c.revision+1，经 db.mjs:18-21 证实写后恒等于当前 revision）两处且均为写入；发布只校验 approvedRevision===c.revision（service.mjs:201）；public/app.js 未读取。复核充分排查替代命名与 CI/文档均无消费。
- **说明与建议**：排期→发布的安全属性实际由 approvedRevision 围栏承载（排期 :189 同步推进、编辑 :177 清空、发布 :201 把关），不缺保护；正确动作是**删除 scheduledRevision**，或在发布时真正消费它。勿为其重新开发一套围栏（见第 5 节）。
- **阶段**：Phase B 宣发

#### G08 排期的到期消费完全缺失（审计条目 #14）
- **复核状态**：已复核确认（复核独立验证，判定"该能力完全缺失（非部分实现）"）
- **证据**：grep 全仓 plannedAt 仅命中写入（service.mjs:177,184-190）与展示/提交（public/app.js:41,452）及测试；`src/project-pipeline.mjs:1-41` 无 plannedAt，nextActions（:17-33）确无"今日应发布"类行动项；`src/source-scheduler.mjs:5-25` 的定时器只消费 feeds 的 nextScanAt（source-hub.mjs:21,147 仅作用于 feeds）；server.mjs 路由无 due/upcoming/overdue 内容端点；content.scheduled 事件（service.mjs:190）全仓无消费者；Agent 工具 get_context 甚至不含 contents。易混淆项排除：owner_tasks 的 dueDate 仅前端渲染字符串比较（app.js:34），无 scheduler、不持久化，且非本条主体。
- **说明**：当前排期是纯记录型（记下打算何时发），离"排程"还差提醒/逾期可见性；可在 pipeline 或 ticker 中低成本补齐。
- **阶段**：Phase B 宣发

#### G09 decisionReview 的 pendingAcceptance 未按当前基线过滤（审计条目 #16）
- **复核状态**：已复核确认（复核实测复现，且"永久"程度比原述更强：旧 pending 连"拒绝"的路也被堵死）
- **证据**：`src/experiment-decision.mjs:11`（`submissions.some(s=>s.acceptanceState==='pending')`，无 baselineRevision 条件）；对比 `src/project-pipeline.mjs:10`（同类统计带 `s.baselineRevision===baseline?.revision`，两个读模型口径不一致）；`src/service.mjs:128-138`（revise_baseline 不清理旧 submission）；service.mjs:146（BASELINE_STALE 在 reject 时同样抛 409——旧基线 pending submission 既不能验收也不能拒绝）；grep 全库 `put('submissions'` 仅 service.mjs:259（创建）与 :160，无任何修复/清理路径。复核实测：同一份指标齐全、里程碑全 accepted 的数据，仅多加一条 baselineRevision:1 的 pending submission，status 从 ready_for_owner_review 变为 delivery_unverified，而 pipeline 的 pendingAcceptance=0。
- **阶段**：Phase D 复盘决策

#### G10 missingMetrics 漏掉 refund，净现金把未记录退款按 0 扣减（审计条目 #17）
- **复核状态**：已复核确认（复核运行时实测复现）
- **证据**：`src/experiment-decision.mjs:12`（missing=['visits','trials','income','cash_cost']，无 refund；service_cost/transaction_fee 同样缺席）；:6,8（refunds 无 actual 记录时为 0，netCash=income-refunds-costs 按 0 扣减；:17 outcomes 完全无 refund 字段）；:19-20（missing.length===0 即 ready_for_owner_review，与同文件 caveat"未记录的指标为未知，绝不按零处理"直接相悖）。复核实测：ledger 仅 visits=20/trials=5/income=100/cash_cost=30 → status=ready、netKnownCash=70；追加 {type:'refund',value:15,actual:true} 后 netKnownCash=55，证实未记录退款被高估净现金。tests/experiment-decision.test.mjs:10-12 的 fixture 不含 refund 却断言 ready——缺口已被测试固化。
- **说明与建议**：对"是否继续投入"，退款未知与退款为零差异重大；把 refund（及 service_cost/transaction_fee）纳入缺失清单，或在 netKnownCash 明示口径。
- **阶段**：Phase D 复盘决策

#### G11 复盘数据面未纳入 product_feedback 与按内容归因数据（审计条目 #18）
- **复核状态**：部分成立（复核确认计算面缺失属实、partial 准确；数据采集、按内容归因与同页展示均已实现，仅缺汇入计算）
- **证据**：`src/experiment-decision.mjs:3-13` 只读 project.ledger/milestones/submissions（全函数 2-22 行无 productFeedback/contents 引用）；唯一调用点 `src/server.mjs:144` 传入的 getFullProject（service.mjs:119）虽含 productFeedback 但未被消费。补充证据：product_feedback 消费点仅 delivery-trace.mjs:38、server.mjs:135-136、app.js:111-116（并列展示不汇入）；按内容归因已存在（service.mjs:208-210 校验、app.js:92-109 展示）但也未进入 decisionReview。
- **阶段**：Phase D 复盘决策（数据源自 Phase C 增长数据）

#### G12 历史与复盘视图（renderHistory）零浏览器 E2E（审计条目 #31）
- **复核状态**：已复核确认（复核穷尽搜索全部自动化验证资产）
- **证据**：`public/app.js:190` 定义 renderHistory、app.js:12 侧栏按钮；`scripts/browser-smoke.py` 全部导航点击仅 data-tab="agent"（:184）、data-tab="ledger"（:197）、data-nav="brief"（:199），历史仅经 API 断言 call('/api/history')（:176）。复核补充：S.view 初始 'brief' 且仅 data-nav 点击可改变（app.js:9,192,466），故历史视图 DOM 从未被断言；grep 全仓无任何 data-nav="history" 自动化点击（唯一两处 Playwright 脚本均无）；无 DOM 级 Node 测试兜底（http.test.mjs:39 仅将 app.js 当静态文本断言）；易混淆项排除（:197 的 ledger 是项目页子标签，:88 是聚类历史）。语言切换亦仅在 brief 视图验证一次。
- **阶段**：Phase E 可靠性

#### G13 AI 能力路由无 HTTP 层测试（审计条目 #32）
- **复核状态**：已复核确认（复核逐条核实并与原审计行号完全一致）
- **证据**：路由 `src/server.mjs:100-104`（/api/signals/:id/analyze）、`:147-148`（/api/projects/:id/contents/generate）；仅 tests/i18n.test.mjs:4,49,65 函数级导入测试（替换 globalThis.fetch 直调函数，不经 HTTP）；grep 三个含 fetch/createServer 的测试文件（http/mcp-http/pilot-http-e2e）与 browser-smoke.py 全文均无这两条路由；排除异名实现（无 MCP 工具/service 方法/job 包装）；前端 app.js:408,455 是生产调用方。
- **说明**：函数逻辑有覆盖，但路由的鉴权、请求解析与错误映射未经 HTTP 验证。
- **阶段**：Phase E 可靠性

#### G14 若干外围路由无 HTTP 层测试；CSP 响应头无断言（审计条目 #33）
- **复核状态**：未复核
- **证据**：verify 路由 `src/server.mjs:165-170` 无 HTTP 测试（tests/http.test.mjs 测了 attest 但无该路由断言）；retry 路由 server.mjs:72-73 仅 tests/source-diagnostics.test.mjs:29-32 函数级；schedule 路由 server.mjs:151-152 仅 tests/service.test.mjs:47-58 service 级；owner-tasks 路由 server.mjs:138-142 仅函数级；CSP 头定义于 server.mjs:43 但 tests/http.test.mjs:39 只断言 /app.js 返回 200 与内容。
- **说明**：核心写路由（opportunities/experiments/kickoff/decide/clusters/validations/attest）在 http.test.mjs 已有 HTTP 覆盖，缺口集中在外围路由。
- **阶段**：Phase E 可靠性

#### G15 前端 app.js 无单元测试（审计条目 #34）
- **复核状态**：未复核
- **证据**：grep "app.js" tests/ 仅命中 tests/http.test.mjs:39（静态文件 200 断言）；tests/i18n.test.mjs:3 只导入 public/i18n.js 纯函数。
- **说明**：perform() 动作分发、refresh() 数据装配等分支逻辑只能经浏览器 E2E 的单一主路径触达。
- **阶段**：Phase E 可靠性

#### G16 质量工具链缺口（审计条目 #36）
- **复核状态**：未复核
- **证据**：`package.json:9-18` 无 devDependencies、无 lint/coverage 脚本；`.eslintrc*`/`eslint.config*`/`.prettierrc*`/`.github/dependabot.yml` 全部不存在；`.gitignore:7` 有 coverage/ 目录但无工具产出；ci.yml 无 artifact 上传。
- **说明**：node --test 自带 `--experimental-test-coverage` 未启用；对 2647 行测试/3147 行源码的规模，回归防护完全依赖断言质量而非度量。
- **阶段**：Phase E 可靠性

#### G17 0o600 权限设置在 Windows 上无效（审计条目 #41）
- **复核状态**：未复核（但为本审计实跑观察）
- **证据**：`src/data-safety.mjs:59,71` chmodSync(tmp,0o600)；本机 npm test 中 tests/pilot-journal.test.mjs:26 失败："438 !== 384"（0o666 vs 0o600）。
- **说明**：本地单用户场景影响有限；若数据库目录被共享，备份文件可被同机其他用户读取。
- **阶段**：Phase E 可靠性

#### G18 无 schema 版本管理（审计条目 #42）
- **复核状态**：未复核
- **证据**：grep 'user_version|PRAGMA' 全 src/ 仅 db.mjs:9（WAL/foreign_keys/busy_timeout）、db.mjs:13（idem.signature ALTER）、data-safety.mjs:28（integrity_check）；实测 user_version=0；数据迁移在 source-hub.mjs:52-54（signal_only→new）。
- **说明**：records 表 JSON schema-less 掩盖了当前需求，但未来加列/索引无版本框架，旧代码读新库无法检测。
- **阶段**：Phase E 可靠性

#### G19 Owner API 创建类端点无幂等去重（审计条目 #47）
- **复核状态**：未复核
- **证据**：`src/server.mjs:124,131,156` 直接调用 createOpportunity/startExperiment/addLedger，无 store.idempotent 包装；modal 提交期间禁用按钮是唯一防线（app.js:193）。
- **说明**：会重复计数污染账本/机会池，但不丢数据；**带 expected_revision 的操作（triage/status 等）双击只会得到 409，无需额外兜底**（见第 5 节勿重复开发清单）。
- **阶段**：Phase E 可靠性

#### G20 mcp-stdio 通道无鉴权即获全量写权限（审计条目 #51）
- **复核状态**：未复核
- **证据**：`src/mcp-stdio.mjs:8-9` 注释明示 "Only run stdio from a trusted local Agent. OS file access is the security boundary"，直接 openDatabase 同一 RADAR_DB，无 token 校验。
- **说明**：本机任何进程可运行 `npm run mcp:stdio` 操纵项目/任务；本地单用户模型下可接受，文档应保留该警示。
- **阶段**：Phase E 可靠性

#### G21 遗留 scanFeeds 为绕过 SSRF 防线的死代码（审计条目 #53）
- **复核状态**：未复核
- **证据**：`src/signals.mjs:23-36`（普通 fetch + AbortSignal.timeout(8000)，无 pinnedHttpsFetch/checkPublicHost）；grep 证实生产代码未 import scanFeeds（仅 parseFeed/configuredFeeds 被引用）。
- **说明**：属死代码而非在用漏洞；建议删除或改为转发到 source-hub 的安全实现，防未来复用绕过防线。
- **阶段**：Phase E 可靠性

#### G22 资源边界缺口（审计条目 #56）
- **复核状态**：未复核
- **证据**：`src/db.mjs:11`（events 无保留策略，每次扫描写 1-2 条）；db.mjs:17（list 全表 ORDER BY rowid + JSON.parse，/api/signals 等每请求全量解析 sources，source-hub.mjs:238）；src/discovery.mjs:55,57-69（每请求 O(n²) 相似度，有 600 信号窗口上限）；source-hub.mjs:250 诊断查询 LIMIT 3000 有界。
- **说明**：个人规模（30 源上限，source-hub.mjs:63）可运行，长期运行性能线性衰减。
- **阶段**：Phase E 可靠性

#### G23 Web UI 无加载/骨架态，失败自愈弱（审计条目 #59）
- **复核状态**：未复核
- **证据**：`public/index.html:4`（#app 初始空 div 无占位）；`public/app.js:191`（refresh 串行 await 10 个请求，catch 仅 toast）；S.busy 仅用于 modal（:193），导航/扫描类点击无防抖。
- **说明**：首屏感知慢；双击风险由服务端 409/幂等兜底（实测），不造成数据问题。
- **阶段**：Phase E 可靠性

#### G24 渲染对异常数据不健壮（审计条目 #60）
- **复核状态**：未复核
- **证据**：`public/app.js:178`（模板内 `new URL(x.url).hostname` 未 try）；:27,119（`p.baselines.at(-1)`/`b.revision` 直接访问）；当前服务端写入路径均校验 URL（signals.mjs:16、source-hub.mjs:217-222），风险来自旧版本/手工改库数据。
- **说明**：单条坏记录抛 TypeError 即整页不可用，只能刷新；建议渲染层防御性兜底。
- **阶段**：Phase E 可靠性

---

## 4. 生产风险与建议

### 4.1 风险清单（按等级）

**总体结论（审计观察原文）**：该代码库可靠性工程水平显著高于同类个人项目——乐观锁 + 幂等键 + 事务 revision fence 构成三层并发防线；备份/恢复/校验闭环且从不覆盖原库；SSRF 防线（DNS pinning + 私网黑名单 + 重定向复查）完整。**无任何发现达到 P0 风险级**（即未发现会直接丢失/损坏数据或必然崩溃的缺陷）。

| 等级 | 风险 | 关联缺口 | 依据 |
|---|---|---|---|
| P1 | 数据丢失风险取决于用户自觉：备份完全手动，无调度 | G04 | data-safety.mjs:132；app.js:144-146 |
| P1 | 默认 loopback + 无 token 时 DNS rebinding 绕过 Origin 校验，owner API 全量读写暴露 | G05 | server.mjs:26,31-39（设 RADAR_OWNER_TOKEN 即免疫） |
| P1 | Windows 开发机 `npm run check` 必然红（4 个环境性失败），本地回归信号失真 | G03、G17 | 见 1.3；CI 仅 ubuntu-latest |
| P2 | CI live 门禁外部脆弱：catalog-probe 依赖 v2ex/HN/StackExchange 对 GitHub runner 可达；agent-github-evidence 依赖外部仓库 CavinHuang/opportunity-radar 固定历史提交 ace6e15 永久可读 | — | catalog-probe.yml:25；agent-github-evidence.yml:26-30 |
| P2 | CI 冗余：同一套件单次 CI 执行两次（npm test + check 末尾再 npm test）；push+PR 双触发且无 concurrency 组，PR 分支整体跑两遍 | — | ci.yml:2-14；package.json:17 |
| P2 | Node 版本基线不统一：engines >=22.16.0，ci.yml/browser-smoke/catalog-probe 用浮动 "22"，agent-github-evidence/readme-screenshots 固定 22.16.0 | — | package.json:7；各 workflow |
| P2 | 文档漂移：docs/IMPLEMENTATION_STATUS.md 停留在 v0.3（2026-10-10），与 v2.8.0 严重脱节，未记录 v2.1–v2.8 任何能力 | — | IMPLEMENTATION_STATUS.md:11 |
| P2 | 长期运行性能线性衰减：events 只增不清、每请求全量 JSON.parse、O(n²) 聚类 | G22、G06 | db.mjs:11,17；discovery.mjs:55-69 |
| P2 | 工程杂项：artifacts/ 不在 .gitignore（本地跑 browser-smoke 会留未跟踪文件）；.gitignore 预留 coverage/ 但无工具产出；browser-smoke.py 与 capture_screenshots.py 端口硬编码（49619/49177）无回退；node:sqlite ExperimentalWarning 混入测试输出 | G16 | .gitignore:7；scripts/browser-smoke.py |
| P2 | 数据库层无约束/级联，且全仓无任何实体的删除/归档端点：孤儿记录无防护、项目 stopped 后不可复用为其他状态 | G06 | db.mjs:10；观察记录 |

另有两处**行为口径风险**（经复核确认，修复前注意）：账本条目 `at` 恒为服务器当前时间，不能补录历史日期（service.mjs:210），而 product_feedback 的 observedAt 可以（delivery-trace.mjs:57-59），口径不一致；resume 把 status 置回 'research' 但不动 stage（service.mjs:124-125），promotion/review 阶段暂停后恢复会出现读模型不一致。

### 4.2 建议（按投入节奏）

**立即（低成本高收益）**
1. 部署默认设置 `RADAR_OWNER_TOKEN`，并为 protectOrigin 增加 Host 头白名单（G05，一处小改全免疫）。
2. 修 Windows 测试：after/finally 钩子的 rmSync 增加重试（`fs.rmSync` 的 `maxRetries/retryDelay`）或容忍 EPERM；pilot-journal 的 chmod 断言按平台条件跳过（G03/G17）。
3. events 表轮转/保留策略（按 seq 或时间裁剪）（G22 部分）。

**短期（一个迭代内）**
4. 排期到期消费：在 projectPipeline 的 nextActions 或 source-scheduler 的 tick 中消费 plannedAt，产出"今日应发布/已逾期"行动项（G08，数据已存在只差读取方）。
5. decisionReview 两处修正：pendingAcceptance 增加 `s.baselineRevision===baseline?.revision` 过滤（对齐 project-pipeline.mjs:10）；missingMetrics 增补 refund（建议连同 service_cost/transaction_fee）或在 netKnownCash 明示"未记录退款按 0"口径（G09/G10）。注意同步修正 tests/experiment-decision.test.mjs 的固化 fixture。
6. 契约测试补齐：analyze / contents/generate / verify / retry / schedule / owner-tasks 六条路由的 HTTP 层用例 + CSP 响应头断言（G13/G14）。
7. scheduledRevision 处置二选一：删除该字段，或在 publish_record 时真正比对（G07）。

**中期（结构性投入）**
8. list 分页 + getFullProject 读模型缓存；孤儿记录防护可先做应用层删除级联（G06）。
9. schema 版本框架：启用 PRAGMA user_version + 启动迁移器（G18）。
10. 引入 ESLint/Prettier、node --test coverage、dependabot（G16）；补 browser-smoke 的 history 视图导航与语言切换断言（G12）。
11. Owner 创建类端点接入 store.idempotent（复用现有 db.mjs:27-31 机制即可）（G19）。
12. 前端加载骨架 + 渲染层 try/catch 兜底（G23/G24）；删除 scanFeeds 死代码（G21）。

**明确不做 / 勿重复开发**：发布版本围栏（已由 approvedRevision 实现）、Agent 工具幂等（已完备）、SSRF 防线、备份恢复闭环、G4/G1 证据门——均已达标（见第 2 节与第 5 节）。

---

## 5. 被复核驳回的结论（防止重复开发）

### 5.1 总声明

本次独立复核覆盖 10 条审计条目（#1、#5、#10、#13、#14、#16、#17、#18、#31、#32），**没有任何原始结论被整体驳回，"已驳回"计数为 0**。所有经复核的缺口均成立；其中 6 条由保守判定升级（#1、#16、#17、#32 由 partial 升为 confirmed；#14、#31 的 missing 被确认为"完全缺失而非部分"），#5 的 partial 判定被确认准确。以下列出复核中的**修正、降级与边界澄清**，其作用同样是防止后续把"已实现的东西"当缺口重复开发，或按错误事实开工。

### 5.2 修正与"勿当缺口重复开发"边界清单

1. **【最重要】"排期发布版本围栏缺失"不成立（条目 #13 复核驳回其引申）**：排期→发布的安全属性已由 approvedRevision 围栏完整实现——排期时 service.mjs:189 同步推进 approvedRevision、编辑时 :177 清空审批、发布时 :201 以 `approvedRevision===revision` 把关，排期动作另有 expected_revision 校验（:182）。"编辑/改版后内容不得按旧批准状态登记发布"已生效。scheduledRevision 本身只是只写不读的死字段（删除不改变任何行为）——**勿为其重新开发围栏逻辑**，正确动作是删除或在发布时消费（G07）。
2. **"项目归档（archived）状态"不存在（条目 #5 复核措辞修正）**：'archived' 从未被赋值，仅出现在 9 处守卫数组（service.mjs:18,71,75,123、owner-tasks.mjs:12、project-pipeline.mjs:16 等）；实际仅有 pause/stop/resume。若按原审计描述为"归档后的 experiment 机会"实现出口，请基于真实状态集合（experiment 卡死 + triage 409）设计，且注意实际退出路径比原描述**更少**。
3. **"26 个测试文件"是审计提问中的事实错误**：实测 `ls tests/*.test.mjs` 为 **27** 个，总用例 156。后续规划测试工作量请以 27/156 为基线（条目 #20 note）。
4. **带乐观锁的 owner 写操作无需再加去重/防抖兜底（条目 #47 边界）**：triage、status 变更等带 expected_revision 的操作双击只会得到 409 `REVISION_CONFLICT`，无数据风险；幂等键缺口仅限**创建类**端点（POST /api/opportunities、/api/experiments、/api/projects/:id/ledger 等）。勿为前者重复建设防重机制。
5. **scanFeeds 是未引用死代码，不是在用漏洞（条目 #53）**：生产代码仅引用 parseFeed/configuredFeeds；处置是删除或转发到 source-hub 安全实现，不需要紧急修补。
6. **嵌套事务无现役调用路径（条目 #44 边界）**：已核对全部事务调用方（server.mjs:93、service.mjs:37,73,90,144、source-hub.mjs:161,200、delivery-trace.mjs:48、discovery.mjs:155），当前无嵌套调用；属未来脆弱点（误用会 500，外层 rollback 兜底不损坏数据），不是现行为缺陷。
7. **行号引用偏移修正（条目 #10 复核）**：原审计引 service.mjs:84-87 描述 researchBasis 写入，实际 84-85 为里程碑创建，写入在 82-83、事件在 87——实质结论不受影响，开发时以复核行号为准。
8. **复核升级警示（防止低估）**：#1（数据模型缺失）、#14（排期到期消费）、#16（pendingAcceptance 基线泄漏——旧 pending 连 reject 都被 BASELINE_STALE 堵死）、#17（refund 按 0 扣减且被测试 fixture 固化）、#31（history 视图零 E2E）、#32（AI 路由零 HTTP 测试）均比原始判定**更严重或更彻底**，排期时勿按 partial 的保守口径压缩工作量。

---

*本报告由审计数据整理而成（2026-10-11）。证据标注 `文件:行` 均出自审计记录（静态阅读 + 运行时探针 + 独立复核）；db.mjs 相关行号已经撰写时抽查核实。文中"未复核"条目表示仅有原始审计结论、未经二次独立复核，开发前建议先按条目内证据快速自验。*
