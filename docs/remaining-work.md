# Remaining Work（未完成项）

> 状态快照：2026-10-17。本文件只列「尚未完成」的工作。
> 已完成的功能以任务台账（Task 列表 `#83`–`#214`）与 `docs/adr/` 记录为准，不在此重复。

## 目标回顾

后端改用 Node（Hono RPC），通过命令 shim（`POST /api/command/:name`）承载 front_web 的全部接口与功能；范围是「自托管 Web 等价实现」，而非 Anytype 云端命令全集。

## 未完成的四个阶段

### P3 迁移完整 Tiptap 正文能力（#86，in_progress）— 主要剩余工作

当前正文通路（`front_web/src/ts/component/editor/collabBody.tsx`）只挂载了 `StarterKit`（关闭 undo/redo）+ `Collaboration`，只能渲染纯文本段落。缺少 Anytype 的 block 词表：

- 提及 / @对象（mention / object-link 节点）
- 标题层级、列表、待办项、代码块、分隔线等块类型
- 斜杠菜单（slash menu）（块拖拽排序已明确不做，见 ADR-0023）
- 行内格式与颜色

该阶段完成后才解锁：后端「正文链路投影到 Link 表」以及 Yjs 下的 dataview 视图块节点。可行性核对见下方「P3 可行性结论」——纯工作量阻塞，非工具能力阻塞。

### P4 完成视图集合搜索与图谱（#87，in_progress）— 收尾

搜索、图谱、集合、set/board、关系与选项、类型与模板、多值详情读写等已大量完成。剩余：

- dataview 的「视图集（views）渲染」，受 P3 的 Yjs dataview 节点阻塞。
- 订阅分页（ADR-0009）——有意不实现，见 `docs/adr/0009-object-cache-beside-query.md`。

### P7 实现历史发布与自托管服务（#90，已完成）

发布面：`PublishingCreate` / `GetStatus` / `Remove` / `List`，以及公开路由 `GET /publish/:uri`。
历史面：`HistoryGetVersions` / `HistoryShowVersion` / `HistoryDiffVersions` / `HistorySetVersion`（回滚走 `storeDocument` 正规写路径，snippet、正文链接与一条新快照保持一致）。
此前记录的「历史差异受正文块词表阻塞」是误判：该屏左侧渲染的**不是** Yjs 编辑器，而是 `HistoryShowVersion` 返回的 objectView 块树（`component/block/index.tsx:1282` 会渲染 `#block-<id>`），所以差异事件只要用同一套投影块 id 就能落地（#273）。

### P8 全量验收并退役旧传输（#91，pending）

- 功能矩阵对照闭环（逐项确认「全部接口与功能」均经本方后端运行）。
- 移除未使用的 gRPC / native mock 与旧传输通道。—— 2026-10-18 传输层已完成（`81419c2`：`service.ts` 只剩 JSON fetch + EventSource，descriptor/registry/interceptors/grpc-devtools 全部删除）；`package.json` 里已无人 import 的 `grpc-web`、`google-protobuf` 两个依赖待用户确认后再摘（#258）。
- 迁移恢复演练（手写 SQL + `prisma migrate deploy`，禁用 `prisma migrate diff`）。
- 全量 UI 浏览器验收（按屏截图比对，参照「一次标注一次修改」的做法）。

#### 2026-10-18 验收记录（本轮审计）

