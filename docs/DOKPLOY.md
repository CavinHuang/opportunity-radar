# Dokploy 部署指南

> [Dokploy](https://dokploy.com/) 是自托管的部署平台（内置 Traefik 反代与 Let's Encrypt 自动 HTTPS）。本仓库原生适配 Dokploy 的 **Dockerfile 构建类型**——仓库根目录的 `Dockerfile` 就是全部构建配置。

## 前置条件

- 一台已安装 Dokploy 的服务器（VPS / 云主机）
- 本仓库的 Git 地址（公开仓库直接填；私有仓库在 Dokploy 里配置 GitHub 凭据）
- 域名一个（可选，用于自动 HTTPS）

## 部署步骤

### 1. 创建应用

Dokploy 控制台 → **Create Project** → **Create Service** → **Application**：

| 配置项 | 值 |
|---|---|
| Repository URL | 本仓库 Git 地址 |
| Branch | `main` |
| Build Type | **Dockerfile**（默认；仓库根目录已有 Dockerfile，无需额外配置） |
| Auto Deploy | 开启（push 到 main 自动重新构建部署） |

### 2. 环境变量（Environment 标签页）

| 变量 | 必填 | 说明 |
|---|---|---|
| `RADAR_OWNER_TOKEN` | **必填** | 强随机口令；浏览器首次访问时输入，也是全部管理操作的鉴权 |
| `RADAR_AGENT_TOKEN` | 可选 | 外部 Coding Agent 自动化的独立 token |
| `RADAR_FEED_URLS` | 可选 | 逗号分隔的 HTTPS RSS 源；也可部署后在界面里订阅 |
| `RADAR_LLM_BASE_URL` / `RADAR_LLM_API_KEY` / `RADAR_LLM_MODEL` | 可选 | 启用 AI 起草（DeepSeek 等 OpenAI 兼容端点） |
| `GITHUB_TOKEN` | 可选 | 交付证据的 GitHub CI 核验 |

> `RADAR_DB`、`RADAR_HOST`、`RADAR_PORT` 已由 Dockerfile 内置默认值（`/app/.data/radar.sqlite`、`0.0.0.0`、`4177`），无需重复设置。

### 3. 数据卷（Volumes 标签页）——必须配置

| 容器路径 | 用途 |
|---|---|
| `/app/.data` | **SQLite 数据库 + WAL**。不挂载的话容器重建会丢全部数据 |

可选：`/app/backups`（若使用容器内备份命令，配合 Dokploy 的备份功能）。

### 4. 端口与健康检查

- **Port**：`4177`（Dokploy 的 Application Port 配置项）
- **Healthcheck Path**（Dokploy Health 标签页）：`/api/health`——无鉴权、返回 `{"ok":true}` 表示进程与数据库正常

### 5. 域名与 HTTPS（Domain 标签页）

Dokploy → Domain → 添加你的域名 → 勾选 HTTPS（Let's Encrypt 自动签发）。Traefik 会把 `https://你的域名` 转发到容器的 4177。

> 设置了 `RADAR_OWNER_TOKEN` 后，应用接受任意 Host，反代/域名场景无需额外配置白名单。

### 6. Deploy

点击 **Deploy**，等构建完成（零依赖镜像，构建通常在一分钟内）。之后每次 push 到 `main` 会按 Auto Deploy 设置自动重新构建。

## 安全要点

- `RADAR_OWNER_TOKEN` 用强随机值（`openssl rand -hex 24`）；泄露即等于交出全部数据与管理权限。
- Dokploy 的 Traefik 已终止 HTTPS；应用容器本身仍是 HTTP，出公网的只有 443 一跳。
- 多人使用：每人发独立角色 token（owner / agent），不要共用；当前为单 owner 架构，详见 [DEPLOY.md](DEPLOY.md) 的边界说明。

## 数据备份

Dokploy 自带容器/卷备份可覆盖 `/app/.data`；也可以用应用内置的一致性快照命令：

```bash
dokploy Enter Container → node src/data-cli.mjs backup \
  --db /app/.data/radar.sqlite --output /app/backups/radar-$(date +%Y%m%d).sqlite
```

恢复：`restore --input <备份> --destination /app/.data/restored.sqlite --confirm`，然后重启容器并把数据卷指回。
