# 桌面端排障

桌面壳 = `front_web/electron`（主进程 + preload）+ 同一个 `dist-web` 渲染器。绝大多数"白屏 /
登录不上 / 点了没反应"都落在这几层边界上：**服务进程是否在、原点是否被信任、等待页是否跳转、
本地状态文件是否损坏**。

日志在 `~/Library/Application Support/Anytype Harness/logs/`（按天滚动为 `YYYY-MM-DD.log`，保留 14 天），
也可以走菜单 `Help → Export Logs` 打成一个 zip。下文路径均指**打包后**的 userData；
`pnpm dev:electron` 未打包，目录名取自 `package.json` 的 `name`，即
`~/Library/Application Support/anytype-web/`。

## 1. 端口 8321 被占用

症状：启动即退出，终端里 `EADDRINUSE` 或 `desktop server failed to bind`。

```bash
lsof -nP -iTCP:8321 -sTCP:LISTEN
```

壳**不会**回退到随机端口：后端 CORS 白名单里写的是 `http://localhost:8321`，换端口等于换原点，
cookie 立刻失效，表现会变成"登录成功但每个命令都 401"。所以要么杀掉占用者，要么显式改端口
并同时改后端：

```bash
HARNESS_DESKTOP_PORT=8322 pnpm dev:electron
TRUSTED_ORIGINS="http://localhost:8321,http://localhost:8322" pnpm dev
```

`tests/unit/middleware/cors.test.ts` 把这两侧的值钉在一起。

## 2. `TRUSTED_ORIGINS` 不匹配

症状：页面能打开，登录请求被 CORS 拦掉（浏览器控制台 `blocked by CORS policy`），或者登录后
所有 `/api/command/*` 都是 401。

- 后端 `TRUSTED_ORIGINS` 必须**逐字**包含 `http://localhost:8321`（协议、主机、端口都不能差）。
- 壳只信任自己的原点：导航、`window.open`、IPC sender 校验都用 `URL.origin` 精确比较，不是
  字符串前缀——所以 `http://localhost:8321@evil.com` 这种 userinfo 伪装会被拒（见
  `electron/main/trustedUrl.ts`）。
- 渲染器支持 `?server=http://其它主机` 指向别的 API，但**原点**仍然是 `:8321`；cookie 属于
  被指向的那台 API，跨站场景下需要那台机器自己信任 `:8321`。

## 3. 等待页不跳转

壳启动时会轮询 `GET {HARNESS_API_URL}/api/health`（默认 `http://localhost:8000`）。健康检查
通过前显示的是内联 `data:` 等待页——它**不是**应用文档，`pendingRoute` 会一直挂着，等真正的
渲染器发 `RendererReady` 才投递。

| 现象 | 检查 |
| --- | --- |
| 一直停在等待页 | `curl -s http://localhost:8000/api/health`；后端没起就起它 |
| 后端换了地址 | `HARNESS_API_URL=http://host:port` 必须与渲染器里配置的一致 |
| 页面出现但深链没生效 | 控制台看有无 `SecurityError`；深链必须等 `RendererReady` 之后才 `pushState` |
| 深链只在"先起后端"时生效 | 已修：`did-finish-load` 只在文档确实是应用页面时 drain，`data:` 等待页不再收路由 |

深链单槽的语义是"后写覆盖先写"：连点两次链接只有最后一个目标生效，这是有意的（避免排队的
旧路由在启动后挨个跳一遍）。

## 4. `window.json` 损坏 / 窗口开到屏幕外

位置：`~/Library/Application Support/Anytype Harness/window.json`（开发时在 `anytype-web/` 下）。

读取时统一过 `sanitizeWindowState()`：

- `width/height` 非有限数或小于 800×600 → 回落到默认尺寸；
- 超出当前显示器 `workArea` → 夹到 `workArea`；
- `x/y` 与任何一块屏幕的可视区交集不足 100×100 → **丢弃坐标**，交给 Electron 居中；
- `maximized` 强制转成布尔（`"yes"`、`1` 都变成 `true`）。

所以手改坏了不会把窗口丢到屏幕外，最差是"尺寸回到默认、位置回到居中"。想彻底重置：

```bash
rm "~/Library/Application Support/Anytype Harness/window.json"
```

窗口状态在 `before-quit` 时强制落盘一次（`WindowStateTracker.flush`），崩溃不会留下半截 JSON。

## 5. 日志与导出

- 目录：`~/Library/Application Support/Anytype Harness/logs/YYYY-MM-DD.log`（本地日期，按天换文件；
  `HARNESS_E2E_LOG_DIR` 可以改写目录，CI 用它把每个 worker 隔开）。保留窗口 14 天，启动时清理一次。
- 写入是**批量异步**的：行先进缓冲区，250ms 合并成一次写；`warn`/`error` 立即落盘；进程退出前
  `flushLogsSync()` 再强制刷一次。所以崩溃现场不会丢掉最后几条关键日志。
- 单行超过 8KB 会被截断并加 `…[truncated]`；缓冲区超过 500 行会丢最旧的并补一行
  `[logger] dropped N lines`。
- 菜单 `Help → Export Logs` 生成 zip（尾部窗口 5MB × 5 个文件），走命令总线
  `export-logs`，返回值里带文件路径。
- 日志系统本身没初始化（`HARNESS_DESKTOP_ENABLE_LOGGER=0`）时，`logger` 会退化成 console sink，
  导出日志会返回 `success: false`。

## 6. 更新相关

| 现象 | 原因 |
| --- | --- |
| 菜单里没有"检查更新" | 未打包（`app.isPackaged === false`）或 `HARNESS_DESKTOP_ENABLE_AUTO_UPDATE=0`；capabilities 里的 `autoUpdate` 也是同一个条件 |
| 检查更新立即失败 | 服务端没起 / `releases/feed/latest-mac.yml` 不存在（404） |
| 下载完成但装不上 | 未签名包的预期行为，见 `docs/desktop/release.md` 第 4 节 |
| 强更弹窗不出现 | `HARNESS_DESKTOP_ENABLE_FORCE_UPDATE=0`，或 `/releases/manifest` 的 `is_forced` 不是真值，或 `manifest.version` 与 feed 版本不一致 |

更新失败的完整原因在日志里搜 `[auto-update]`。