| 屏 / 能力 | 验收方式 | 结果 |
| --- | --- | --- |
| 集合屏视图族（建/切/删视图、筛选、排序、列、来源） | 走客户端自身命令层 + 刷新回读 | 通过：视图与筛选写入后刷新仍在，事件驱动本地 store 即时更新（#250） |
| 画廊渲染 | 建画廊视图 → 刷新 → 截图 | 通过：卡片按名称渲染（Grid + 画廊双标签） |
| 对象深链 / 刷新 | 直接刷新 `/main/set/<id>/spaceId/<s>` | 修复前落到 Widgets 页；修复后停在集合屏，8 行数据（#256） |
| 发布链接 | `PublishingCreate` → 打开链接 → `PublishingRemove` | 通过：`http://localhost:8000/api/publish/<slug>` 返回 200，撤销后 404（#253） |
| 实时推送 | 传输层重写后再验 | 通过：SSE 打开且收到 3 帧 `objectDetailsSet` |
| `?server=` 覆盖 | 用文档宣传的 `?server=http://HOST:PORT` 形式实际启动一次 | 修复（#277，audit §4-33）：入口/存储的值原样透传，命令打到 `/command/<Name>`（后端 404 且无 CORS 头）→ 登录页；且这个 origin-only 值被写回 localStorage 污染后续启动。现在 `serverAddress()` 三段优先级统一过 `apiBase()`：无 path 的地址补 `/api`，显式 path 原样保留，旧污染值下次启动自愈 |
| 接口全量巡检（重启后） | 杀掉 :8000/:3030 重启，逐屏 `U.Router.go` + 客户端自身命令层跑读写链路 | 通过（#277）：见 `docs/testing.md` 的 2026-10-19 复跑表——冷加载正文可编辑、0 个 `.dragHandle`、历史两版本+`blockSetText` 差异、聊天增删、发布链、导出 ZIP（PK\x03\x04）、SSE 200；除三个已知 code 12 与 `GalleryDownloadManifest` 外全部 code 0 |
| 数据是否只留在本机 | 逐条查存储位置 + 在页面里量 `performance` 非本地主机 + 读 define/Sentry/Amplitude 实际状态 | 存储部分全部本地（本地 Podman Postgres 的 Obj/DocumentState/DocumentVersion + `.data/` 磁盘文件；`.env`、`.data` 已 gitignore）。出网部分：Sentry 兜底 DSN 与 Spark onboarding 的 url+token 已从默认值里清空并加测试（#278，audit §4-34）；Amplitude 实例在 boot 时创建了，但 `isAllowed()` 在未打包构建里为 false，实测 0 条非本地请求。**遗留（#279）**：`front_web/src/json/constant.ts` 仍带着同一个 Sentry DSN、Amplitude key 与 Google Maps key，且 `77ed20d` 已推送——这些应按"已暴露"看待，是否改写历史需要你定 |
| 桌面端（Electron）端到端 | `HARNESS_DESKTOP_SMOKE=1` 在真实渲染进程里跑：注册 → 刷新 → 离开 `/auth/` → `AccountSelect` | 通过（ADR-0024）：未打包与**已安装**的 `~/Applications/Anytype Harness.app` 各跑一次，均 `ok:true`、signUp 200、`accountSelectCode:0`、标题 `Widgets - My Space - Anytype`；产物 `build/Anytype Harness-0.57.4-arm64.dmg` + `mac-arm64/*.app`；冒烟账号与其空间事后删除（0 残留） |
| 生产包里的已知缺陷（非桌面端引入） | 看 `dist-web/js/main.js` 加载时的未捕获 promise | `Cannot access 'v1' before initialization`：prismjs 语言表懒加载 IIFE 的 TDZ，在 `pnpm build` 产物里（web 与桌面同一份 bundle），不影响启动/登录/编辑；此前验证都走 dev server 所以未暴露，尚未修 |
| 登录 / 注册页布局 | 在 `http://127.0.0.1:3030/auth/better-login` 逐行量几何（127.0.0.1 拿不到 `localhost` 的会话 cookie，boot 门禁鉴权失败才会停在登录页，不会把探针跳走） | 修复（#282）：字段容器原来叫 `input`，同时命中全局 `.input` 药丸样式和 `.pageAuth .input{height:40px;text-align:center}` —— 22px 标签 + 28px 输入塞进 40px 的壳，每行溢出 10px 压到下一行（截图里的重叠）。改名 `.field`，并补上此前完全没有的 `.pageAuthBetterLogin` 作用域：424px 卡片 + 48px 内边距、intro 28px/16px 排版、48px 方框输入（左对齐、focus 描边）、错误行 16/24px 间距。实测登录 2 行、注册 3 行，`label.bottom ≤ input.top` 逐行成立，行距 16px；`Button` 渲染的是 div，表单没有 submit 按钮 → 多字段时 Enter 无效，已补 Enter 提交并在请求期间禁用按钮 |
| 登录成功后的去向 | 用注册表单实际走一次 signUp → 看落在哪 | 修复（#283）：成功回调原来是 `U.Router.go('/auth/better-account')`，而选中账号、打开空间的 `bootWebAccount()` 只在 `app.tsx` 的 `onInit` 冷启动门禁里跑 —— 应用内换路由不会重跑它，所以停在一个手写占位页（它自己注释就写着"后续阶段再长进工作区"），页面上只有 Sign out。现在成功后交还给入口做一次真实加载，实测落到 `/main/edit/<home>/spaceId/<space>`、标题 `Widgets - My Space - Anytype`；占位页 `betterAuthAccount.tsx` 与其路由一并删除（服务端 `AccountSelect` 的 `resolveSpace` 已经负责给新账号建默认空间，页面里的 `ensureBootstrapSpace()` 是重复实现） |
| 未登录时打开分享链接 | 冷加载一个 `/main/edit/…` 深链 → 被门禁弹到登录页 → 登录 → 看最终落在哪 | 修复（#284）：入口原本把路由写进 `anytype_redirect`，而那正是 `Storage` 映射 `redirect` 用的键 —— 一次没走完的启动会读它并清掉，所以轮到登录时已经没了。现在 `lib/web/deepLink.ts` 自己拥有 `anytype_authReturn`（`rememberRoute` / `takeRememberedRoute`，取一次即清，且只认 `/main/` 前缀，避免把存储值直接交给 `location.href` 造成开放重定向），登录成功落回原链接，没有链接时落 `/`。实测：把地址栏改成 `/` 再提交，最终停在原深链 |
| 成员 / 邀请面板 | `/main/settings/spaceShare` → 截图 | 修复后通过：`subSpace` 订阅应答后 `isMyOwner`/`canManageInvite` 为真，分享开关与 Copy link / QR / Manage link / Reset link 全部渲染（#259） |
| 邀请链接 | `getInviteLink` 单测 + 实盘 | 修复：web 构建此前只发 `anytype://` 链接（本站没有协议处理程序），改发本应用 `/invite/` 路由 |
| 设置-通用 | 截图 | 通过：空间卡 + Copy link / QR + Homepage / Sidebar View / Default Object Type 偏好项 |
| 设置-通知 / 远程存储 / 回收站 / 导入 / 导出 | 逐屏 `Action.openSettings`，控制台零错误 + 实盘执行 | 渲染通过；导入已可执行（#153）、导出已可执行并下载归档（#274）、拖拽落文件写入正文（#152）；存储用量依赖 `FileNodeUsage`（桌面能力，NOT_SUPPORTED） |
| 内容模型（Object Types / Properties） | 打开侧栏 rail → 截图 | 修复后通过：`library` 订阅改由注册表投影应答，rail 列出 4 个类型并能进入类型编辑器（#261） |
| 移除历史 | 新建对象 → 删除 → 重开该屏 | 通过：新行「Removed by = P1 Fresh、Removed = October 18, 2026」；旧行三列为破折号，因为删除发生在 deletedBy/deletedDate 迁移之前 |
| 记录形状契约 | 白屏崩溃定位 | 修复：`restrictions` 必须是**数组**——`S.Block.isAllowed` 用 `indexOf` 读它，`{}` 会让整棵 React 树白屏；spaceview 的 `creator` 必须是 participant id，`U.Space.getCreator` 才能解析 |
| `id` 过滤器 | 实盘 + 集成测试 | 修复：`id In [...]` 此前被静默丢弃，一次订阅返回全空间 46 行；`id` 已登记为系统关系（#260） |
| 图谱屏 | `/main/graph/...` → `ObjectGraph` 实盘 | 修复：edges 只读 Link 表，而命令写入路径把对象关系存在 details JSONB（ADR-0002）→ 29 节点 0 连线；现两表并读并去重 |
| 类型页（rail 点类型） | 点侧栏 Page → `/main/set/<typeId>` → 截图 | 修复：类型页打开的是**类型对象本身**，而该屏只渲染 root 的 dataview 子块并按记录的 `setOf` 解析查询源；类型两者皆无 → 只剩标题（实盘：空间有 7 个 page 对象却一行不显）。现在打开类型时补 `setOf: [typeId]` 并像 set 一样引导默认视图，Grid 列出 7 行 |
| 回收站（Bin） | 归档一个对象 → `/main/archive/<spaceId>` → 还原 | 修复：Bin 用 `subId: "archive"` + `isArchived` 过滤订阅，而 "archive" 被列进 EMPTY_SUB_IDS → 永远 "Your Bin is empty"、还原无从点起；现走通用过滤订阅，实盘归档/还原往返通过 |
| 空间聊天页 | 打开 `/main/chat/<chatId>/spaceId/<s>` → 发消息 → 截图 | 修复：spaceview.chatId 恒为空且空间没有 chat 对象，页面只剩输入框、读取全返回 NOT_FOUND；现在每个空间引导一个 chat 系统对象（layout 22），消息可读可写并渲染。`creator`/表情回应 id 改为账号 id（客户端 `creator == account.id`），自己的消息已按 isSelf 右对齐、作者名可解析 |
| 聊天已读状态 | 打开聊天页后观察 `ChatReadState.order` 是否停止增长 | 修复：无变化的读取也递增 order → 客户端每次都套用状态并重新触发读取，两分钟内打出约 2.8 万次 `ChatReadMessages`（order 到 57058）并卡死标签页；水位未动的读取现在原样返回 |
| 表情回应实时渲染 | 悬停消息 → 点回应 → 气泡出现 `.reaction.isSelf` | 修复：所有 chat 事件的 `subIds: []`，而客户端按 subId 派发，事件谁也没送达；现在打开聊天即登记 subId（ChatUnsubscribe 释放），删除/编辑/回应/置顶也向同空间成员推送 |
| 「已编辑」标记 | 发一条新消息 → 刷新 → 看气泡是否带 edited | 修复：`addMessage` 把 `modifiedAt` 直接戳成创建时间，而客户端只要 `modifiedAt` 非 0 就显示 "(edited)"（`block/chat/message/index.tsx:261`）→ 每条消息一落地即被标记。现在新建为 0，只有 `ChatEditMessageContent` 会写它；改动前写入的开发数据仍带标记，未做回填 |
| 双账号邀请加入 + 通知面板 | 第二个账号 SpaceInviteView/SpaceJoin(WithApprove) → 拥有者刷新看通知卡 → View request → Editor access → 请求者收到批准通知 | 通过：请求行 status=joining、拥有者收到 requestToJoin 卡片（"Probe Requester has requested to join 'My Space'"）、批准后成员转 active、请求者收到 participantRequestApproved（文案把 permissions=1 渲染成 Editor），participant 订阅两人各带 participantStatus=1。缺陷：space view 的 readersLimit/writersLimit 为 0，使确认弹层把 Accept/Reject 换成会员升级按钮（#21），已修复为 1000 席 |

