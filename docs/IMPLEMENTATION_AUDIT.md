# Implementation audit · v2.9 Phase E（生产可靠性与用户体验）

Date: 2026-10-11
Branch basis: `feat/v2.9-phase-e-reliability`（基于 main @ 3880ed2，Phase D）

本文件是 Phase E 收尾时的实施审计：逐项说明「已有且保留的能力」「本阶段补齐的缺口」「验证方式」，以及**明确未完成、不得宣称的事项**。审计过程中未发现 `docs/` 内既有的 Phase E 审计结论（此前只有停留在 v0.3 的 `IMPLEMENTATION_STATUS.md`），以下结论均以本分支代码与实际运行的命令为准。

## 1. SQLite 版本与迁移

**既有且保留**：所有业务记录存于 `records(kind,id,json,revision)`，写入走乐观修订号（`src/db.mjs` `put`）；幂等表 `idem` 自 v0.3 起带 signature 列（自动迁移）。

**本阶段补齐**：
- `src/db.mjs`：新增 `SCHEMA_VERSION=1` 与迁移运行器，用 `PRAGMA user_version` 落盘版本；迁移 1 = 补齐 `idem.signature` 列 + 新建 `events_project_seq` 索引（仅缺失时执行，幂等）。
- **向前保护**：打开 `user_version` 高于当前应用的数据库会抛 `SCHEMA_TOO_NEW` 并拒绝（先关闭句柄再抛出，避免 Windows 文件占用），提示先升级应用。
- `data doctor` / `inspectRadarDatabase` 返回 `schemaVersion` 与 `sqliteVersion`（SQLite 引擎版本，如 `3.49.1`）。

**验证（本分支实际运行）**：`node --test tests/schema-migration.test.mjs` — 3/3 通过。覆盖：手工构造的「前版本」数据库（无 signature、无版本戳、无索引）原地迁移后行数据逐字节一致、旧幂等键带签名重放被拒（`IDEMPOTENCY_CONFLICT`）、重复打开不再重复迁移、`SCHEMA_TOO_NEW` 拒绝且文件未被改动、doctor 输出双版本。

## 2. 备份、恢复与完整性

**既有且保留**：`npm run data -- backup|verify|restore`（`src/data-safety.mjs`）已具备 WAL 一致快照（`VACUUM INTO`）、`integrity_check`、记录 JSON/revision 校验、SHA-256 manifest、只恢复到全新路径、恢复后复核摘要。**这些没有被重写。**

**本阶段补齐**：备份 manifest 新增 `schemaVersion` / `sqliteVersion` 溯源字段（仅记录，不作通过/失败门）；`verifyBackup` 对缺少新字段的旧 manifest 保持兼容（`tests/schema-migration.test.mjs` 第 3 用例验证剥离字段后仍通过校验）。

**边界（不变）**：校验和只防意外损坏，不防同时篡改备份与 manifest 的攻击者；备份为含私人资料的未加密 SQLite。

## 3. 输入校验、鉴权与资源边界

**既有且保留**：请求体 300KB 上限（413）、JSON 解析失败 400、同源 Origin 校验（403）、Owner/Agent 双令牌分离、非 loopback 绑定强制 `RADAR_OWNER_TOKEN`、各列表接口的 limit/offset 边界（`querySignals`、`sourceDiagnostics`、`ownerTaskHistory`、`growthHistory`、`growthReport` 窗口 ≤366 天等，均在各自模块内校验）。

**本阶段补齐**（`src/server.mjs`）：
- Owner 键与 Agent Bearer 令牌改为**常数时间比较**（`timingSafeEqual`，长度不一致时同样走等长哑比较以抹平计时差）。
- `/api/signals/scan` 对 `source_id` 增加字符串类型校验（非字符串 400），避免把对象/数字透传进扫描管道。

**验证**：`tests/phase-e-http-e2e.test.mjs` 用例 1 的边界段：401（错误 Owner/Agent 令牌）、403 `ORIGIN_DENIED`、400 `BAD_JSON`、413 `PAYLOAD_TOO_LARGE`、`limit=0`/`limit=99`/`offset=-5`/`source_id:123` 均 400。全套件 194/194 通过（`npm test`）。

## 4. 异步操作、并发提交与幂等

**既有且保留（审计确认，不需要重写）**：
- 所有写操作经 `BEGIN IMMEDIATE` 串行化（`src/db.mjs` `transaction`）；`busy_timeout=3000`。
- Agent 工具幂等：同一幂等键重放返回缓存结果，参数或工具名不同返回 `IDEMPOTENCY_CONFLICT`（`service.mjs` `withIdem`，签名=工具名+参数哈希）。
- 扫描并发：`scanSources` 进程内 in-flight 守卫，并发扫描返回 409 `SCAN_IN_PROGRESS`（`tests/source-reliability.test.mjs` 已覆盖）。
- 乐观修订号防丢失更新（`REVISION_CONFLICT` 409）。

