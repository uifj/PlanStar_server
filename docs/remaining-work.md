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

尚未验收：成员面板、设置各分页、讨论/图谱屏（#91）；正文内联 dataview 块（#257）；AI 流式与命令级撤销（#254）。

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