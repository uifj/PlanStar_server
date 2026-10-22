# 桌面壳架构

一句话：**一份渲染器，两个目标**。`pnpm build` 产出的 `dist-web` 同时服务浏览器和 macOS 壳；
桌面目标只多一层壳，不改渲染器（见 [ADR 0024](../adr/0024-desktop-shell-serves-the-web-renderer.md)）。

## 1. 进程与边界

```
┌──────────────────────────── main (electron/main.ts) ────────────────────────────┐
│  静态服务器 :8321 ── dist-web（SPA fallback）                                    │
│  健康探针 ── GET {HARNESS_API_URL}/api/health ── 未就绪则显示 data: 等待页        │
│  子系统：logger / menu / feedback / exportLogs / crashReporter / updater / 强更   │
│  命令总线 commandHandlers.ts ── 菜单、快捷键、渲染器共用唯一分派点                 │
└───────────▲──────────────────────────────────────────┬──────────────────────────┘
            │ ipcMain.handle / .on                     │ webContents.send
            │ （每个入口先过 isTrustedSenderUrl）        │ （desktop:* push）
┌───────────┴─────────── preload (electron/preload) ───▼──────────────────────────┐
│  contextBridge.exposeInMainWorld("Desktop", desktopBridge)                      │
│  IPC 通道名、载荷类型全部来自 @harness/desktop-shared                            │
│  desktop:route → window.history.pushState + popstate（深链即导航）               │
└───────────▲─────────────────────────────────────────────────────────────────────┘
            │ window.Desktop（真实壳 isDesktop:true；浏览器 mock isDesktop:false）
┌───────────┴──────────────────── renderer (src/ts) ──────────────────────────────┐
│  lib/desktop.ts 是唯一入口；桥不存在 / invoke 被拒 → 一律降级为 null             │
│  isShell() 区分"真壳"与"浏览器里的 mock"，不看桥是否存在                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

三条硬规则：

1. **渲染器只认 `URL.origin`**。导航守卫（`will-navigate` / `setWindowOpenHandler`）和 IPC
   sender 校验都走 `electron/main/trustedUrl.ts`，`isTrustedNavigation` 额外放行壳自己加载的
   `data:text/html` 等待页，`isTrustedSenderUrl` 只认 `DESKTOP_ORIGIN`——因为等待页绝不能收到
   深链路由（它没有 `history` 可用）。
2. **IPC 入口一律校验 sender**。`ipcMain.handle` 抛错、`ipcMain.on` 静默 return；渲染器侧的
   `invoke` 已经把异常折成 `null`，所以主进程不需要吞错。
3. **契约只有一份**。`packages/desktop-shared` 定义通道名、命令 id、载荷类型；preload 与
   `lib/desktop.ts` 都从它 import。`scripts/check-desktop-mock-parity.mjs` 再按桥成员反查 web
   mock，漏一个就让 CI 红。

## 2. 命令总线

所有"动作"走同一个分派点 `createExecuteDesktopCommand(deps)`（`electron/main/commandHandlers.ts`），
菜单项、加速键、渲染器调用都只是给命令 id：

| 分组 | 命令 id |
| --- | --- |
| 窗口 | `reload` `force-reload` `toggle-dev-tools` `toggle-full-screen` `minimize` `maximize` `close` |
| 缩放 | `zoom-in` `zoom-out` `reset-zoom` |
| 更新 | `check-for-updates` `download-update` `cancel-update-download` `quit-and-install-update` |
| 反馈与诊断 | `export-logs` `open-feedback` `capture-screenshot` `show-about` `open-external` |

返回值是一个 `{ ok, reason? }` 信封，例外只有两个命令带真实载荷：
`export-logs → ExportLogsResult`、`capture-screenshot → CaptureWindowScreenshotResult`。
这个映射写在 `DesktopCommandResults`（`desktop-shared/src/commands.ts`）里，**typecheck 是它的
唯一执行者**——所以 `lib/desktop.ts` 不再需要 `as Promise<...>` 断言。

缩放是主进程的独占职责：`applyZoom()` 既调 `setZoomLevel`，也往
`desktop:zoom-level-changed` 推一条 `{ zoomLevel }`，渲染器据此重算布局。

## 3. 深链

`planstar://…` → `routeFromUrl()` → `pendingRoute`（**单槽**，后写覆盖先写）→ 渲染器
`RendererReady` 或应用文档的 `did-finish-load` 时投递 → preload `pushState` + `popstate`。

单槽而不是队列：启动期间连点多个链接只有最后一个目标有意义，排队会让窗口启动后挨个跳一遍。

## 4. 自动更新

两套 feed，职责不重叠：

