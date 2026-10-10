# Northstar · Personal Opportunity Radar

> 个人 To C 机会雷达：发现真实问题 → 批准最小实验 → 外部 Coding Agent 交付 → 真实证据验收 → 创作者宣发 → 收益复盘。

这是依据已批准 **PRD V1.2 / Agent Handoff V1.3** 开始实现的 **v1.1 本地运行版本**，不是已完成真实消费者试点的产品。支持简体中文与 English，界面以轻量项目进度和决策为中心。

## 界面截图 / Screenshots

> 以下为**真实应用前端截图**，使用隔离的临时 SQLite 数据库和明确标记为 `[DEMO]` 的记录，不代表真实消费者研究。截图环境限制 Chromium 直接访问本地 HTTP，脚本将浏览器 API 请求转发给真实本地服务；这不等于完成直接联网的浏览器 E2E 验收。

**机会简报 · 简体中文**

![Northstar 机会简报（演示数据）](docs/screenshots/dashboard-zh.webp)

**信息源管理与原始信号工作台（演示数据）**

![Northstar 信息源与信号管理](docs/screenshots/sources-zh.webp)

**Agent 接入中心 · English**

![Northstar Agent connection (demo data)](docs/screenshots/agent-setup-en.webp)

复现方式：`python scripts/capture_screenshots.py`（需要 Python Playwright、Pillow 和 Chromium）。脚本使用临时数据库，不修改真实项目。

## v1.1 · 用户研究到产品交付的可追溯闭环

- 完成 Owner 主动批准并最终关闭为 **continue** 的用户研究计划后，可将该研究决策关联到新产品实验；仍进行中、其他机会或以调整/停止/证据不足结束的计划不能被伪装为获批准研究。
- 在产品基线中固定该研究决策的摘要、反证数量和局限，外部 Coding Agent 可通过 `project.get_context` 读取不含参与者代号和逐字访谈的研究概览。
- 兼容既有未关联研究的项目，明确标注 **unlinked**，不伪称真实消费者需求成立；正式产品目标、范围、预算与启动执行仍由 Owner 独立审批。
- 产品研发里程碑正式由 Owner 验收后，项目「结果与复盘」可记录匿名、取得同意的真实使用反馈（核心任务、再次使用、障碍、需求），无产品验收则拒绝记录交付后的使用行为。
- Owner-only `GET/POST /api/projects/:id/feedback`。反馈始终是 **Owner-reported / 未独立核验**，与收入、获客和用户使用的自动分析系统相区分。

[研究到交付使用说明](docs/RESEARCH_TO_DELIVERY.md)

## v1.0 · 真正的开发前消费者验证

- 每条机会新增 **用户验证**：明确目标消费者、可证伪假设、接触渠道、成功证据、停止条件、下一步和 10 小时以内的研究预算。
- 用户手动记录获得同意的匿名访谈与真实行为，分别标注支持、反驳和不确定，支持附上可复查的 HTTPS 证据链接。**禁止用虚构示例当成真实访谈**。
- 一轮验证由 Owner 亲自选择 **继续 / 调整 / 停止 / 仍未知**，必须写出依据。没有观察不能作出继续投入决策，继续也不代表批准产品研发。
- 浏览器提供查看与编辑完整工作流，SQLite 持久化、计划版本校验、Owner-only API 及测试。已批准的产品实验与 Coding Agent 项目机制没有被改变。
- 记录中的“匿名参与者”和“访谈结果”均是人工填写而非外部核实；仍必须开展真正的消费者招募，不能把应用测试数据当作市场验证。

## v0.9 · 真实来源的质量反馈

- 在 **信息源与信号** 页面显示当前数据的质量反馈：全局去重信号、关联机会、含人工核查经历的来源，以及采集异常。
- 每个来源显示该来源收录、收藏、忽略、关联机会数，及关联证据中人工阅读过的原文与第一手经历分类。
- 直接点击 **研判该来源**，进入该来源的待处理信号队列；保存、忽略、关联或回到机会研究时，计数由现有 SQLite 记录实时计算。
- **来源计数不可相加为独立消费者数**：同一 URL 可以出现在多条订阅中；同平台同作者的两篇帖文不会自动算作两个独立的人。
- “第一手经历”仅为 Owner 阅读原文后的人工分类，没有核验发帖者身份；**采集量和关联数都不证明需求规模、付费意愿或真实留存**。
- 新增 Owner-only `GET /api/source-quality`，返回实时观察统计，不依赖 AI，也不保存凭空生成的质量评分。

## v0.8 · 精选信息源与可解释的机会证据

