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
- 斜杠菜单（slash menu）与块拖拽排序
- 行内格式与颜色

该阶段完成后才解锁：后端「正文链路投影到 Link 表」以及 Yjs 下的 dataview 视图块节点。可行性核对见下方「P3 可行性结论」——纯工作量阻塞，非工具能力阻塞。

### P4 完成视图集合搜索与图谱（#87，in_progress）— 收尾

搜索、图谱、集合、set/board、关系与选项、类型与模板、多值详情读写等已大量完成。剩余：

- dataview 的「视图集（views）渲染」，受 P3 的 Yjs dataview 节点阻塞。
- 订阅分页（ADR-0009）——有意不实现，见 `docs/adr/0009-object-cache-beside-query.md`。

### P7 实现历史发布与自托管服务（#90，in_progress）— 发布面已完成

发布面已完成：`PublishingCreate` / `GetStatus` / `Remove` / `List`，以及公开路由 `GET /publish/:uri`。剩余：

- History 版本恢复（历史版本回滚），受 P3（正文块词表）阻塞。

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
| `?server=` 覆盖 | 读代码 + 单测 | 修复：入口解析了参数但传输层自行取 env/origin，覆盖无效；现统一由 `serverAddress()` 决定 |
| 成员 / 邀请面板 | `/main/settings/spaceShare` → 截图 | 修复后通过：`subSpace` 订阅应答后 `isMyOwner`/`canManageInvite` 为真，分享开关与 Copy link / QR / Manage link / Reset link 全部渲染（#259） |
| 邀请链接 | `getInviteLink` 单测 + 实盘 | 修复：web 构建此前只发 `anytype://` 链接（本站没有协议处理程序），改发本应用 `/invite/` 路由 |
| 设置-通用 | 截图 | 通过：空间卡 + Copy link / QR + Homepage / Sidebar View / Default Object Type 偏好项 |
| 设置-通知 / 远程存储 / 回收站 / 导入 / 导出 | 逐屏 `Action.openSettings`，控制台零错误 | 渲染通过；导入/导出的**执行**仍属 #153，存储用量依赖 `FileNodeUsage`（桌面能力，NOT_SUPPORTED） |
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

验收清单已全部走完实盘（含 collection 网格行）。仍然**延期**而非「待验收」的是：#100（ADR-0018 正文持久化水位与客户端 ack）、#152（FileDrop 落正文）、#153（导入导出需先有客户端下载路径）、#154（`?width=` 缩略图）。

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
| 块拖拽排序 | `@tiptap/extension-drag-handle`（免费） | 需新增 |
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
- **#152** P5-e FileDrop 正文插入：依赖 P3 正文模型。
- **#154** P5-g 图片缩略图缩放（`?width=`）：带宽优化；浏览器可对原始字节做 CSS 缩放，延后。

## Web 等价范围外（有意不实现）

- **#153** P5-f `ObjectListExport` / `ObjectImport`：导出/导入需要客户端下载路径，属自托管 Web 范围外。

## 明确不实现（客户端无调用路径，不视为未完成）

以下命令在 front_web 中没有任何调用路径，属范围外，明确不实现：

- `ObjectTypeRelationAdd` / `ObjectTypeRelationRemove`
- `WorkspaceObjectAdd` / `WorkspaceObjectListRemove`
- `ObjectCollectionSort`、`SpaceJoinCancel`、`ObjectDuplicate`
- `ObjectChatAdd`、`ObjectShareByLink`、`PublishingResolveUri`
- 78 个 `Block*` 与 `History/Undo/Redo` 命令：由 Yjs 正文模型取代（ADR-0018）。
- 云盘 / native / debug / 文件节点 / 导入导出 / wallet / AI / 画廊 / 会员计费等命令族：范围外。