| 通道 | 内容 | 用途 |
| --- | --- | --- |
| `GET /api/desktop/releases/feed/latest-mac.yml` | electron-builder 原样输出 | `electron-updater` 读版本 + 产物 + sha512，自己下载并校验 |
| `GET /api/desktop/releases/manifest` | 服务端按 `DESKTOP_RELEASE_*` 拼的扁平 YAML | 只提供 `is_forced` 与 release notes |

状态机 `idle → checking → { available | not-available | error }`，`available → downloading →
update-downloaded → installing`，每次迁移都广播 `desktop:update-state-changed`。
`download-progress` 按 250ms 节流。策略固定为 `autoDownload=true` / `autoInstallOnAppQuit=false`，
没有偏好开关（见 [ADR 0025](../adr/0025-desktop-auto-update-via-electron-updater.md)）。

## 5. feature flag ↔ 实际能力对照

`HARNESS_DESKTOP_ENABLE_*` 的真值集合是 `1/true/yes/on`；其它值（包括空串）都是假。

每个子系统**默认开启**，env 是现场逃生阀：一个没有更新、崩溃上报、强更和日志上行的发布包，
等于无法运维的包，所以默认值不能是 off（见 `featureFlags.ts` 头注释与对应单测）。

| flag | 默认 | 打开后真实生效的行为 | `capabilities()` 字段 |
| --- | --- | --- | --- |
| `LOGGER` | on | 写 `userData/logs/YYYY-MM-DD.log`（按记录自身的 `time` 归日，保留 14 天） | —（不对外暴露） |
| `MENU` | on | 安装原生菜单与全部加速键；关掉 = 菜单和快捷键一起消失 | — |
| `FEEDBACK` | on | `open-feedback` 命令 + 截图 + 落盘 `userData/feedback` | `feedback` |
| `EXPORT_LOGS` | on | `export-logs` 命令（zip，结果带 `uploaded` 标记） | `exportLogs` |
| `AUTO_UPDATE` | on | 还要 `app.isPackaged` 才真正初始化（未打包时菜单项与 capability 都退化） | `autoUpdate` |
| `CRASH_REPORTER` | on | `crashReporter.start` + `render-process-gone` / `child-process-gone` 日志 | `crashReporter` |
| `FORCE_UPDATE` | on | 收到强制发布时广播 `desktop:force-update-required` → 渲染器开不可关闭弹窗；撤回走 `ForceUpdateCleared` | `forceUpdate`（= flag 且 autoUpdate 实际激活） |
| `LOG_UPLOAD` | on | 打包后把 logger 的记录批量 gzip 上报 `/api/desktop/logs`，离线 spool 到 `userData/logs/pending` | `logUpload`（= flag 且 `app.isPackaged`） |

`notifications` 与 `tray` **恒为 `false`**：契约里保留这两个字段（前端据此隐藏入口），但壳没有
实现，也不存在能打开它们的 flag。一个开关只在该文件里有读者时才存在——这是
`featureFlags.ts` 的取舍，测试里有对应断言。

## 6. 渲染器侧的身份

- 浏览器：`entry.web.tsx` 装 `window.Electron`（历史 mock）并调用
  `electronMock.installDesktopFacade()`，于是 `window.Desktop` 在浏览器里也存在，
  `desktop.isShell() === false`，更新状态等查询返回 mock 数据而不是 `null`。
- 桌面壳：真 preload 装 `window.Desktop`（`isDesktop: true`），`app.tsx` 给
  `<html data-harness-desktop>` 打标记，同时把 `document.title` 改成 `Planstar`，
  `desktop.css` 在该标记下隐藏 `.web-mode-indicator`。`index.web.html` 本身不改——它是 web 构建
  的真实输入。

## 7. 目录

```
front_web/electron/
  main.ts              # 生命周期：窗口、深链、IPC 接线、子系统 boot 顺序
  server.ts            # 只读静态服务器（:8321，路径包含性校验，最小强制 CSP + 其余 Report-Only）
  preload/{preload,bridge}.ts
  main/
    commandHandlers.ts menu.ts server.ts desktop.ts trustedUrl.ts
    deepLink.ts        # 解析 + 单槽 pendingRoute
    autoUpdater.ts     # electron-updater 控制器
    manifestProvider.ts# /releases/manifest 策略读取
    forceUpdateGuard.ts feedback.ts exportLogs.ts logger.ts logRetention.ts
    logUploader.ts deviceId.ts
    windowState.ts     # window.json 消毒
    featureFlags.ts    crashReporter.ts smoke.ts
front_web/packages/desktop-shared/   # 主/预加载/渲染器共享的契约
front_web/scripts/check-desktop-mock-parity.mjs
front_web/scripts/check-desktop-contract.mjs
```
