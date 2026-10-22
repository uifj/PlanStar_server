# 桌面端发布流程

面向 macOS arm64 的本地（未签名）安装包。三个产物必须一起发布：`latest-mac.yml`、`*.zip`、
`app-update.yml`。少任何一个，更新链路就会退化成"检查得到、下载不了"。

## 1. 打包

```bash
cd front_web
pnpm dist:mac          # build:desktop + electron-builder --mac --arm64 --publish never
```

`--publish never` 是必须的：没有它 electron-builder 会尝试按 `publish.provider` 上传，在没有
凭据的机器上以失败告终，并被误读成"打包失败"。

`electron-builder.yml` 里 `mac.target` 是 `dir + dmg + zip`，`publish.provider` 是占位的
`generic`。占位 URL **不会**被上传（调用时没有 `--publish always`），它存在的唯一目的是让
electron-builder 生成两个更新元数据文件：

| 产物 | 位置 | 谁读 |
| --- | --- | --- |
| `latest-mac.yml` | `front_web/build/` | 服务端 `/releases/feed/latest-mac.yml` 原样转发给 electron-updater |
| `*.zip`（arm64） | `front_web/build/` | electron-updater 下载并由 Squirrel.Mac 安装 |
| `app-update.yml` | `Planstar.app/Contents/Resources/` | 打包时的 feed 记录；运行时被 `setFeedURL` 覆盖，仅作诊断用 |

`dmg` 仍然产出，但更新链路不使用它：Squirrel.Mac 只吃 `.zip`。

CI 的 `desktop-package` job 会跑 `pnpm verify:desktop-feed`，它断言三件事：`build/*.yml` 里
`path` / `files[].url` 指向的归档确实在 `build/` 里、yml 的 `sha512` 与归档的 base64 SHA-512
一致、`version` 与 `package.json` 一致。以前这里只 `grep sha512`，漏掉的正是"文件名对不上"
这一类——客户端要下完 150 MB 才会发现。

## 2. 发布到服务端

不要手工 `cp`。用脚本，它把"校验 → 拷贝 → 写环境变量 → 重启 api → 等就绪"串成一条：

```bash
# 仓库根目录
pnpm --dir front_web verify:desktop-feed        # 先确认元数据与归档一致
deploy/podman/scripts/stage-release.sh           # 默认取 front_web/build
deploy/podman/scripts/stage-release.sh --forced  # 本次为强制更新
deploy/podman/scripts/smoke.sh                   # 5 项检查
```

手工等价操作（仅在容器外排查时使用）：

```bash
cp front_web/build/latest-mac.yml \
   front_web/build/*-arm64-mac.zip \
   "$DESKTOP_DATA_ROOT/releases/"
```

目录结构：

```
$DESKTOP_DATA_ROOT/
└── releases/
    ├── latest-mac.yml
    └── Planstar-0.59.0-arm64-mac.zip
```

服务端有两条互不相干的出手点：

| 路由 | 内容 | 职责 |
| --- | --- | --- |
| `GET /api/desktop/releases/feed/{filename}` | electron-builder 写出的 `latest-mac.yml` 原文，或它引用的归档 | 版本号、文件名、sha512 —— **不做任何重写** |
| `GET /api/desktop/releases/manifest` | 由 `DESKTOP_RELEASE_*` 环境变量拼出的扁平 YAML | 策略：`is_forced`、`releaseNotes` |
| `GET /api/desktop/releases/download/{filename}` | `$DESKTOP_DATA_ROOT/releases/` 下的归档 | 旧的手工下载通道（客户端已不再使用，保留给脚本） |

两条 `{filename}` 路由的分流规则相同（`src/modules/desktop/feed.ts`）：

- 名字匹配 `^(latest|beta|alpha|next)(-mac|-linux)?\.yml$` → 按元数据原样返回，`Content-Type: text/yaml`；
- 其余一律走**引用白名单**：名字必须出现在 releases 目录里某个 `*.yml` 的 `path:` 或
  `files[].url:` 中，且解析后仍在 releases 根目录内，否则 404。产物用流式响应发送
  （`createReadStream` + `Content-Length`），不会把 150 MB 读进内存。

`electron-updater` 用 `new URL(fileInfo.url, feedUrl)` 解析，所以 yml 里 `path` 是裸文件名时，
请求就是 `/releases/feed/<zip>`——这正是上面第一条要同时服务 yml 与归档的原因。

### `DESKTOP_RELEASE_*` 与 `/manifest` 的对应关系

