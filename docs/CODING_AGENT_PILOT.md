# v1.3 · 真实 Coding Agent 接入试点

本工具让已经在本机安装、登录的 **Codex CLI** 或 **Claude Code CLI** 在明确的 Git 工作目录里执行雷达已批准的任务。它不附带模型、不会替你进行模型登录，不会自动创建 PR、push、合并或人工验收。

## 准备

1. 安装 Node.js 22.16+；从 GitHub 克隆 Opportunity Radar，在本机运行 `npm start`。
2. 在 Radar 的「当前主实验」点击 **准备首个研发任务**；复制项目 ID。确保 `.env` 设置 `RADAR_AGENT_TOKEN`，同一 Token 用于 Pilot HTTP Agent API。
3. 在要开发的**目标工程 Git 仓库**建一个独立的功能分支，配置 `origin`，保持工作树干净。**不要在 main/master 上启动编码工具。**
4. 在本机安装并登录 Codex CLI 或 Claude Code CLI。账号和额度由对应编码工具自己管理。
5. 如需提交产品 PR，请确保目标仓库在 GitHub，`origin` 对应目标 PR 的 base 仓库。产品是否满足要求需要额外人工复核。

> 代码工具运行时可以读取其工作区内的文件和自身可访问的系统配置。虽然桥接器不会向子进程传入 `RADAR_AGENT_TOKEN`、`RADAR_OWNER_TOKEN`、`GITHUB_TOKEN`，但**这些密钥如果保存在目标工作区中的文件里，仍可能被编码工具读取**。请使用隔离的开发工作区，不要把秘密放进目标仓库。

## 可执行命令

在 Radar 仓库执行以下命令（将 ID、目标工作区路径及提交信息替换为真实值）：

```bash
npm run agent:pilot -- doctor --project <PROJECT_ID> --workspace /path/to/your-product --provider codex

npm run agent:pilot -- plan --project <PROJECT_ID> --workspace /path/to/your-product

npm run agent:pilot -- run --project <PROJECT_ID> --workspace /path/to/your-product --provider codex --confirm

# 或改用 Claude Code:
npm run agent:pilot -- run --project <PROJECT_ID> --workspace /path/to/your-product --provider claude --confirm

# 先人工检查文件、执行测试、commit、push，创建真实 GitHub PR，再执行：
npm run agent:pilot -- submit --project <PROJECT_ID> --workspace /path/to/your-product \
  --pr https://github.com/owner/repo/pull/123 \
  --sha <ACTUAL_40_CHARACTER_SHA> --confirm
```

可用 `--task <TASK_ID>` 明确指定任务；否则默认取第一个未领取、依赖已满足的任务。 `RADAR_BASE_URL` 默认为 `http://127.0.0.1:4177`。Pilot 仅允许直连 loopback HTTP；远程部署建议使用 **SSH localhost 隧道** 而非把 Agent Token 暴露到公网。

### 四个命令的语义

| 动作 | 副作用 | 成功意味着 |
|---|---|---|
| doctor | 只读 API + Git 状态 + 编码 CLI 版本 | 配置具备启动条件，**不证明模型账号已正确认证** |
| plan | 只读项目与任务 | 产生符合当前 Baseline 的编码指令，不领取任务 |
| run | 显式 `--confirm` 后领取任务、调用本地编码 CLI、定时续租；最后释放责任 | 编码命令正常退出，**不等于代码测试通过、PR 已创建或产品验收成功** |
| submit | 显式 `--confirm` 后校验工作区 HEAD/仓库 origin；**通过 GitHub API 校验 PR 当前 head SHA**；提交待核验的证据与交付申请 | 交付正在等待独立 G1 CI 核验及 Owner G4 验收，**不会自动标记成功** |

Codex 执行的是 `codex exec --sandbox workspace-write --cd <workspace> -`；Claude Code 使用 `claude -p --permission-mode acceptEdits`。两者都从 stdin 获取动态生成的指令，**不使用 shell 拼接命令**。默认提示指令明确禁止自动 push、发 PR、发布或宣称客户验证成功。请遵守各工具本身的权限与沙箱设置；提示词不等同安全沙箱。