- 可选安装六个问题型 RSS 频道：V2EX 问与答/生活/Apple、Ask HN、Super User 与 Web Applications。**默认不安装，也不把订阅当作消费者验证。**
- 新增来源筛选和公开作者署名（如可获得），从原始信号到机会可保留来源关系。
- 机会池新增 **研究证据**：原始链接、人工核查的第一手经历、独立性、反对理由、证据缺口及下一次访谈建议；不输出虚假的市场概率、收入与付费意愿。
- 允许 Owner 核查原文并写下独立性理由；只由文字标题相似不能自动关联用户需求。
- **外网来源测试**：`npm run catalog:probe`；开发容器无法解析公网 DNS，远程 Actions 单独报告实时状态。

[精选信息源研究](docs/CURATED_SOURCES.md) · [信息源工作台说明](docs/SOURCE_DISCOVERY.md)

## v0.7 长期采集与来源健康状态

- **按来源计划采集**：每个已启用来源可以设置 15–1440 分钟的采集间隔（默认 360 分钟）。服务启动会扫描已经到期的来源，之后每分钟检查一次是否有到期任务；不会每分钟重复下载全部来源。
- **条件请求**：服务保存 RSS `ETag` / `Last-Modified`，下次发送 `If-None-Match` / `If-Modified-Since`；遇到 HTTP 304 会更新健康状态，不会重复导入信号。
- **失败恢复**：连续网络或源错误会将后续采集逐级延后（上限 24 小时），尊重 `Retry-After` 限制；扫描成功后恢复设定的正常间隔。错误次数、最近成功、下次计划均持久化，重启后保留。
- **避免竞争**：手动扫描与后台扫描不会并发写同一份信号；若已有扫描进行中，返回明确的 `SCAN_IN_PROGRESS`（HTTP 409），需要等待再试。
- **来源可观察**：在来源页面查看「已启用 / 到期 / 异常」聚合状态，逐来源显示间隔、下次运行和连续失败次数；`GET /api/sources` 包含 `health`，`/api/health` 包含 `sourceHealth`。
- **已有数据兼容**：旧订阅缺少计划字段时使用默认间隔；更改关键词将重置条件缓存并尽快重新采集，避免此前过滤掉的文章无法被重新发现。

采集基于公开 RSS/Atom，**不保证所有来源全天候可用，也不将 RSS 文章直接视为已证实的消费需求**。RSS 的公网 DNS 预检有防护但不构成独立的完整网络沙箱；不要将该服务暴露到不可信网络。源码与测试详见 `src/source-hub.mjs`、`src/source-scheduler.mjs` 及 `tests/source-reliability.test.mjs`。

## v0.6 信息源与机会发现

- 页面中直接管理公开 RSS / Atom 来源：添加、编辑、暂停、恢复、手动扫描，查看采集结果与失败原因。
- 支持关键词、目标市场、信号搜索、分页、收藏、忽略与恢复；原始来源 URL 保持可追溯。
- 已收藏信号可转换为新的消费者机会，或关联已有机会；重复导入受保护。
- 不提供 RSS 的网站可手动保存公开网页线索，避免自动推断消费者的真实需求。
- 周度高优先级机会仍控制在 3 项，但支持查看完整机会池，而不是隐藏其他机会。
- 支持可选的公开订阅源模板；不会在未授权时自动抓取私密内容。
- 详细使用方法参见 [信息源与机会发现使用指南](docs/SOURCE_DISCOVERY.md)。

> README 截图由真实前端和独立的演示 SQLite 数据库生成。演示信息不是经过用户访谈验证的需求，也不能等同于真实市场机会。

## v0.5 Agent 接入中心

- 在「当前主实验 → Agent 接入」查看 Agent API 的配置状态、12 项 P0 工具、有效租约、待领任务及同步信息。
- 复制 MCP stdio 命令、HTTP MCP 地址与当前实验 ID；页面**不会暴露 Agent Token**。
- 新增由 Owner 权限保护的只读 API：`GET /api/agent/setup?project_id=<project-id>`，提供安全的集成概要。
- 支持中文与英文切换，离线状态不冒充正在运行。雷达不管理外部 Agent 进程。

## 运行

要求 **Node.js 22.16+**；无需数据库安装或 `npm install`，使用 Node 原生 SQLite，初期会看到 Node 实验性功能提示。

```bash
cp .env.example .env
npm start
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm start
```

浏览器打开 **http://127.0.0.1:4177**。数据默认保存在 `.data/radar.sqlite`（不会纳入 Git）。第一次打开没有模拟市场数据，这是刻意的设计。

默认仅监听本机。需要给其他设备访问时，先配置高强度的 `RADAR_OWNER_TOKEN`，使用 HTTPS 反向代理和可靠的网络访问控制；不要把本地 HTTP 服务直接暴露到互联网。

