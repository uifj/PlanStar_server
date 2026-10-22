# VanLife API

> 本文档另有英文版本：[README.md](./README.md)

VanLife API 是 VanLife 应用的后端服务。它为 React 前端提供认证、基于角色的访问
控制、房车浏览、预订请求、房东管理、评价、分页以及 OpenAPI 文档。

React 前端位于本仓库的 [`front_web/`](./front_web) 目录中。

## 技术栈

| 领域 | 工具 |
| --- | --- |
| 运行时 | Node.js |
| API | Hono |
| 语言 | TypeScript |
| 数据库 | PostgreSQL |
| ORM | Prisma |
| 认证 | Better Auth |
| 校验 | Zod |
| 智能体 | Genkit（提供方为 DeepSeek 或 Google GenAI） |
| API 文档 | OpenAPI、Scalar |
| 质量保障 | Biome、TypeScript |

## 功能特性

- 基于 Better Auth 的邮箱/密码认证。
- 基于 Cookie 的会话。
- 租客（renter）与房东（host）两种角色。
- 仅房东可访问的路由保护。
- 公开的房车列表与房车详情接口。
- 房车支持搜索、筛选、排序与分页。
- 创建预订请求。
- 租客的预订历史。
- 房东管理预订状态。
- 房东对旗下房车的增删改查。
- 房东仪表盘、收入与评价汇总。
- 针对已完成预订创建评价。
- 使用 Zod 进行请求校验。
- OpenAPI 文档。
- 基于 Genkit 的行程规划智能体，依靠房车搜索、可用性检查与即将出行三类工具作答。
- 同一智能体同时提供 REST 接口和 Genkit 原生协议两种访问方式。
- 智能体会话按用户持久化到 PostgreSQL。

## 种子账号

```text
Host:          host@vanlife.test / password123
Second host:   host.two@vanlife.test / password123
Renter:        renter@vanlife.test / password123
Second renter: renter.two@vanlife.test / password123
```

种子数据包含：

- 用于归属场景验证的多个房东与租客
- 公开的房车房源，覆盖 `simple`、`rugged` 与 `luxury` 三种类型
- 来自 Pexels 的以房车为主题的房源图片
- 待处理的预订请求
- 已确认的预订
- 已完成的预订
- 已取消的预订
- 一条时间区间重叠的待处理预订，用于冲突测试
- 一条已完成且带有评价的预订
- 一条已完成、尚无人评价的预订
- 一辆已归档的房车，可在房东侧流程中看到
- 房东的房车、收入、仪表盘与评价数据