| Collection 页 | 建对象 → ObjectToCollection → ObjectCollectionAdd → 打开 /main/set/&lt;collectionId&gt; → 看网格 | 通过（含实盘网格行）：先修视图补齐只覆盖 Set/Type 的问题；但网格仍然空的真因在客户端日志 `[BlockDataview.loadData] No sources` —— loadData 需要块内容里的 `TargetObjectId`/`isCollection`（mapper.ts:278）才认得这是个 collection，而投影把它写死成 `""`/`false`。现在投影把 collection 自身作为块的 target，实盘网格显示「Name / Bergen wharf / Trollstigen lookout」 |

| 模板套用 | C.ObjectApplyTemplate(目标页, 模板) → 打开目标页读正文 | 通过：实盘把模板「Widgets」的正文（Clean component persists too / 1235 sfesf / diff-probe …）复制到新建页并在编辑器里渲染出来；探针对象两步删除后 ObjectOpen 返回 NOT_FOUND，顺带验证了回收站彻底删除路径 |
| 搜索的嵌套类型过滤 | type.uniqueKey Equal ot-template | 缺陷：订阅走 `typeUniqueKeyClause` 解析该键，而 ObjectSearch / ObjectSearchWithMeta 只用扁平编译器，点号键被静默丢弃 → 返回空间全部可见对象（实盘查模板却返回 page 对象）。现两个搜索入口都并上同一子句。第一版测试是**假绿**（只断言隐藏注册表行不出现），改成两个可见不同类型对象才真正变红 |

