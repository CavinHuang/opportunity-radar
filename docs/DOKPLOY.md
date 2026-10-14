# Dokploy 部署指南

> [Dokploy](https://dokploy.com/) 是自托管的部署平台（内置 Traefik 反代与 Let's Encrypt 自动 HTTPS）。本仓库原生适配 Dokploy 的 **Dockerfile 构建类型**——仓库根目录的 `Dockerfile` 就是全部构建配置。

## 前置条件

- 一台已安装 Dokploy 的服务器（VPS / 云主机）
- 本仓库的 Git 地址（公开仓库直接填；私有仓库在 Dokploy 里配置 GitHub 凭据）
- 域名一个（可选，用于自动 HTTPS）

## 推荐：使用已验证、带提交 SHA 的 GHCR 镜像（免手动注入发布身份）

`main` 的 **CI 成功**后，[Verified GHCR release image](https://github.com/CavinHuang/opportunity-radar/actions/workflows/publish-release-image.yml) 会针对**刚通过 CI 的确切 Git SHA**构建 `linux/amd64` Docker 镜像。工作流先在隔离环境启动同一镜像，验证 `/api/health`、`/api/release`、`/app.js`，成功后才使用仓库级 `GITHUB_TOKEN` 发布到 GHCR（无需填写个人 PAT）。镜像自带正确的 `RADAR_RELEASE_SHA`，从此不必依赖 Dokploy Dockerfile 构建阶段手工传入 Git SHA。

首次使用时：
在拉取镜像之前，先查看 [Anonymous GHCR deployment pull verification](https://github.com/CavinHuang/opportunity-radar/actions/workflows/anonymous-ghcr-pull.yml) 的实际运行结果：它使用**不带 GHCR 凭据的独立 GitHub Runner** `docker pull` 已发布镜像，并尝试启动后检查版本。如果工作流成功，可以确认该镜像当前支持**匿名拉取**；若失败则不能假定镜像已公开，需前往 GitHub 包的 Package settings 调整可见性（仅当确实希望镜像公开），或在 Dokploy 为 GHCR 配置只读包访问凭据。匿名拉取结果不是生产部署验收，且 GHCR 可见性可能在未来发生变化。

1. 打开 [Verified GHCR release image Actions](https://github.com/CavinHuang/opportunity-radar/actions/workflows/publish-release-image.yml)，找到最新**已成功发布**的运行记录，复制 Job Summary 中的 **镜像完整 digest 引用**（形如 `ghcr.io/cavinhuang/opportunity-radar@sha256:...`，使用真实输出，不要把示例当实际值）。
2. 在 Dokploy 创建/编辑 **Application → General → Source: Docker**，Docker Image 填入上一步的完整镜像引用，Registry 为 `ghcr.io`。若 GHCR 包私有，需先在 Dokploy 配置只用于拉取的包读取凭据；公有包则按 Dokploy 支持的公开拉取方式设置。不要假定 GitHub 仓库公开就表示镜像已经可以匿名拉取。参见 [Dokploy Docker Registry 官方指南](https://docs.dokploy.com/docs/core/Docker)。
3. 配置端口 `4177`、健康路径 `/api/health`、公网域名和 HTTPS，以及**必须持久化**的 `/app/.data`。在 Dokploy Environment 设置强随机 `RADAR_OWNER_TOKEN`，有需要再设置独立的 `RADAR_WATCH_TOKEN`；**不要再设置固定的运行时 `RADAR_RELEASE_SHA`**，否则会覆盖镜像原有身份。
4. 部署前备份当前 SQLite；实际运行后，`GET /api/release` 应返回你选中的 40 位 SHA，不能只凭镜像推送成功断言线上已更新。继续运行 [Independent production watch](https://github.com/CavinHuang/opportunity-radar/actions/workflows/production-watch.yml) 的一次性 `production_url` / `expected_sha` 验收，再填写仓库中持久化的生产 URL 和 SHA。
5. 升级需要显式选取**新的已验证镜像 digest**再重新部署；这条流水线**不自动修改 Dokploy**、也不改变用户的数据库。要回滚应用，请回到先前已经验证过的镜像 digest 并执行数据库兼容性与备份检查。镜像为 `linux/amd64`，ARM64 服务器需要另行构建并核验对应架构。

**状态边界**：GHCR 包发布成功表示可部署的镜像已准备好，**不表示 Dokploy 已使用该镜像**；`/api/release` 的 SHA 仍是镜像构建器写入的部署声明，而不是远程安全证明。还需和 Dokploy 的运行中镜像 digest 对照。

## 两种部署类型怎么选

| | Dockerfile（应用类型） | Docker Compose（组合类型） |
|---|---|---|
| 反代/域名 | Dokploy Domain 标签页自动接通 Traefik | **需手动接网络与路由标签**（仓库 compose 已预置） |
| 适用 | 单容器最简路径，推荐 | 想把编排文件纳入版本控制的场景 |

> 若由 Docker Compose 使用**预构建 GHCR 镜像**，请把 `build:` 替换为 `image: ghcr.io/cavinhuang/opportunity-radar@sha256:<真实digest>`。Compose 现已删除原有的空运行时 `RADAR_RELEASE_SHA` 覆盖项，避免将预构建镜像中写入的 SHA 清空。完整 Docker Compose 文件仍使用示例域名 `radar.example.com`；必须先换成实际域名才能正常通过 Traefik HTTPS 路由。

## Compose 部署的反代接线（404 page not found 的原因与解法）

**症状**：部署成功、容器健康，访问域名得到纯文本「404 page not found」。

**原因**：这是 Traefik 的默认响应——Compose 部署类型下，Dokploy **不会**自动把容器接入反向代理网络，也不自动生成路由。仓库的 `docker-compose.yml` 已预置所需配置：

1. 服务挂载 Dokploy 的外部网络 `dokploy-network`（Traefik 只回源到这个网络上的容器）；
2. 预置 Traefik 路由标签（Host 规则 + websecure 入口 + letsencrypt 证书 + 后端端口 4177）。

**你要做的**：把 `docker-compose.yml` 里两处 `radar.example.com` 改成你的域名 → Dokploy 里 **Redeploy** → 验证：

```bash
# 服务器上确认容器在 dokploy-network 上、标签生效
docker inspect opportunity-radar --format '{{json .NetworkSettings.Networks}}' | grep dokploy
curl -H 'Host: 你的域名' -k https://127.0.0.1 -o /dev/null -w '%{http_code}
'   # 应为 200（在服务器本机测试）
```

> 不用域名时：删除三条 `traefik.http.routers.*` 标签，直接访问 `http://服务器IP:4177`（compose 已发布该端口，防火墙放行即可）。`RADAR_ALLOWED_HOSTS` 仅在**未设置** `RADAR_OWNER_TOKEN` 时才需要。

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
| `JEV_API_KEY` | 可选 | Jev System One 信号预筛（默认走 `https://openrouter.ai/~typesafe/jev-latest`） |
| `JEV_API_URL` | 可选 | 覆盖 Jev 端点（默认已指向 OpenRouter） |
| `JEV_MODEL` | 可选 | 覆盖 Jev 模型标识 |

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


### 发布版本确认

选择上文已验证的 GHCR 镜像时，发布 SHA 已被写入镜像（推荐方式）。如果仍选择在 Dokploy 里直接按 Dockerfile 构建，则，可将**对应的完整 40 位 SHA**设置为 Docker build arg `RADAR_RELEASE_SHA`。也可以在发布流程中使用动态生成的运行时同名环境变量（但不能把一个固定值留在后台用于所有后续版本）。如果没有可靠的动态注入能力，版本会返回 `identified:false`，请先通过部署详情确认 Git commit，不要伪造通过结果。

仓库有手动 GitHub Action **Production release verification**；先配置仓库 Actions 变量 `RADAR_PRODUCTION_URL` 为实际 HTTPS 地址，然后手动在 main 上运行。验证脚本 `scripts/verify-release.mjs` 只做公开接口只读检查，不会读取数据库或调用部署 API。详情见 [DEPLOY.md](DEPLOY.md)。

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