## 失败与恢复

- `DIRTY_WORKTREE`：先处理未提交改动；避免 Pilot 混淆之前的实际工程成果。
- `UNSAFE_BRANCH`：不要在 `main/master` 或 detached HEAD 上启动。
- `CODING_TOOL_MISSING`：安装 Codex/Claude Code CLI 后在命令行用 `--version` 检查。
- `BASELINE_STALE`、`DEPENDENCY_UNMET`：回到 Radar 更新任务或基线。
- `TASK_CLAIMED`、`RECONCILIATION_REQUIRED`：旧进程可能仍在运行。先检查真实外部进程、代码工作区和部署副作用；不能强行绕过租约接管。
- `PR_HEAD_MISMATCH`：GitHub 上的 PR HEAD 与本地 SHA 不一致，先完成 push/同步再提交。
- `PR_NOT_ACCESSIBLE`：使用可访问的目标仓库；私有仓库配置只读 GitHub Token。
- `EVIDENCE_NOT_VERIFIED`：在 Radar 由 Owner 点击独立 GitHub 核验，等待确切 SHA 的必需 CI 成功后再按实际原型进行验收。

### 已验证与待验证

本版自动化测试使用真实临时 Git 仓库、Node 子进程和 Radar 领域 API，覆盖配置拒绝、环境变量隔离、工作区/commit/PR 三重约束、待核验交付和 Agent 不能自批准。**测试中的编码子进程不是 Codex/Claude 真正运行。**

仍须在你自己的开发机器上完成真正的 Coding Agent 执行、产出可运行代码、创建 GitHub PR、独立 CI 验证、Owner G4 验收。不要把自动化测试成功计作真实消费者价值验证。

## v1.4：中断后的交付恢复

当 Codex / Claude Code 本身退出，但 Pilot 未能及时收到结果，**不要直接再次启动另一个编码进程**。先确认旧编码进程已经结束，检查 Git 工作区是否有未提交改动、远程分支是否发生推送或部署等副作用。

```bash
# 查询项目所有任务与交付申请，绝不输出租约凭据
npm run agent:pilot -- status --project <PROJECT_ID>

# 任务有过期租约、且你已检查旧进程及其副作用时，由你手动解除
npm run agent:pilot -- recover --project <PROJECT_ID> \
  --task <TASK_ID> \
  --recovery-note "Checked process, workspace changes and deployment side effects" \
  --confirm
```

注意：`recover` **不能接管尚有效的租约**，没有外部副作用核对说明也会被拒绝；系统不检测或杀死外部进程。

### 交付阶段重试

```bash
npm run agent:pilot -- submit --project <PROJECT_ID> --task <TASK_ID> \
  --workspace /path/to/product \
  --pr https://github.com/owner/repo/pull/123 \
  --sha <FULL_40_CHARACTER_SHA> --confirm
```

- `submit` 每次都要求本地 HEAD 与目标 PR 当前 HEAD 精确一致；GitHub PR 无法查询就拒绝修改任务状态。
- 证据、任务转为 submitted、handoff 三步都支持中断后重试。再次提交相同的 SHA / PR 会复用现有证据与交付申请，而不是重复创建。
- 如果前一次任务转换完成而 handoff 未完成，明确指定同一 `--task` 继续。
- **不能重复提交已被 Owner 拒绝的 SHA**：修改代码、生成新提交、push 更新 PR，通过检查后用新 SHA 再次交付。
- 一个项目有多个可交付任务时，必须带 `--task`；不能靠列表顺序猜测。
- 失败时，Pilot 尝试释放自己所拥有的有效租约；如果发生不可恢复的网络断开，必须在租约过期后核对外部情况，再执行恢复。

### 验证边界

测试覆盖真实 Node HTTP Agent 认证、SQLite、临时 Git 仓库和故障注入；故障注入仍为自动化模拟，不能证明本机 Codex/Claude 已经完成真实交付。应用不自动创建或合并 PR，也不授予自己 G4 验收权限。