| 正文内联 dataview 绑定（#257） | C.ObjectCreateSet → C.BlockDataviewCreateFromExistingObject(页, 块id, set) → 读回调 message.views | 通过：命令此前完全无答案（code 12），内联块的目标选择器一点就静默失败；现在按 host 页写权限设闸、目标限同空间、补齐默认视图并回 `{blockId,targetObjectId,view}`。实盘回调拿到 Grid 视图含 Name 列。顺带修掉两处衍生缺陷：无源 set 每次打开都新建视图（幂等判断错把 sourceTypeId 当必要条件），以及视图仓库总会写一条 `toId: ""` 的悬空 source 边 |

| 设置 → AI 提供商 | C.AIListModels 指向一个不存在的本地 provider → 看回调错误码 | 通过：命令此前返回 code 12，模型下拉永远空；现在按 OpenAI 兼容协议请求 `<endpoint>/models` 并带 bearer token，失败映射成客户端自己的 `AiListModelsErrorCode`。实盘返回 101 NotReachable（带 description）。出站地址受 link-preview 同一套分类器管制，只额外放行 loopback（Ollama/LM Studio 在本机），且不跟随重定向。测试用本地假 provider（127.0.0.1 随机端口）跑通 200/401/拒连/私网/坏 URL/非模型列表 7 条 |
| 旧传输依赖 | front_web `pnpm typecheck` + `pnpm test` + 应用启动 | 已删：`grpc-web`、`google-protobuf` 两项（确认全仓无 import、codegen 只用 ts-proto），install 减少 2 个包；客户端 1397 项测试与 typecheck 全过，Vite 页面照常启动并恢复空间 |