### 可选配置

编辑 `.env`：

```ini
RADAR_PORT=4177
RADAR_OWNER_TOKEN=your-private-owner-token
RADAR_AGENT_TOKEN=your-separate-agent-token
GITHUB_TOKEN=github-read-only-token
RADAR_REQUIRED_CHECKS=test
RADAR_FEED_URLS=https://your-approved-source.example/rss
RADAR_LLM_BASE_URL=https://api.deepseek.com
RADAR_LLM_MODEL=deepseek-chat
RADAR_LLM_API_KEY=your-private-api-key
```

- `RADAR_AGENT_TOKEN` 独立于用户令牌，用于授权外部 Coding Agent 的 HTTP 工具调用；未设置时 Agent API 禁用。
- `GITHUB_TOKEN` 用于读权限范围内的 GitHub commit、PR、check runs 核验。公开仓库可尝试免 Token，但频率和权限有限。无法读取时将保留 **pending**，不会自动判成功。
- `RADAR_FEED_URLS` 最多五个用户指定的 HTTPS RSS/Atom 来源；配置后由来源独立的采集计划调度（默认每 6 小时），也可以手动扫描。原始文章只是「公开信号」，需你确认后才进入机会池。
- `RADAR_LLM_*` 可选 OpenAI-compatible Chat Completions 接口：帮助从真实信号起草机会分析、根据已验收功能准备宣发草稿。**LLM 输出从不直接成为已验证事实**。上传的信号和项目概要会发送给你选择的提供商。

## v0.3 交付可靠性更新

- **不可变验收基线同步**：修改验收要求后，自动对齐产品交付里程碑；旧基线提交不能直接验收。
- **提交证据隔离**：证据必须属于该里程碑，验收前检查是否为最新且尚未处理的提交。
- **GitHub 必需 CI 检查**：仅检查配置的必要检查，对应准确的 40 位提交 SHA；重跑失败、运行中或版本不一致不予通过。可选检查失败不会误阻塞。
- **防止人工绕过 G1**：GitHub 证据不能通过手动备注代替真实 GitHub API 检查；产品原型交付必须具有已核验的 GitHub CI 证据。
- **强幂等重试**：同一幂等键重放相同请求会返回原结果；换用其他操作或参数会明确返回 `IDEMPOTENCY_CONFLICT`。升级已有数据库时会自动增加签名字段；旧版写入但未记录签名的键请重新生成，避免重放不安全结果。

## 当前可用的功能

| 体验 | 实际范围 |
|---|---|
| 机会简报 | 手动录入消费者问题及来源 URL、URL 去跟踪参数去重、0–3 个本周候选、RSS 信号扫描、可选 AI 分析 |
| 实验决策 | 一个主实验、批准时锁定目标/验收/10 小时基线/现金上限/停止条件、版本化修订 |
| Coding Agent | 12 项业务工具，支持 HTTP/JSON、现代 MCP Streamable HTTP 与 MCP stdio（兼容模式）；P1 多 Agent `collaboration.handoff` 不启用 |
| 项目进度 | 单页里程碑、Agent 自报、证据与人工验收分层，离线同步时间明确 |
| GitHub 证据 | 精确 SHA 校验、PR head 匹配、相关 Check Run 检查；不可访问或缺 CI 时不会通过 |
| 个人创作者宣发 | 内容包、可选 AI 起草、人工检查批准、用户手动发布、发布链接记录；禁止自动发帖 |
| 结果账本 | 真实/估计分离、曝光/试用/复用/收入/退款/直接成本、用户时间与 Agent 时间分开 |
| 历史与复盘 | 查看历史试验与预算版本，保留暂停记录 |

## 外部 Coding Agent 接入

使用独立 `RADAR_AGENT_TOKEN`，通过 `Authorization: Bearer <token>` 调用 12 项工具。不需要让 Agent 修改应用数据库。

```bash
# 查看首版可用工具
curl -H "Authorization: Bearer $RADAR_AGENT_TOKEN" \
  http://127.0.0.1:4177/api/agent/tools

# 获取已由用户批准的项目基线；PROJECT_ID 从项目 API/UI 获取
curl -X POST http://127.0.0.1:4177/api/agent/tools/project.get_context \
  -H "Authorization: Bearer $RADAR_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"PROJECT_ID"}'

# 在已批准的里程碑下新增任务（写操作需要幂等键）
curl -X POST http://127.0.0.1:4177/api/agent/tools/task.upsert \
  -H "Authorization: Bearer $RADAR_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"PROJECT_ID","milestone_id":"MILESTONE_ID","title":"完成最小原型","idempotency_key":"unique-call-001"}'
```

