# PlanStar API

> 英文文档：[README.md](./README.md)

PlanStar API 是 **企划星（PlanStar）** —— 一款自托管知识工作台 —— 的后端。它提供
认证与 Cookie 会话、工作区/内容模型（空间、对象、块、数据视图、关系、对象类型）、
客户端壳层驱动的指令总线、发布与实时事件、文件处理、桌面端发布与日志服务，以及一个
Genkit 智能体，并由强类型路由生成 OpenAPI/Scalar 接口面，供 React 前端使用。

React 客户端是一个**独立仓库**
[`uifj/PlanStar_frontend`](https://github.com/uifj/PlanStar_frontend)（Web + Electron
桌面壳层）。本仓库忽略了 `front_web/`，因此克隆 API 不会附带客户端；需要同时运行两者时，
将其检出到与 API 并列的 `front_web/` 目录。

仓库同时内置一个 **vanlife 示例域**（房车、订单、评价、房东后台，以及行程规划智能体），
作为同一套 Hono + Prisma + Better Auth 技术栈的完整样例；详见
[vanlife 示例域](#vanlife-示例域)。

## 技术栈

| 领域 | 工具 |
| --- | --- |
| 运行时 | Node.js ≥ 24、pnpm ≥ 11 |
| API | Hono（`@hono/zod-openapi`） |
| 语言 | TypeScript |
| 数据库 | PostgreSQL |
| ORM | Prisma |
| 认证 | Better Auth |
| 校验 | Zod |
| 实时 | Server-Sent Events（`/api/events`）+ Yjs over WebSocket（`/collab`） |
| 智能体 | Genkit（DeepSeek 或 Google GenAI provider） |
| 接口文档 | OpenAPI、Scalar |
| 质量 | Biome、TypeScript、Vitest |

## 能力总览

按 [`src/routes/index.ts`](src/routes/index.ts) 中挂载的路由分组：

- **认证与会话** —— 基于 Better Auth 的邮箱/密码登录注册、Cookie 会话、当前用户
  （`/api/me`）、改密、按角色保护的路由。
- **工作区与内容** —— 空间、对象、块、数据视图、关系、对象类型：客户端渲染的知识库模型。
- **指令总线** —— `POST /api/command/{name}` 是 Web 与 Electron 壳层驱动的 RPC 面，
  用于账户/空间生命周期（如 `AccountStop` 会在传输边界同时吊销 Better Auth 会话）。
- **发布与实时** —— 公开分享（`/api/publish/{uri}`）、Server-Sent 订阅通道
  （`/api/events`），以及客户端编辑器的 Yjs 文档协作（Hocuspocus，同一 HTTP 服务器
  上的 `/collab` WebSocket 升级，携带 Better Auth 会话 Cookie）。
- **文件与导出** —— 根级上传（`POST /api/web-upload`）、下载
  （`/api/file/{id}`、`/api/image/{id}`）与对象列表导出归档（`/api/export/{name}`）。
- **桌面服务**（`/api/desktop`）—— 供自动更新使用的发布 manifest / 下载 / feed，
  反馈与崩溃报告接入，以及匿名日志上行（`POST /api/desktop/logs`），带单设备配额与
  14 天留存（[ADR-0027](docs/adr/0027-desktop-log-uplink.md)）。
- **智能体** —— 基于 Genkit 的 `tripPlanner`，可经 REST 与 Genkit 自有协议访问，
  会话按用户持久化。
- **系统** —— `/api/health` 与 `/api/ready` 探针。

## 快速开始

前置：Node.js ≥ 24 与 pnpm ≥ 11（见 `package.json` 的 `engines`）。

安装依赖：

```bash
pnpm install
```

创建并配置 `.env`：

```bash
cp .env.example .env
```

环境变量：

```text
NODE_ENV=development
PORT=8000
LOG_LEVEL=debug
APP_URL=http://localhost:8000
CLIENT_URL=http://localhost:3030
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...

# 可选：智能体 provider。无 key 时 API 仍可启动，智能体返回 503。
AGENT_MODEL=deepseek/deepseek-chat
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
```

以上是启动所需的最小集合。完整 schema —— `HOST`、文件存储根
（`FILE_STORAGE_ROOT`、`FILE_UPLOAD_STAGING_ROOT`、`EXPORT_ROOT`）、桌面发布/日志设置
（`DESKTOP_ORIGIN`、`DESKTOP_RELEASE_*`、`DESKTOP_LOG_*`）与智能体模型 —— 均由
[`src/config/env.ts`](src/config/env.ts) 校验；所有默认值也列在那里。

准备数据库：

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

启动 API：

```bash
pnpm dev
```

API 运行于 `http://localhost:8000`。

## 前端（`front_web`）

客户端是独立仓库、独立的 pnpm 项目，不属于根 workspace，且本仓库忽略了
`front_web/`。将其检出到 API 旁：

```bash
git clone git@github.com:uifj/PlanStar_frontend.git front_web
cd front_web
pnpm install --ignore-workspace
```

创建 `front_web/.env` 并指向 API：

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

客户端启动时按以下优先级解析基址：`?server=` URL 参数 → 上次启动存储的地址 →
`VITE_API_BASE_URL` → 页面自身 origin 加 `/api`。仅含 origin 的值会自动补上 `/api`。

启动 Vite 开发服务器：

```bash
pnpm dev
```

应用运行于 `http://localhost:3030`。前端检查为在 `front_web` 下运行的
`pnpm typecheck` 与 `pnpm check`。客户端自身文档见
[`PlanStar_frontend`](https://github.com/uifj/PlanStar_frontend)。

## 接口文档

服务器以开发模式运行（`NODE_ENV=development`）时：

| 资源 | URL |
| --- | --- |
| Scalar UI | `http://localhost:8000/api/docs` |
| OpenAPI JSON | `http://localhost:8000/api/openapi.json` |
| 健康 / 就绪 | `http://localhost:8000/api/health`、`/api/ready` |
| 当前用户 | `http://localhost:8000/api/me` |

Scalar 与 OpenAPI 文档仅在 `NODE_ENV` 为 `development` 时挂载；生产部署不暴露它们。

## API 面

以下每条路由都挂载在 `/api` 前缀下。权威的操作与 schema 列表见生成的 OpenAPI 文档
`/api/openapi.json`。

| 挂载 | 模块 | 职责 |
| --- | --- | --- |
| `/`、`/health`、`/ready` | system | 信息与探针 |
| `/auth/*`、`/register/host`、`/me` | auth、me | Better Auth 会话、房东注册、当前用户 |
| `/spaces` | spaces | 空间列表/创建 |
| `/spaces/{spaceId}/participants[/{participantId}]` | spaces | 成员关系 |
| `/spaces/{spaceId}/objects` | objects | 空间维度对象列表/创建 |
| `/objects/{objectId}` | objects | 对象读/更新/删除 |
| `/objects/{objectId}/backlinks` | objects | 反向链接 |
| `/spaces/{spaceId}/relations`、`/object-types` | relations、object-types | schema 注册表 |
| `/spaces/{spaceId}/dataviews[/{dataviewId}][/records]` | dataviews | 视图与记录 |
| `/objects/{objectId}/blocks` | blocks | 块列表/创建 |
| `/blocks/{blockId}` | blocks | 块更新/删除 |
| `/command/{name}` | command | 客户端壳层的 RPC 总线 |
| `/publish/{uri}` | publish | 公开分享 |
| `/events` | pubsub | Server-Sent 订阅通道 |
| `/web-upload`、`/file/{id}`、`/image/{id}`、`/export/{name}` | files | 上传、下载、导出 |
| `/desktop/{feedback,crash-report,releases/*,logs*}` | desktop、desktop-logs | 发布、接入、日志上行 |
| `/agent/trip-planner/messages`、`/ai/tripPlanner` | agent | 智能体的 REST + Genkit 协议传输 |
| `/vans`、`/bookings`、`/reviews`、`/host/*` | vanlife 示例 | 见下 |

在 `/api` 前缀之外，同一 HTTP 服务器还在 `/collab` 上响应 WebSocket 升级
（Hocuspocus + Yjs），用于实时文档协作。

## vanlife 示例域

基于同一技术栈的自包含样例，并附带演示种子数据：

- 带搜索、筛选、排序、分页的公开房车列表与详情。
- 租客预订申请、历史、取消；每笔已完成订单一条评价。
- 房东后台、收入、评价、订单与房车 CRUD/归档。
- 房东/租客角色与仅房东可访问的路由保护。
- `tripPlanner` Genkit 智能体（见下）。

### 种子账号

```text
房东：        host@vanlife.test / password123
第二房东：    host.two@vanlife.test / password123
租客：        renter@vanlife.test / password123
第二租客：    renter.two@vanlife.test / password123
```

种子数据包含多组房东与租客、`simple`/`rugged`/`luxury` 三类的房车列表
（图片来自 Pexels，遵循 [Pexels 许可](https://help.pexels.com/hc/en-us/articles/360042295174-What-is-the-license-of-the-photos-and-videos-on-Pexels)），
以及覆盖各生命周期状态的订单（待确认 / 已确认 / 已完成 / 已取消，一笔用于冲突测试的重叠预订，
一笔可评价的已完成订单）。

订单状态流转（由房东控制）：

```text
pending -> confirmed -> completed
pending -> cancelled
confirmed -> cancelled
```

## 行程规划智能体

`src/modules/agent` 定义了名为 `tripPlanner` 的 Genkit 智能体，为已登录的旅行者规划房车
行程，且只依据工具输出作答、不作臆造：

| 工具 | 用途 |
| --- | --- |
| `searchVans` | 按地点与每晚预算搜索已上架房车 |
| `checkAvailability` | 针对某日期区间用实时订单校验某房车是否可订，并报告冲突日期 |
| `myUpcomingTrips` | 无参数；从会话中解析旅行者并列出其即将到来的行程 |

同一智能体挂载了两种传输：

- `POST /api/agent/trip-planner/messages` 接收 `{ "message": "...", "chatId": "..." }`，
  返回 `{ chatId, snapshotId, reply }`。省略 `chatId` 即开启新会话。
- `/api/ai/tripPlanner` 使用 Genkit 自有线格式，供浏览器 `remoteAgent` 客户端与
  Genkit Dev UI 使用。

会话以 `AgentChat` 与 `AgentSnapshot` 行持久化，且 `chatId` 只能由其发起者续用。provider
插件由 `AGENT_MODEL` 前缀选择（`deepseek/...` 或 `googleai/<model>`），且只加载匹配的那一个；
无 key 时 API 仍可启动，单轮对话返回 `503`。针对本服务器打开 Genkit Dev UI：

```bash
pnpm exec genkit start -- pnpm dev
```

## 生产部署

仓库提供单机生产栈（Caddy + API + Postgres）与一份可从头到尾在新机器上顺序执行的运行手册：

- **[docs/deploy/README.md](docs/deploy/README.md)** —— 前置条件、密钥生成、
  `.env.production`、首次启动、迁移、首个管理员、发布演练、备份、升级与回滚、日志取回，
  以及上线检查清单。
- **[docs/deploy/troubleshooting.md](docs/deploy/troubleshooting.md)** —— 各类故障，
  每种都给出与相似症状区分开的判据。
- `deploy/podman/` —— 单机 `compose.yaml`、systemd 原生安装的 `quadlet/`、
  以及用于备份 / 恢复 / 升级 / 发布暂存 / 冒烟的 `scripts/`。

```bash
deploy/podman/scripts/backup.sh     # 数据库 + /data（不含 desktop/logs）
deploy/podman/scripts/upgrade.sh    # 备份 → 构建 → 迁移 → 滚动 → 健康门禁 → 回滚
deploy/podman/scripts/smoke.sh      # 经公网入口的 5 项检查
```

部署依赖 [ADR-0026](docs/adr/0026-cloud-cookie-policy.md)（跨站会话 Cookie）与
[ADR-0027](docs/adr/0027-desktop-log-uplink.md)（桌面日志上行）。

## 项目结构

```text
src/
  auth/          角色、当前用户与受保护路由助手
  config/        环境配置（Zod）与常量
  errors/        App 与 HTTP 错误类
  lib/           Auth、Genkit、logger、Prisma 及 Prisma 错误处理助手
  middleware/    CORS、会话、鉴权、日志、请求 id、错误处理
  modules/
    agent/       行程规划 Genkit 智能体、工具、会话存储、两种传输
    auth/        认证路由与 schema
    blocks/      块操作
    collab/      Hocuspocus/Yjs 协作（/collab 的 WebSocket 升级）
    command/     指令总线（客户端壳层的 RPC 面）
    dataviews/   数据视图操作
    desktop/     发布 manifest/下载/feed、反馈、崩溃报告
    desktop-logs/ 匿名日志上行、配额、留存
    files/       上传、下载、导出归档
    objects/     对象 CRUD 与空间维度查询
    object-types/ 对象类型注册
    publish/     公开分享
    pubsub/      实时订阅通道（/api/events）
    relations/   关系操作
    spaces/      工作区/空间管理
    system/      健康/就绪端点
    vanlife/     共享的 vanlife 领域
    vans/ bookings/ reviews/ host/   vanlife 示例域
  openapi/       OpenAPI 配置、schema、请求、响应、Scalar
  pagination/    分页与排序助手
  response/      响应载荷助手
  routes/        挂载所有模块路由，含智能体的两种传输
  app.ts
  index.ts
```

领域模块将路由定义、router、service、repository、DTO 与 schema 就近聚合。
共享基础设施位于 `modules` 之外。

## 质量检查

```bash
pnpm check
```

`pnpm check` 依次运行 Biome、`tsc --noEmit` 与两套测试。单独运行各步骤：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit         # Vitest 单元测试
pnpm test:integration  # 针对 .env.test 数据库的 Vitest 集成测试
pnpm test:all
```

构建并运行编译后的 API：

```bash
pnpm build
pnpm start
```