| 历史差异标记（#273） | 同一对象写三份快照 → `/main/history/<id>` → 读渲染出的 DOM 类名 | 修复：`HistoryDiffVersions` 事件按 `prisma.block` 行 id 出题，而预览块树是 `HistoryShowVersion` 现场投影的（Yjs 对象往往零 Block 行），客户端 `renderDiff` 找不到任何 `#block-<id>` → 差异面板什么都没标。现在两侧共用同一套「行序号」投影 id（`bodyLineId`），改行→blockSetText、增行→blockAdd、删行→root 的 blockSetChildrenIds，并跳过只因位置移动而行内容没变的配对。实盘：新增行 `.wrapContent.diffAdd`、改写行渲染出 `<markupchange> south</markupchange>`、删行 `.diffRemove` 都落在预览树上。残余近似：快照只是扁平文本行，中间删除的红色标记落在序号不再对齐处，不是被删行的精确位置 |
| 类型推荐布局（#275） | 侧栏把类型设成 Task → 建新对象 → 打开类型网格 → 点「Reset to match the Type」 | 修复：推荐值一直存得下来但没人读，`ObjectCreate` 固定 `basic`，`ObjectTypeResolveLayoutConflicts` 无答案（且客户端不发回调，弹框关掉像无事发生）。现在建对象继承类型推荐，重置命令批量改写该类型下不一致的对象并重算订阅。实盘：新建对象投影 `layout: 2`，旧对象在重置回 0 之后从 `layout: 0` 变成 2，类型网格里那一行渲染成 `class="row isTask"` |

验收清单已全部走完实盘（含 collection 网格行）。文件三兄弟（导入 #153、落盘 #152、导出 #274）也已逐个实现并实盘。仍然**延期**而非「待验收」的只剩：#100（ADR-0018 正文持久化水位与客户端 ack）、#154（`?width=` 缩略图，只是带宽）。

审计最后一条新发现的缺陷 #275「类型的推荐布局对对象毫无作用」**已修**（ADR-0022）：类型侧栏把 `recommendedLayout` 写进了库（走已实现的 `ObjectListSetDetails`），但 `ObjectCreate` 固定写 `basic` + `details.layout: "page"`，而类型页头部的「Reset to match the Type」发的 `ObjectTypeResolveLayoutConflicts` 根本没有答案，且客户端不接回调 —— 确认框关掉后空间毫无变化。两处都不是加 `case` 能了事的：客户端能选的 Human(1)/Task(2)/Note(9) 在 Prisma 的 `ObjectLayout` 枚举里根本没有成员可存。所以先做加性 migration（`human`/`task`/`note`），再补 `numericLayout` 的数字表，然后建对象时继承类型推荐，最后由 `ObjectTypeResolveLayoutConflicts` 批量把该类型下已存在的对象改写过去（按空间的 writer 权限设闸，未知 id 回 3、非类型对象回 12，写完触发订阅重算，打开的列表不用刷新就更新）。**有意只修布局那一半**：文案里的 alignment 在本架构里属于 Yjs 正文（逐段落），对象上没有可还原的对齐；featured relations 也没有类型侧默认值可抄；Set/Collection 这类列表布局不会被继承，因为查询源不是推荐能给出来的。实盘（跑在浏览器里的客户端）：推荐 Task 之后新建对象 `ObjectShow` 回 `{layout: 2, resolvedLayout: 2, done: false}`；推荐之前建的对象一直是 `layout: 0`，直到重置命令回 0 后它的投影变成 2；类型自己的网格把该行渲染成 `class="row isTask"`，也就是客户端的布局守卫在按投影决定长什么样。