| 环境变量 | 作用 | 缺省 |
| --- | --- | --- |
| `DESKTOP_RELEASE_VERSION` | 策略版本号；**为空则 `/manifest` 返回 404**（客户端视为"没有发布"） | 空 |
| `DESKTOP_RELEASE_PATH` | 策略条目指向的产物文件名；**可选**，缺省时 manifest 不写 `path:` 行（客户端会退回读 feed 里的 `path`） | 空 |
| `DESKTOP_RELEASE_DATE` | 写进 manifest 的 `releaseDate` | 空 |
| `DESKTOP_RELEASE_SHA512` | 仅供人工核对；客户端校验的是 feed 里的 sha512 | 空 |
| `DESKTOP_RELEASE_NOTES` | release notes 正文（支持多行，服务端缩进成块标量） | 空 |
| `DESKTOP_RELEASE_FORCED` | `1/true/yes/on` 时 `is_forced: true`，触发强更弹窗 | 假 |

`/manifest` 与 `latest-mac.yml` 的版本号必须一致，否则强更弹窗会开在错误的版本上（客户端只在
`manifest.version === updater 报告的 version` 时才宣布强制更新）。

撤回强更：把 `DESKTOP_RELEASE_FORCED` 改回 `false` 并重启 api（或 `stage-release.sh` 不带
`--forced`）。主进程会通过 `ForceUpdateCleared` 推送撤回信号，渲染层关闭弹窗并把
`wantForceUpdate` 复位；窗口重建后 `getForceUpdateState()` 返回 `null`，弹窗不会复活。

## 3. 发布顺序：先服务端，再客户端

1. **升级服务端**（新增 `/releases/feed/{filename}` 路由）。
2. 把 `latest-mac.yml` 与 `.zip` 放进 `$DESKTOP_DATA_ROOT/releases/`。
3. 设置 `DESKTOP_RELEASE_*`，确认 `curl` 两条路由都通。
4. 再分发新客户端。

反过来的话，旧客户端拿到 `latest-mac.yml` 也没关系（它不读这条路由）；但新客户端撞上旧服务端时
会拿到 404，界面上表现为一次"检查更新失败"，不会崩，也不会装错包。

## 4. 签名缺失的影响

`electron-builder.yml` 里 `identity: null`，产物是 ad-hoc 签名的未签名包。后果只有一条但很硬：

> **能验证到 `update-downloaded`，不能安装。** Squirrel.Mac 会拒绝签名无法校验的包。

因此：

- `updater.autoInstallOnAppQuit = false`，退出时不会静默尝试安装（那会变成"退出即崩"）。
- 用户点"重启以更新"失败时，状态落到 `error` 并在界面上报错，主进程不退出。
- 要真正安装需要 Developer ID + 公证，是独立议题，不在当前范围内。

## 5. 自检清单

```bash
# 产物齐全 + 元数据与归档一致
ls front_web/build/latest-mac.yml front_web/build/*.zip
pnpm --dir front_web verify:desktop-feed

# 服务端转发正确（应返回 latest-mac.yml 原文）
curl -s "http://localhost:8000/api/desktop/releases/feed/latest-mac.yml" | head

# 引用白名单：yml 里出现的名字 200，随便一个名字 404
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:8000/api/desktop/releases/feed/Anytype%20Harness-0.57.4-arm64-mac.zip"
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:8000/api/desktop/releases/feed/nope.zip"        # 期望 404

# 策略通道正确
curl -s "http://localhost:8000/api/desktop/releases/manifest?platform=darwin-arm64&channel=stable"
```

手动验证更新：把 `front_web/package.json` 的 `version` 加一、重新 `pnpm dist:mac`、用
`stage-release.sh` 发布，然后用**旧版**已安装的 app 触发检查。三条路径等价，任选其一：

