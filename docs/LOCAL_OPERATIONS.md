# v1.8 · 本地完整使用路径、数据安全与恢复验收

本版本面向**单机、本地优先、人工决策的个人机会雷达**。既有功能包括真实 RSS/Atom 订阅、定时采集、来源健康检查、原始信号归档、重复问题候选、人工核查与误报反馈、机会研究与验证计划、单主实验、专业 Coding Agent 桥接、GitHub 精确 CI 核验、成本与产品反馈。v1.8 修补可持续使用所需的首次使用检查及 SQLite 离线灾难恢复。

## 1. 第一次运行

需要 Node.js **22.16 或更高**。建议本机终端：

```bash
git clone https://github.com/CavinHuang/opportunity-radar.git
cd opportunity-radar
cp .env.example .env
npm start
```

Windows PowerShell：将 `cp .env.example .env` 替换为 `Copy-Item .env.example .env`。随后打开 `http://127.0.0.1:4177`。默认只监听 loopback，浏览器中可以直接管理数据。需要对其他设备开放时，请首先设置强随机的 `RADAR_OWNER_TOKEN`，并独立设置 HTTPS 与网络访问控制；不要把该应用的纯 HTTP 服务直接暴露到公网。

首次没有真实信号或消费者验证数据是正常情况。进入 **信息源与信号**，新建或安装一个真实公开 RSS/Atom，点击扫描，检查来源的最近成功时间和错误。首次使用面板会区别「已启用」「已实际采集成功」「已有人工研究线索」。无成功采集时，不能把安装模板称作来源连接成功。

## 2. 日常工作的完整路径

1. **订阅来源**：管理 RSS/Atom 与筛选关键词。已启用来源由服务器计划调度；默认 6 小时，服务停止期间不能自动采集。真实源可能出现频率限制、DNS、网络或格式变更。
2. **研判原始信号**：根据原始 URL 查看问题、署名与上下文，收藏、忽略或转换为研究机会；避免仅由标题推断真实消费者数量。
3. **研究重复问题**：候选组展示词汇匹配依据、疑似转载、来源差异与人工标注；组成员或内容变更后重新核查。
4. **验证机会**：亲自记录获得同意的匿名访谈与实际观察，区分支持/反证/不确定。只有 Owner 可以关闭研究计划、批准是否继续。
5. **批准实验与 Coding Agent**：建立目标、范围、预算、验收基线，显式准备研发任务。Codex/Claude 工具必须安装并完成登录。Pilot 的自动化子进程测试不是专业 Agent 的实际交付证明。
6. **验收与复盘**：保留 GitHub commit 精确 SHA、PR HEAD 与真实必需 CI；用户验收或退回后回到返工。真正的付费与使用行为需独立验证，不能由公开文章或 Agent 汇报代替。

## 3. 数据备份（服务器运行时也可进行）

应用默认数据库是 `.data/radar.sqlite`。来源、机会、访谈、Agent 任务、成本和研究决策都在同一份 SQLite 内；WAL 的新提交不能通过操作系统简单复制正在使用的主文件来可靠保存。

运行下列命令，**输出路径每次使用新的文件名**：

```bash
npm run data -- doctor
npm run data -- backup --output ./private-backups/radar-20261010.sqlite
npm run data -- verify --input ./private-backups/radar-20261010.sqlite
```

备份使用 SQLite 原生 `VACUUM INTO` 制作一致性副本，备份当时会通过 SQLite `integrity_check`、记录 JSON 与 revision 一致性验证，生成同名 `.manifest.json`，包含 SHA-256、记录数量与生成时间。校验命令重新读取 SQLite 与完整清单，不只是确认文件存在。

**请一起保存 `*.sqlite` 和 `*.sqlite.manifest.json`。** 它们是未加密的私人研究资料，不能发到公开仓库、网盘分享链接或团队聊天。建议使用自己控制的加密存储，并在另一块磁盘保留独立副本。项目 `.gitignore` 已排除默认 `private-backups/` 及 SQLite/清单文件，但仍应人工确认目标路径的访问权限。

Windows PowerShell 同样使用以上 `npm run data -- ...` 命令。Node 文件权限位在 Windows 上不能代替 NTFS ACL 或 BitLocker 等系统级保护。

## 4. 灾难恢复：不覆盖现有数据

确保原应用进程已停止。先验证备份，再**恢复到一个不存在的新文件名**：

```bash
npm run data -- verify --input ./private-backups/radar-20261010.sqlite

npm run data -- restore \
  --input ./private-backups/radar-20261010.sqlite \
  --destination ./.data/recovered-20261010.sqlite \
  --confirm
```

原数据库不会被覆盖。恢复命令在复制临时文件后校验 SHA-256 与 SQLite 完整性，成功才创建最终目标。发生损坏、清单不匹配或目标文件已存在时会失败，而非猜测或合并用户数据。然后将 `.env` 中的 `RADAR_DB` 设置为 `.data/recovered-20261010.sqlite`，重新运行 `npm start`，检查来源、机会、研究和项目记录，再决定是否迁移回主数据库路径。

Windows PowerShell 也可以在启动前运行 `$env:RADAR_DB = '.data/recovered-20261010.sqlite'`。启动后先检查业务数据，而不是删除原始文件。

## 5. v1.8 验收标准与已知限制

| 场景 | 验收方式 | 不应误认为 |
|---|---|---|
| 服务器运行中的 WAL 快照 | 真实 SQLite 文件和已提交业务记录的离线备份/校验/恢复测试 | 已有自动异地备份 |
| 损坏或伪造的备份清单 | 校验拒绝及不产生恢复目标 | 能抵抗蓄意修改者同时修改备份和清单 |
| 重复还原 | 新文件路径和显式 `--confirm` 门槛 | 在线热恢复或自动合并历史 |
| 首次启动 | 真实 Node HTTP API + Chromium 页面检查 | 已经扫描成功或获取实际消费者 |
| 真实 RSS/Atom 的活跃度 | 在用户自己的网络与源站验证 | CI 中的模拟公开信号 |
| Coding Agent 真实交付、消费者采访及付费验证 | 需要实际外部参与者、CI 和人工验收 | 通过自动化测试即为生产行为成功 |

**当前定位**：v1.8 的功能链可以在本机实际使用，并新增可恢复的数据管理能力。但由于外部网络环境、真实消费者研究、付费行为、真实专业编码 CLI 等尚未经过你的生产环境试点，不能将这些项目标记成“全链路已生产验证”。