但审计收尾时按客户端实际可达性复核后，#152 / #153 的标签并不一样，已写进 `docs/interface-audit.md` §3c：

- ~~**#153 的导出半边确实不可达**~~ → **已实现（#274）**：目录确实拿不到（web picker 只会选文件、并把选中的文件上传后当作「目录」返回），所以不再要目录 —— `Action.export` 在 web 分支跳过 picker、传空 path，服务端把归档写到自己的 `EXPORT_ROOT` 并回一个下载 URL，浏览器按普通下载保存。归档由 `src/modules/files/zip.ts` 手写 store-only ZIP（不压缩、零新依赖，因为任意大小的选择集都必须是一个文件），正确性用 `unzip -t` 的单测兜底。格式只支持 Markdown / JSON；Protobuf / Dot / Svg / GraphJson / AnyBlockV2 回 code 12 并写明原因。实盘：导出整个开发空间返回 `{objectCount: 43, objectErrors: 0}`，取回的 URL 是 200 / `application/zip` / 5136 字节 / `PK\x03\x04`。
- ~~**#153 的导入半边是可达且缺的**~~ → **已实现（#153）**：picker 已经把字节 POST 到 `/api/web-upload` 并返回真实暂存路径，服务端 `importFiles` 现在读这些路径：Markdown / Obsidian / HTML / 纯文本各自成页（名字取第一个标题或 `<h1>`，纯文本取文件名），正文用 `storeDocument` 正规写入，块形状是 `Y.XmlElement("paragraph")` + `Y.XmlText` 子节点（不是历史预览那套裸 XmlText，否则编辑器打开是空文档）。Notion / CSV / Protobuf 仍回 code 12 并在 description 里说明原因。顺带把 **两个文件命令共用的任意路径读取** 关进围栏：`FileUpload` 的 `localPath` 以前直接 `readFile`，任何空间 writer 都能把 `/etc/passwd` 存成文件对象再用 `GET /file/:id` 取回；现在 `staged-path.ts` 只允许两个上传暂存根目录。实盘：经应用自身上传通道落盘的真实 .md 用 `C.ObjectImport` 导入返回 0，打开该页编辑器渲染出两个段落。
- ~~**#152 拖拽落文件在到达服务端之前就坏了**~~ → **已实现（#152）**：mock 新增 `uploadStaged(files)`，把落下的 File 走 picker 同一条 `/api/web-upload` 通道换成真实暂存路径，`drag/provider.tsx` 在调用 FileDrop 前 await 它（桌面仍用它自己的路径）；服务端 `file-drop.ts` 把每个路径变成文件对象，并在正文尾部追加编辑器的 `attachment` 节点。第三处缺陷是查结果时发现的：两条上传通道都会把落盘文件改名成 `<时间戳>-<随机>-<原名>`，谁都没还原，所以用户会看到 `1792376026484-awwcne-ferry-timetable.txt`；现在 `stagedFileName` 为 FileUpload/导入/落盘统一剥掉前缀。dataview 单元格那一侧（`block/dataview.tsx:1877`）明确回 code 12：落到 set 视图上「这个文件属于哪条记录」没有可猜的答案。`popup/upload.tsx:82` 在浏览器里根本不会触发（它只在目录时调用，而 mock 的 isDirectory 恒 false），不是坏掉。

> 教训：`EMPTY_SUB_IDS` 里「不是对象列表」的判断必须由客户端实际解析路径反证。`subSpace` 与 `library` 都曾以「非对象列表」名义被留空，结果分别是所有权闸门全灭与内容模型 rail 空白。


