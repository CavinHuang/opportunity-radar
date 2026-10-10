# Agent 交付、返工与恢复联调说明 · v1.2

## 1. 环境准备

- Node.js 22.16+，启动雷达：`npm start`，默认只绑定 `127.0.0.1:4177`。
- 如需独立的远程 MCP HTTP 客户端，设置私密的 `RADAR_AGENT_TOKEN`；如需从 Web 访问 Owner 专属操作，设置 `RADAR_OWNER_TOKEN`。
- 推荐首选 MCP stdio：在雷达仓库内运行 `npm run mcp:stdio`，它从本地 `RADAR_DB` 读取 SQLite。**此模式拥有本地文件的访问权限**，应只向可信 Agent 开放；系统本身不会启动或杀死 Agent。
- 正式 GitHub 核验需 `GITHUB_TOKEN` 以及真实必需检查名称 `RADAR_REQUIRED_CHECKS=test`。检查名称需按目标仓库实际工作流核对。缺少授权或检查时不得称为已通过。
- 用户应独立打开真实产品和目标 GitHub PR/CI，并亲自在 G4 阶段作出接受或退回决定。

## 2. 端到端执行步骤

1. 由 Owner 完成用户研究，批准独立的产品基线；在「当前主实验」点击 **准备首个研发任务**。
2. 外部 Coding Agent 先调用 `project.get_context`，核对 `baseline.revision`、验收条件和已批准预算；再调用 `project.get_next_work`。
3. 用 `task.claim` 携带 `project_id`、`task_id`、`baseline_revision`、`expected_revision`、唯一幂等键领取任务。只在租约有效时修改任务。
4. 真正研发时在**目标仓库**提交代码，发起 PR，等待该提交的必需 GitHub CI 完成。调用 `evidence.attach` 关联该准确 SHA、里程碑和验收条件；`handoff.submit` 发送交付申请。
5. Owner 触发证据核验，检查确切 commit、PR HEAD、必需 Check Run 和原型；只有符合 G1/G2 后才可能人工通过 G4。
6. 如果 Owner 退回交付 A，对应已提交任务回到 `rework`，记录拒绝原因与旧 SHA，旧责任租约失效。Agent 重新领取、修复并提交 **不同 SHA 的 B**，再次完成 G1/G2/G4；不得沿用 A 的核验结果。
7. Agent 进程中断时，不能把超时等同外部进程已停止。租约到期后的 `task.claim` 必须包含 `recovery_checked=true` 和有事实依据的 `recovery_note`。重连后通过 `project.get_context` 与 `project.watch_changes` 核对最新状态，再尝试恢复。
8. 修改正式产品 Baseline 后，旧基线下的任务不能再领取或继续写状态。Owner 应重新创建当前基线的首个研发任务。

## 3. 已完成的自动化证据与真实验收的区别

| 测试层 | 本版自动化能验证 | 不代表 |
|---|---|---|
| 真实 MCP stdio 子进程 | JSON-RPC、任务领取、幂等键、状态、拒绝 A 与以 B 再提交、断连/过期租约/受控重取 | 生产 Coding Agent 实际写出软件 |
| SQLite + Owner 规则 | 禁止 Agent 自己验收；拒绝时任务转返工；基线隔离；旧 fencing token 无法重写 | 生产数据已验证 |
| Live GitHub probe | 从真实 GitHub API 核实**此前已经成功运行 CI 的已知提交**的准确 SHA 和 `test` Check Run；错误 SHA 不可继承 | 本次 Agent 真实 PR 通过、用户已批准 G4 |
| Chromium E2E | 浏览器直连 Node + 临时 SQLite，检查真实界面和状态提示 | 真实互联网消费者参与或市场需求成立 |

运行本地自动化：`npm run check`。GitHub Actions 中的 `Live GitHub evidence verification` 将单独访问公网 GitHub，使用上一轮已经成功完成 CI 的固定提交，避免当前 CI 等待自己的运行状态。可在 GitHub Actions 手动触发重新探测。

## 4. 仍然需要人工执行的 T1–T3 真正验收

- **T1**：给一个可信外部 Coding Agent 一个实际工程任务，保存其真实提交 SHA、PR、工作流运行、能使用的原型、G4 用户验收结果。
- **T2**：Owner 对真实 A 版本提出可复现的体验缺陷，Agent 自行修复出真实 B 版本，再次独立检查 CI 并由 Owner 验收。
- **T3**：实际终止/重启 Agent 进程并检查外部副作用，确认无重复写入/部署，保留事件与租约前后证据。
- 本轮自动化只验证规则与实际协议过程；**不能把自动化测试脚本当作专业 Coding Agent 自主开发完成的证据**。

## 5. 常见故障

- `BASELINE_STALE`：刷新项目上下文，用户检查当前基线，重新准备/领取有效任务。
- `DEPENDENCY_UNMET`：前置任务未标记已提交，先处理依赖。
- `TASK_CLAIMED`：存在尚有效的租约，不要并发重领。
- `RECONCILIATION_REQUIRED`：旧租约过期，先查看真实外部执行情况，再提供核对记录重领。
- `LEASE_INVALID`：token 过期或被撤销，不能覆盖已由新的任务持有人提交的事实。
- `EVIDENCE_NOT_VERIFIED` / `GITHUB_G1_REQUIRED`：核查 commit SHA、PR HEAD、所需检查的完整结果；用户不能用手动确认绕过 GitHub 核验。
- `SUBMISSION_SUPERSEDED`：已有更新版本交付，旧版不可验收。