Pexels 图片依据 Pexels 许可协议使用，详见：
[Pexels 许可说明](https://help.pexels.com/hc/en-us/articles/360042295174-What-is-the-license-of-the-photos-and-videos-on-Pexels)

## 快速开始

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
CLIENT_URL=http://localhost:3000
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...

# 可选：行程规划智能体使用的模型提供方。没有 key 时 API 依然可以启动，
# 但智能体请求会返回 503。
AGENT_MODEL=deepseek/deepseek-chat
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
```

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

API 运行在：

```text
http://localhost:8000
```

## 前端（`front_web`）

`front_web` 是一个独立的 pnpm 项目，并不属于根 pnpm workspace，因此在仓库根目录
安装依赖不会涉及它：

```bash
cd front_web
pnpm install --ignore-workspace
```

创建 `front_web/.env`。前端只读取 `VITE_API_BASE_URL` 这一个变量，且没有默认值：

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

启动 Vite 开发服务器：

```bash
pnpm dev
```

应用运行在：

```text
http://localhost:3000
```

前端的质量检查是在 `front_web` 目录下执行 `pnpm typecheck` 与 `pnpm check`。

## 生产部署

仓库自带一套单机生产栈（Caddy + API + Postgres）与一份要求**从上到下逐条执行**的运行手册：

- **[docs/deploy/README.md](docs/deploy/README.md)** — 前置条件、密钥生成、`.env.production`、首次启动、
  迁移、创建管理员、发版演练、备份/恢复、升级/回滚、日志检索，以及 26 条上线检查清单。
- **[docs/deploy/troubleshooting.md](docs/deploy/troubleshooting.md)** — 17 类故障的判别树，每一类都给出
  可与“看起来一样”的故障区分开的判别步骤（401 循环、更新 400、安装被拒、collab、容器不健康、
  磁盘满、迁移、停机超时、compose provider 缺失、TLS、`/data` 权限、镜像拉取失败、
  `ERR_MODULE_NOT_FOUND`、构建 OOM、Prisma `enums.ts`、Caddy 端口绑定权限、部署脚本 compose
  文件集漂移）。
- `deploy/podman/` — 单机用的 `compose.yaml`、Linux 原生 systemd 用的 `quadlet/`，以及
  `scripts/` 下的备份 / 恢复 / 升级 / 发布 / 冒烟脚本。

常用命令：

```bash
deploy/podman/scripts/backup.sh     # 数据库 + /data（排除 desktop/logs）
deploy/podman/scripts/upgrade.sh    # 备份 → 构建 → 迁移 → 滚动 → 健康门禁 → 回滚
deploy/podman/scripts/smoke.sh      # 经由公网入口的 5 项检查
```

部署依赖的两个架构决策：[ADR-0026](docs/adr/0026-cloud-cookie-policy.md)（跨站会话 Cookie）与
[ADR-0027](docs/adr/0027-desktop-log-uplink.md)（桌面日志上行）。

## API 文档

服务运行时可访问：

| 资源 | URL |
| --- | --- |
| Scalar UI | `http://localhost:8000/api/docs` |
| OpenAPI JSON | `http://localhost:8000/api/openapi.json` |
| 当前用户 | `http://localhost:8000/api/me` |

## 主要接口

公开：

- `GET /api/vans`
- `GET /api/vans/:id`

认证：

- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-out`
- `POST /api/auth/change-password`
- `POST /api/register/host`
- `GET /api/me`

租客：

- `POST /api/bookings`
- `GET /api/bookings`
- `POST /api/bookings/:id/cancel`
- `POST /api/reviews`

房东：

- `GET /api/host/dashboard`
- `GET /api/host/income`
- `GET /api/host/reviews`
- `GET /api/host/bookings`
- `PATCH /api/host/bookings/:id/status`
- `GET /api/host/vans`
- `GET /api/host/vans/:id`
- `POST /api/host/vans`
- `PATCH /api/host/vans/:id`
- `DELETE /api/host/vans/:id`

智能体（任意已登录用户）：

- `POST /api/agent/trip-planner/messages`
- `/api/ai/tripPlanner`（支持所有方法，Genkit 协议）

## 预订生命周期

租客新建的预订初始状态为 `pending`。

租客可以取消自己的 `pending` 或 `confirmed` 状态的预订。

由房东控制的状态流转：

```text
pending -> confirmed -> completed
pending -> cancelled
confirmed -> cancelled
```

只有已完成的预订才能被评价，且每条预订只能有一条评价。

## 行程规划智能体

`src/modules/agent` 中定义了名为 `tripPlanner` 的 Genkit 智能体，为当前登录的旅行者
规划房车行程。它的回答来自工具输出，而不是凭空生成：

| 工具 | 用途 |
| --- | --- |
| `searchVans` | 按地点与每晚预算搜索已上架的房车 |
| `checkAvailability` | 结合现有预订检查某辆房车在指定日期区间能否预订，并返回冲突日期 |
| `myUpcomingTrips` | 无需参数；从会话中解析出旅行者本人并列出其即将出行的预订 |

同一个智能体挂载了两种传输方式：

- `POST /api/agent/trip-planner/messages` 接收 `{ "message": "...", "chatId": "..." }`，
  返回 `{ chatId, snapshotId, reply }`。省略 `chatId` 即开启一段新会话。
- `/api/ai/tripPlanner` 使用 Genkit 自身的通信格式，浏览器端的 `remoteAgent` 客户端
  与 Genkit Dev UI 走的正是这条通道。

会话通过 `AgentChat` 与 `AgentSnapshot` 数据表持久化，`chatId` 只能由发起它的用户继续。

模型提供插件由 `AGENT_MODEL` 的前缀决定（`deepseek/deepseek-chat`、
`deepseek/deepseek-reasoner` 或 `googleai/<model>`），并且只加载与之匹配的那一个——
若同时注册了第二个提供方，智能体会解析到该提供方的默认模型。未配置 API key 时 API
仍然可以启动，但一次对话会返回 `503`。

若要在 Genkit Dev UI 中调试本服务：

```bash
pnpm exec genkit start -- pnpm dev
```

## 项目结构

```text
src/
  auth/          角色与认证辅助函数
  config/        环境配置与常量
  errors/        应用错误与 HTTP 错误类
  generated/     生成的 Prisma 客户端
  lib/           认证、Genkit、日志、Prisma 及 Prisma 错误辅助函数
  middleware/    CORS、会话、认证、日志、请求 ID、错误处理
  modules/
    agent/       行程规划智能体、工具、会话存储与两种传输路由
    auth/        认证路由与 schema
    bookings/    预订路由、service、repository、筛选条件
    host/        房东仪表盘、房车、预订、收入、评价
    me/          当前用户路由
    reviews/     评价创建
    system/      健康检查/就绪检查接口
    vans/        公开房车浏览
  openapi/       OpenAPI 配置、schema、请求与响应
  pagination/    分页与排序辅助函数
  response/      响应载荷辅助函数
  routes/        挂载所有模块路由，包含智能体的两种传输方式
  app.ts
  index.ts
```

各业务模块将路由定义、router、service、repository、DTO 与 schema 就近放置；
共享的基础设施则位于 `modules` 之外。

## 质量检查

```bash
pnpm check
```

`pnpm check` 会依次执行 Biome、`tsc --noEmit` 以及两套测试。单独执行各步骤：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit         # Vitest 单元测试
pnpm test:integration  # 基于 .env.test 数据库的 Vitest 集成测试
pnpm test:all
```

构建并运行编译后的 API：

```bash
pnpm build
pnpm start
```