## P3 可行性结论：Tiptap（免费/MIT）可全覆盖

「受 P3 阻塞」是**工作量**阻塞，不是工具能力阻塞。核对 Tiptap v3 官方文档后，P3 的每一项都能用开源（MIT）依赖实现，无需任何付费能力（Tiptap Cloud / AI / Comments / Tracked Changes / `@tiptap-pro` 均不需要）。

当前 `collabBody.tsx` 只挂 `StarterKit(undoRedo:false)` + `Collaboration`；已装依赖仅 `@tiptap/core`、`@tiptap/react`、`@tiptap/starter-kit`、`@tiptap/extension-collaboration`（均 ^3.32）。

### 阻塞项 → 免费依赖映射

| 阻塞项 | 免费方案 | 状态 |
|---|---|---|
| 标题/列表/引用/代码块/分隔线/链接/下划线 | StarterKit 已内置这些 node+mark | 已装，只差 UI 暴露 |
| 待办清单 checkbox | `@tiptap/extension-list`（v3 合并包，含 TaskList/TaskItem） | 需新增 |
| 行内颜色/高亮 | `@tiptap/extension-text-style` + `@tiptap/extension-color` + `@tiptap/extension-highlight` | 需新增 |
| @对象/提及（object-link chip） | `@tiptap/extension-mention` + `@tiptap/suggestion` + 自定义 Node + React NodeView | 需自建（Tiptap 给原语） |
| 斜杠菜单 | `@tiptap/suggestion` + 官方 Slash Commands 示例 | 需自建 React 浮层 |
| 块拖拽排序 | ~~`@tiptap/extension-drag-handle`~~ | **明确不做**（ADR-0023：与外壳自己的块拖放是两套并行逻辑，grip 已摘除） |
| 占位符 | `@tiptap/extensions`（v3） | 需新增 |
| 代码语法高亮（可选） | `@tiptap/extension-code-block-lowlight` + `lowlight` | 可选 |
| 协作/撤销重做 | `@tiptap/extension-collaboration` + Hocuspocus（MIT，替代付费 Tiptap Cloud） | 已装 |

### 判断要点

1. 唯一「自建」部分 = object-link / dataview 块节点：对象 chip 渲染、对象记录订阅解析（id→名称/图标）、后端 Link 投影都是本仓代码；Tiptap 的 `Node.extend` + `ReactNodeViewRenderer` + `Suggestion` 原语完整覆盖，`Collaboration` 会把自定义节点 attrs 一并同步进 Yjs，与现有 Hocuspocus 持久化、`bodyTextFromState` 解码链路兼容。
2. 付费边界与本例无关：Tiptap Cloud（托管协作后端，已由免费 Hocuspocus 替代）、AI、Comments、Tracked Changes、`@tiptap-pro` 进阶扩展均不需要。
3. P7 History 恢复走 Yjs 版本/Y-update 快照，属服务端实现，非 Tiptap 能力。

参考：tiptap.dev/docs（StarterKit / Mention / Suggestion / Task List / Text Style / Placeholder / Drag Handle / Slash Commands）。

## 明确延后（Deferred）

- **#100** ADR-0018 持久提交 watermark + 客户端 ack 状态。
- **#154** P5-g 图片缩略图缩放（`?width=`）：带宽优化；浏览器可对原始字节做 CSS 缩放，延后。

## 明确不实现（客户端无调用路径，不视为未完成）

以下命令在 front_web 中没有任何调用路径，属范围外，明确不实现：

- `ObjectTypeRelationAdd` / `ObjectTypeRelationRemove`
- `WorkspaceObjectAdd` / `WorkspaceObjectListRemove`
- `ObjectCollectionSort`、`SpaceJoinCancel`、`ObjectDuplicate`
- `ObjectChatAdd`、`ObjectShareByLink`、`PublishingResolveUri`
- 78 个 `Block*` 与 `History/Undo/Redo` 命令：由 Yjs 正文模型取代（ADR-0018）。
- 云盘 / native / debug / 文件节点 / wallet / AI / 画廊 / 会员计费等命令族：范围外。
  （`ObjectListExport`、`ObjectImport`、`FileDrop` 已从这一族中拆出并在 Web 侧落地，见 `docs/interface-audit.md` §3c 与上面的 P8 验收记录。）