1. 菜单 `Help → Check for Updates…`（`electron/main/menu.ts` 的 `help.checkForUpdates`）；
2. 应用内的更新入口，它走命令总线 `executeCommand("check-for-updates")`；
3. `node scripts/e2e/desktop-packaged.mjs`，CDP 驱动同一条命令并断言事件序列（推荐，唯一可重复的一种）：

   ```bash
   # 1) 起一个“强更”态的服务端：$DESKTOP_DATA_ROOT/releases 里需已 stage 了更高版本
   sh scripts/e2e/local-api.sh forced

   # 2) 跑 e2e。撤回、断网、崩溃计数都指向这个本地服务端（默认值指向 compose 栈）
   HARNESS_API_URL=http://localhost:8090 \
     E2E_EXPECT_FORCED=1 \
     E2E_WITH_CRASH=1 \
     E2E_RETRACT_CMD='sh scripts/e2e/local-api.sh retracted' \
     E2E_OFFLINE_CMD='sh scripts/e2e/local-api.sh stop' \
     E2E_ONLINE_CMD='sh scripts/e2e/local-api.sh forced' \
     E2E_CRASH_LIST_CMD='ls -1 /tmp/harness-desktop/crash 2>/dev/null | wc -l' \
     node scripts/e2e/desktop-packaged.mjs
   ```

   四个开关对应四条需要“动服务端”的断言：`E2E_RETRACT_CMD`（撤回强更）、
   `E2E_OFFLINE_CMD`/`E2E_ONLINE_CMD`（把 API 拿掉再还回来，制造主进程的离线态）、
   `E2E_CRASH_LIST_CMD`（数 `DESKTOP_DATA_ROOT/crash` 里的 minidump）、`E2E_WITH_CRASH=1`
   （崩溃腿会杀掉窗口，所以排在最后）。`E2E_LOG_READ_TOKEN` 默认
   `local-desktop-log-read-token`，与 `local-api.sh` 一致。

   两个时间常量按 `electron/main/logUploader.ts` 的 `DEFAULT_FLUSH_INTERVAL_MS = 30_000` 校准：
   `E2E_FLUSH_INTERVAL_MS`（默认 35 s，一次离线 flush 落一个 spool 文件）、
   `E2E_MODAL_TIMEOUT_MS`（默认 120 s，弹窗不可能早于 SPA 挂载完成）。

   最后一次实测输出（macOS arm64，unsigned 包，2026-10-22）：`27 passed, 0 failed`，证据落
   `deploy/podman/e2e-artifacts/desktop-packaged-2026-10-21T17-38-02-589Z.json`。断言覆盖：

   | 腿 | 实测 |
   |---|---|
   | 渲染层身份 / 四个 capability 默认开 | `isDesktop` true；`autoUpdate`/`crashReporter`/`forceUpdate`/`logUpload` 均 true |
   | 桌面源登录（跨站 Cookie） | sign-up 200；下一次跨站请求带上 Cookie，`get-session` 返回同一邮箱 |
   | SSE | `EventSource(/api/events, withCredentials)` → `opened:true, readyState:1` |
   | 更新链路 | `update-downloaded`（sha512 由 electron-updater 校验） |
   | 强更 | `getForceUpdateState()` → `{version: 0.58.0}`；`[data-testid="force-update"]` 弹窗渲染 |
   | 撤回 | `ForceUpdateCleared` 到达 → 弹窗关闭 → `getForceUpdateState()` 回到 `null` |
   | 日志导出 | `export-logs` 返回 `uploaded: true` |
   | 离线 spool → 补投 | API 下线后 3 批落 `userData/logs/pending`；恢复后 0 剩余，服务端可查 15 条匹配记录 |
   | 崩溃上报落盘 | `Page.crash` 后 minidump `4 → 6` 个文件落 `DESKTOP_DATA_ROOT/crash`，且 crash 记录可经 operator token 查到（7 条），主进程未随之退出 |

   强更弹窗必须比页面活得久：启动阶段首屏 `Page` 卸载会调用 `S.Popup.closeAll()`，而弹窗正是在
   SPA 挂载后立刻打开的，二者相差不到一帧——旧实现里弹窗会被这次清扫带走（E2E 的
   `blocking modal is rendered` 因此 120 s 超时）。弹窗现在带 `preventCloseAll: true`
   （`store/popup.ts` 的 `closeAll` 跳过该标记），只有 guard 自己在撤回时显式关闭它；
   `store/popup.test.ts` 钉住这两条语义。

   未加 `E2E_WITH_CRASH=1` 时崩溃腿打印 `SKIP renderer crash report`，其余 24 项照跑。

期望状态依次为 `checking → available → downloading → update-downloaded → installing`，日志里能看到
`download-progress` 的百分比。最后那个 `installing` 是强更弹窗在收到 `update-downloaded` 后自动调用了
`quitAndInstallUpdate()`（`popup/forceUpdate.tsx:30-32`，强更不留给用户“稍后”的选项）；未签名包会被
Squirrel 拒绝，因此进程不会真的退出——E2E 后续步骤照常跑完。**到此为止**——未签名产物无法安装，见 §4。