**本阶段新增回归**：真实 HTTP 并发下，两个携带相同幂等键的并行 `task.upsert` 都返回 200 且只产生一条任务（`tests/phase-e-http-e2e.test.mjs` 用例 1）；服务端租约被盗领返回 409 `TASK_CLAIMED`。

## 5. 错误状态、空状态、加载状态与可操作恢复提示

**既有且保留**：各视图空状态文案（机会池、信号、证据、内容等）、`REVISION_CONFLICT`/`SCAN_IN_PROGRESS` 等错误的中文提示含下一步动作、401 时浏览器内令牌补录提示。

**本阶段补齐**（`public/app.js`、`public/style.css`、`public/i18n.js`）：
- **首次加载态**：数据未到达时显示「正在加载数据」面板，不再把未加载渲染成“空数据”。
- **错误恢复态**：页面加载失败显示持横幅错误卡（含原始错误信息、明示“数据保存在本机 SQLite，不会因此丢失”、重试按钮 `retry-load`）；首次失败不再只靠 3 秒即逝的 toast。
- **离线态**：`offline` 事件显示提示横幅（不要重复提交表单），`online` 自动重载；`aria-busy` 标注首载。
- **操作并发防护**：动作点击加 `S.busy` 双击防护（模态内提交原有禁用逻辑保留）。
- 导航按钮加 `aria-current="page"`；侧栏版本标注更新为 v2.9。
- 新增文案均有中英对照（`public/i18n.js` COPY 表，`tests/i18n.test.mjs` 14/14 通过）。

**未做（如实）**：未引入浏览器端自动化 E2E（无 Chromium 环境）；UI 状态变更以代码审查 + 既有静态资源 HTTP 测试为验证，真实浏览器回归仍需在可访问 localhost 的环境执行。

## 6. 长时间运行、意外重启、任务中断与数据恢复

**既有且保留**：来源调度器从持久化的 `nextScanAt` 恢复（`src/source-scheduler.mjs`，`tests/source-reliability.test.mjs`）；任务租约过期后接管必须 `recovery_checked` + 恢复说明（`service.mjs` `task.claim`）；备份/恢复 CLI。

**本阶段新增回归**（`tests/phase-e-http-e2e.test.mjs` 用例 2，真实 HTTP + 真实 SQLite 文件）：
- 写入业务数据后关闭服务与 SQLite 句柄（模拟进程退出），**独立 Node 子进程**（`data-cli doctor`）能打开同一文件并读到全部记录与 `schemaVersion=1`。
- 重启后（第二个 server 模块实例）机会、任务、**重启前签发的租约**全部保留；持有原 `lease_token` 可直接续租。
- 租约过期（模拟中断）后无核对说明不能接管（409 `RECONCILIATION_REQUIRED`），补充 `recovery_checked` + 说明后可接管并换发新令牌。
- 运行中数据库 backup → restore 到新路径 → 以全新连接打开，业务记录与任务租约完整。

## 7. 文档

- `README.md`：新增 v2.9 Phase E 说明段落。
- `docs/LOCAL_OPERATIONS.md`：新增 schema 版本、升级/降级处置、重启与中断恢复、完整性检查节奏章节。
- `docs/ROADMAP.md`：新增 v2.11 · Phase E 进度条目。
- 本文件（`docs/IMPLEMENTATION_AUDIT.md`）：最终状态审计。

## 8. 明确未完成 / 不得宣称

1. **真实浏览器 UI 回归未执行**：本环境无法驱动 Chromium 访问 localhost；UI 新状态的浏览器级验收（截图、交互）待具备条件的环境完成。
2. **SQLite 版本升级指应用 schema 版本管理**，不是更换 SQLite 引擎版本；Node 内建 `node:sqlite` 仍为实验性特性，引擎随 Node 升级，未做跨引擎版本的迁移矩阵测试。
3. **GitHub CI 核验在 E2E 中于网络边界 mock**（`api.github.com` 响应）；对真实 GitHub 的核验仍只能在具备网络与真实仓库的环境验证（既有 `probe-real-github-ci` 工作流用途不变）。
4. 自动化测试全部通过**不等于**：真实外部 Coding Agent 交付验收、真实消费者验证、长期运行的生产监控。PRD T1–T4 的正式验收仍需真实参与者。
5. 本应用默认单机使用；无跨设备同步、分布式锁或多用户隔离，未在本阶段改变。
