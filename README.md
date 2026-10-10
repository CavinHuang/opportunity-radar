# Northstar · Personal Opportunity Radar

> 个人 To C 机会雷达：发现真实问题 → 批准最小实验 → 外部 Coding Agent 交付 → 真实证据验收 → 创作者宣发 → 收益复盘。

这是依据已批准 **PRD V1.2 / Agent Handoff V1.3** 开始实现的 **v0.2 本地运行版本**，不是已完成真实消费者试点的产品。主界面为中文，界面以轻量项目进度和决策为中心。

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
- `RADAR_FEED_URLS` 最多五个用户指定的 HTTPS RSS/Atom 来源；配置后，运行中的应用每 6 小时扫描一次，也可以手动扫描。原始文章只是「公开信号」，需你确认后才进入机会池。
- `RADAR_LLM_*` 可选 OpenAI-compatible Chat Completions 接口：帮助从真实信号起草机会分析、根据已验收功能准备宣发草稿。**LLM 输出从不直接成为已验证事实**。上传的信号和项目概要会发送给你选择的提供商。

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