Agent 负责自行运行代码和提交交付结果；平台**不启动、管理或终止外部 Agent 进程**。任务租约过期后，重新领取需明确确认外部工作状态，以减少重复执行风险。项目批准基线、预算、正式验收、宣发授权只有用户能改。

查看 [Agent 工具契约](docs/AGENT_TOOL_CONTRACT.md) 了解预定字段；当前 HTTP API 的可用字段以 `src/service.mjs` 和测试用例为准。现已提供 MCP 接入方式，详见下文。MCP 只是传输适配，最终的项目验收和审批仍由 Radar 独立管理。

## MCP 连接专业 Coding Agent

### 方式一：本地 MCP stdio（兼容传统 Coding Agent 配置）

通过标准输入/输出 JSON-RPC 连接，不需要先启动 HTTP Web 服务；数据仍写入同一个 SQLite 文件。请仅在受信任的本机执行环境里使用，因为本地文件访问权限由操作系统管理。

```json
{
  "mcpServers": {
    "opportunity-radar": {
      "command": "node",
      "args": ["/absolute/path/to/opportunity-radar/src/mcp-stdio.mjs"],
      "env": {"RADAR_DB": "/absolute/path/to/opportunity-radar/.data/radar.sqlite"}
    }
  }
}
```

### 方式二：MCP Streamable HTTP（2026-07-28）

先在 `.env` 设置独立 `RADAR_AGENT_TOKEN`，运行 `npm start`，然后连接 `POST http://127.0.0.1:4177/mcp`，使用 `Authorization: Bearer <RADAR_AGENT_TOKEN>`。客户端须发送 `MCP-Protocol-Version`、`Mcp-Method`、必要时 `Mcp-Name` 与 `params._meta`；支持 `server/discover`、`tools/list`、`tools/call` 和 `ping`。此版本不使用远程会话。

为降低兼容性风险，HTTP 入口仅接受 2026-07-28 版本；stdio 入口实现老式 `initialize`/`tools/list` 流程。两者都只开放 12 项首版能力，且永远不能代替用户正式验收。`task.claim` 可凭有效 `lease_token` 续租，过期接管仍要求外部状态核对。

## 检查

```bash
npm test
npm run check
```

测试包含：权限分离、HTTP 真实往返、单主实验、证据去重、基线不可原地修改、写操作幂等/并发冲突、任务租约、Agent 自报与验收隔离、内容审批、现金记录、离线项目状态等。

CI：`.github/workflows/ci.yml` 已配置；真正的远程 CI 运行及证据仍需要在仓库更新后核验。

## 已知限制和下一阶段

本版为功能可运行的第一轮迭代，尚不能声称 **PRD V1.2 P0 / T1–T4 已正式验收通过**：

1. 未接入真实外部 Coding Agent 的完整开发—PR—CI—产品验收闭环；平台仅提供 12 项 JSON 工具，已提供 MCP stdio 与 HTTP 适配，但尚未完成真实第三方 Agent 的互操作测试。
2. 尚无被批准的真实 To C 消费者试点、真实用户反馈和真实收入。
3. RSS 来源需要你配置，公开信息只作为线索；LLM 内容需要另行提供密钥和人工审查。
4. 发布流程只记录**用户手动发布**，不自动登录社交账号或运行广告。
5. 内容的语义真实性需要用户核对；规则层校验来源字段不能代替真实事实核查。
6. 真正的 T1 正常交付、T2 返工、T3 外部 Agent 离线恢复、T4 消费者宣发闭环仍待真实测试。
7. 单机个人使用为默认设计，没有组织账户、跨设备同步或分布式锁。Node 原生 SQLite 仍处于实验性状态。

## 产品基线与安全边界

- 原始批准文件位于 `docs/PRD_V1.2.md`，以及对应的 Agent / 验收规范。
- 任何真实外部内容与代码仓库读取须获得权限，不公开个人隐私截图、用户私信或未授权素材。
- 所有模拟值（如测试用例中）仅用于自动化检查，**不会自动进入真实用户数据库**。
- 不把 AI 推断、页面浏览数、Agent 文本报告当作付费事实、真实需求或正式验收。

## GitHub 仓库

源码仓库：[CavinHuang/opportunity-radar](https://github.com/CavinHuang/opportunity-radar)。远程是否成功同步，以 GitHub 实际提交为准；本地 `.env`、`.data`、密钥均不进入 Git。

---

项目工作文档：[V1.2 PRD](docs/PRD_V1.2.md) · [Agent 业务契约](docs/AGENT_TOOL_CONTRACT.md) · [首版验收标准](docs/ACCEPTANCE_GATES.md)
