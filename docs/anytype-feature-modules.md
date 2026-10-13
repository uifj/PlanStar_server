# Anytype-TS 功能模块全景分析

> 基于 `anytype-ts v0.57.4` 源码深度分析，供后续功能实现参考。

---

## 一、技术架构概览

| 层次 | 技术选型 |
|------|----------|
| 桌面框架 | Electron 43 + @electron/remote |
| UI 框架 | React 18 + TypeScript 5 |
| 状态管理 | MobX 6 (observable/action/computed) |
| 构建工具 | Vite 6 + SWC |
| 样式系统 | SCSS (BEM 命名 + 变量/混入体系) |
| 富文本编辑器 | Lexical 0.40 |
| 后端引擎 | Go middleware (anytype-heart) via gRPC/Protobuf |
| 通信协议 | grpc-web + Protobuf (ts-proto 生成) |
| 拖拽 | @dnd-kit |
| 图表/图形 | D3 + Mermaid + Excalidraw + Pixi.js (WebGL Worker) |
| PDF | pdfjs-dist + react-pdf |
| 代码高亮 | Prism.js |
| 数学公式 | KaTeX |
| 错误监控 | Sentry |
| 动画 | Motion (Framer Motion 后继) |
| 包管理 | Bun |

---

## 二、核心对象系统 (Object System)

### 2.1 对象布局类型 (ObjectLayout)

Anytype 的一切都是"对象"，每种对象有特定布局：

| 枚举值 | 名称 | 说明 |
|--------|------|------|
| 0 | Page | 文档页面 |
| 1 | Human | 联系人/人物 |
| 2 | Task | 任务 |
| 3 | Set | 集合（查询结果的虚拟集合） |
| 4 | Type | 自定义类型定义 |
| 5 | Relation | 关系（属性）定义 |
| 6 | File | 文件对象 |
| 7 | Dashboard | 主页仪表板 |
| 8 | Image | 图片 |
| 9 | Note | 笔记 |
| 10 | Space | 空间 |
| 11 | Bookmark | 书签 |
| 12 | OptionList | 选项列表 |
| 13 | Option | 选项 |
| 14 | Collection | 收藏集合 |
| 15 | Audio | 音频 |
| 16 | Video | 视频 |
| 17 | Date | 日期对象 |
| 18 | SpaceView | 空间视图 |
| 19 | Participant | 空间参与者 |
| 20 | Pdf | PDF 文件 |
| 21/22 | Chat | 聊天 |
| 27 | Discussion | 讨论 |
| 100-106 | 虚拟页面 | Empty/Navigation/Graph/History/Archive/Block/Settings |

### 2.2 关系系统 (Relation)

**关系类型 (RelationType)**：
- LongText / ShortText / Number / Select / MultiSelect
- Date / File / Checkbox / Url / Email / Phone
- Icon / Object / Relations

**关系作用域 (RelationScope)**：
- Object / Type / SetOfTheSameType / ObjectsOfTheSameType / Library

### 2.3 对象来源 (ObjectOrigin)

- None / Clipboard / DragAndDrop / Import / Webclipper / SharingExtension / Usecase / Builtin / Bookmark / Api

---

## 三、块编辑器系统 (Block Editor)

### 3.1 支持的块类型

| 块类型 | 组件路径 | 功能描述 |
|--------|----------|----------|
| Text | `block/text.tsx` | 富文本编辑（支持标题、段落、代码块、引用、列表、复选框、切换等样式） |
| File | `block/media/file.tsx` | 文件上传/预览/下载 |
| Image | `block/media/image.tsx` | 图片展示/编辑 |
| Video | `block/media/video.tsx` | 视频播放 |
| Audio | `block/media/audio.tsx` | 音频播放 |
| Pdf | `block/media/pdf.tsx` | PDF 内嵌预览 (react-pdf) |
| Link | `block/link.tsx` | 对象间链接（引用/提及） |
| Bookmark | `block/bookmark.tsx` | 网页书签（自动抓取预览） |
| Dataview | `block/dataview.tsx` | 数据库视图块（核心） |
| Relation | `block/relation.tsx` | 关系展示块 |
| Table | `block/table.tsx` | 简单表格 |
| Layout | `block/div.tsx` | 布局容器（列、吸顶等） |
| Cover | `block/cover.tsx` | 封面图/颜色/渐变 |
| Icon | `block/iconPage.tsx`, `iconUser.tsx` | 页面图标/用户图标 |
| Featured | `block/featured.tsx` | 精选关系展示区 |
| Chat | `block/chat.tsx` | 聊天块（消息列表/输入） |
| TableOfContents | `block/tableOfContents.tsx` | 目录索引 |
| Help | `block/help/` | 帮助/引导块 |
| Embed | `block/embed.tsx` | 嵌入式内容（iframe） |
| Gallery | `block/gallery.tsx` | 画廊展示 |

### 3.2 块操作菜单系统

| 菜单 | 路径 | 功能 |
|------|------|------|
| BlockAction | `menu/block/action.tsx` | 块操作（删除/复制/移动/转为类型） |
| BlockAdd | `menu/block/add.tsx` | 添加新块 |
| BlockStyle | `menu/block/style.tsx` | 样式切换（H1-H6/段落/代码/引用/列表/复选框/切换/Toggle） |
| BlockColor | `menu/block/color.tsx` | 文字颜色 |
| BlockBackground | `menu/block/background.tsx` | 背景颜色 |
| BlockAlign | `menu/block/align.tsx` | 对齐方式 |
| BlockLink | `menu/block/link.tsx` | 链接设置 |
| BlockLayout | `menu/block/layout.tsx` | 布局设置 |
| BlockContext | `menu/block/context.tsx` | 右键上下文菜单 |
| BlockMention | `menu/block/mention.tsx` | @提及 |
| BlockRelation | `menu/block/relation/` | 块关联关系 |
| BlockEmoji | `menu/block/emoji.tsx` | Emoji 选择 |
| BlockLatex | `menu/block/latex.tsx` | LaTeX 公式编辑 (KaTeX) |
| BlockEmbedKroki | `menu/block/embedKroki.tsx` | Kroki 图表嵌入 |

### 3.3 块结构模型

- **Block**: 单个块数据（id / type / children / fields / text / hyperlink）
- **BlockStructure**: 父子关系（parent + children 列表）
- **BlockStore**: 按 rootId → blockId 的 Map 存储，含 restrictionMap（权限）、participantMap（协作者）

---

## 四、数据库视图系统 (Dataview)

### 4.1 视图类型 (ViewType)

| 类型 | 枚举 | 组件路径 | 说明 |
|------|------|----------|------|
| Grid | 0 | `dataview/view/grid.tsx` | 表格视图 |
| List | 1 | `dataview/view/list.tsx` | 列表视图 |
| Gallery | 2 | `dataview/view/gallery.tsx` | 画廊视图（卡片） |
| Board | 3 | `dataview/view/board.tsx` | 看板视图（Kanban） |
| Calendar | 4 | `dataview/view/calendar.tsx` | 日历视图 |
| Graph | 5 | `dataview/view/graph.tsx` | 图谱视图 |
| Timeline | 6 | `dataview/view/timeline.tsx` | 时间线视图 |

### 4.2 视图控件

- **Controls** (`dataview/controls.tsx`): 视图切换、新建、搜索、过滤
- **Filters** (`dataview/filters.tsx`): 高级过滤条件（多条件 AND/OR + 丰富条件运算符）
- **Sort** (`menu/dataview/sort.tsx`): 排序规则
- **Group** (`menu/dataview/group/`): 分组方式
- **ViewEdit** (`menu/dataview/view/`): 视图配置编辑
- **Relation编辑** (`menu/dataview/relation/`): 字段管理

### 4.3 过滤条件 (FilterCondition)

支持：Equal / NotEqual / Greater / Less / GreaterOrEqual / LessOrEqual / Like / NotLike / In / NotIn / Empty / NotEmpty / AllIn / AllNotIn / NotMatchAny / MatchAll / InOptions / NotInOptions

### 4.4 日期格式 / 时间格式

- DateFormat: 9 种显示格式（ISO / US / European / Long / Nordic 等）
- TimeFormat: 12 / 24 小时制

---

## 五、空间系统 (Space)

### 5.1 空间类型

| 类型 | 说明 |
|------|------|
| Data | 普通数据空间 |
| Tech | 技术空间 |
| Chat | 聊天空间 |
| OneToOne | 一对一私聊空间 |

### 5.2 空间访问级别

- Private (完全私有)
- Personal (个人空间)
- Shared (共享空间)

### 5.3 空间状态管理

Unknown → Loading → Ok / Missing / Error / RemoteWaitingDeletion / RemoteDeleted / Deleted / Active / Joining / Removing

### 5.4 参与者系统

**权限等级**: Reader / Writer / Owner / Admin / None  
**状态**: Joining / Active / Removed / Declined / Removing / Canceled

### 5.5 邀请系统

- **邀请类型**: WithApprove / Guest / WithoutApprove
- **邀请链接类型**: None / Editor / Viewer / Manual
- **组件**: `popup/invite/` — add / manage / request / confirm / qr
- **功能**: 生成邀请链接 / 二维码 / 管理加入请求 / 变更所有者

---

## 六、聊天与评论系统 (Chat & Comment)

### 6.1 聊天功能

| 功能 | 文件 | 说明 |
|------|------|------|
| 消息列表 | `block/chat.tsx` + `store/chat.ts` | 支持最多 500 条消息 + 窗口化管理 |
| 消息发送 | `block/chat/form.tsx` | 支持文本 + 附件 + @提及 |
| 消息附件 | `block/chat/attachment/` | 文件/图片等附件 |
| 消息回复 | `block/chat/message/reply.tsx` | 回复特定消息 |
| 消息反应 | `block/chat/message/reaction.tsx` | Emoji 表情反应 |
| 日期分隔 | `block/chat/message/date.tsx` | 时间戳分组 |
| 聊天状态 | `store/chatStatus.ts` + `lib/chatStatus/` | AI 聊天状态/时间线 |
| 讨论串 | `comment/` + discussion 概念 | 讨论线程（父消息 + 子回复） |
| 未读计数 | Badge 系统 | 桌面端 Dock Badge 更新 |

### 6.2 评论系统

| 功能 | 文件 | 说明 |
|------|------|------|
| 评论列表 | `comment/list.tsx` | 对象内评论 |
| 评论表单 | `comment/form.tsx` | 编辑器（Lexical） |
| 评论回复 | `comment/reply.tsx` | 嵌套回复 |
| 评论渲染 | `comment/render.tsx` | 富文本渲染 |
| 活动区 | `comment/activity.tsx` | 评论活动/状态 |
| 嵌入预览 | `comment/embedPreview.tsx` | 附件预览 |
| 工具栏菜单 | `menu/comment/toolbar.tsx` | 格式化工具栏 |

### 6.3 在线状态 (Presence)

- 打字指示器 (typing indicator)
- 实时光标位置
- 按 identity + sessionId 区分多设备
- TTL 自动过期清理

---

## 七、知识图谱 (Graph)

### 7.1 图谱可视化

| 组件 | 路径 | 功能 |
|------|------|------|
| Graph Provider | `graph/provider.tsx` | D3 力导向图渲染引擎 |
| Graph Timeline | `graph/timeline.tsx` | 时间线视图（Pixi.js WebGL worker） |
| Graph Settings | `menu/graph/settings.tsx` | 图谱配置（力参数/节点样式） |
| Graph Page | `page/main/graph.tsx` | 全页图谱展示 |

### 7.2 技术实现

- D3-force + d3-force-cluster 布局
- Pixi.js Web Worker 加速渲染 (`workers/pixi-worker-entry.ts`)
- 节点 = 对象，边 = 关系链接

---

## 八、侧边栏与导航 (Sidebar & Navigation)

### 8.1 左侧栏

| 区域 | 路径 | 内容 |
|------|------|------|
| Widget 管理 | `sidebar/left.tsx` | 可拖拽 Widget 列表 |
| Space 切换 | `widget/space.tsx` | 多空间切换 |
| Home Widget | `widget/home.tsx` | 主固定入口 |
| Object Widget | `widget/object.tsx` | 对象快捷方式 |
| Tree Widget | `widget/tree/` | 树形结构展示 |
| Vault | `sidebar/page/vault.tsx` | 保险库（私密空间） |

### 8.2 Widget 视图类型

`widget/view/` 下支持：Board / Calendar / Gallery / Graph / List / Grid

### 8.3 右侧栏（对象属性面板）

| 区域 | 功能 |
|------|------|
| 对象信息 | 名称/图标/封面 |
| 关系列表 | 对象的所有属性/关系值 |
| 反向链接 | 被引用列表 |
| 历史版本 | 版本历史入口 |

### 8.4 导航

- 面包屑导航 (`page/main/navigation.tsx`)
- 快速搜索 (`page/main/quickSearch.tsx`)
- 路由系统：React Router v5 + Memory History
- 路由模式：`/:page/:action/:id?`

---

## 九、认证与账户系统 (Auth & Account)

### 9.1 账户操作

- 账户列表管理（多账户切换）
- 登录 / 登出 / 账户恢复
- PIN 码验证 (`popup/pin.tsx`)
- 助记词 (Recovery Phrase) 管理 (`popup/phrase.tsx`)
- 本地密钥存储 (keytar - OS Keychain)

### 9.2 网络配置

- NetworkMode: Default / Custom / NotConnected / Testnet / Staging / Local
- Yamux 协议优先选项
- 自定义路径

### 9.3 本地 JSON API

- 可启用本地 HTTP API（端口可配置，默认 31009）
- API Key 管理 (`form/apiKeyEditor.tsx`, `popup/api/`)
- Link Approval 流程（外部应用连接授权）

### 9.4 认证页面

| 页面 | 功能 |
|------|------|
| `auth/login.tsx` | 登录选择账户 |
| `auth/onboard.tsx` | 新户引导 |
| `auth/setup.tsx` | 初始设置 |
| `auth/pinCheck.tsx` | PIN 验证 |
| `auth/migrate.tsx` | 数据迁移 |
| `auth/deleted.tsx` | 已删除账户 |
| `auth/select.tsx` | 账户选择 |
| `auth/explainerScene.tsx` | 解释场景动画 |

---

## 十、会员与支付系统 (Membership)

### 10.1 会员状态

None → Pending → Active → Finalization

### 10.2 付费周期

Unlimited / Monthly / Yearly / ThreeYears / Lifetime

### 10.3 支付提供商

Stripe / Crypto / BillingPortal / AppStore / GooglePlay

### 10.4 功能组件

| 组件 | 功能 |
|------|------|
| `popup/membership/activation.tsx` | 激活流程 |
| `popup/membership/finalization.tsx` | 确认流程 |
| `settings/membership/` | 会员管理页 |
| `model/membershipData.ts` | 会员数据模型 |
| `model/membershipProduct.ts` | 产品模型 |
| Upsell 弹窗 | 空间/成员/存储限额升级 |

### 10.5 资源限额

- 存储空间限额
- 成员数限额
- 协作者空间限额
- 每个资源独立 FetchState（Loading / Fresh / Stale / Error）

---

## 十一、导入/导出系统 (Import/Export)

### 11.1 导入源

| 格式 | 路径 | 说明 |
|------|------|------|
| Notion | `settings/import/notion.tsx` | Notion 全量导入（含子页面、数据库） |
| Obsidian | `settings/import/obsidian.tsx` | Obsidian Vault 导入 |
| CSV | `settings/import/csv.tsx` | CSV 数据导入 |
| AI 辅助 | `settings/import/aiSettings.tsx` | AI 导入配置（自定义端点/模型/Token） |

### 11.2 导出格式

| 格式 | 路径 | 说明 |
|------|------|------|
| AnyBlock V2 | `settings/export/anyBlockV2.tsx` | Anytype 原生格式 |
| Markdown | `settings/export/markdown.tsx` | 标准 MD 文件 |
| Protobuf | `settings/export/protobuf.tsx` | 原始 PB 格式（调试用） |
| 导出结果 | `popup/exportResult.tsx` | 导出进度/结果展示 |

### 11.3 导出选项

- 单选/多选对象导出
- 带文件/不带文件
- 归档报告 (`util/exportReportObjects.ts`)

---

## 十二、搜索系统 (Search)

### 12.1 搜索范围

- 全局跨空间搜索 (`menu/search/object.tsx`)
- 空间内跨聊天搜索
- 文本搜索 (`menu/search/text.tsx`)
- 聊天搜索 (`menu/search/chat.tsx`)

### 12.2 搜索特性

- 搜索匹配高亮 (`lib/searchMatch.ts`)
- 按类型过滤（Type Creator）
- Token 过滤器 (`docs/specs/` 中的 search-filter-tokens)
- 分组结果展示
- 快捷搜索页面 (`page/main/quickSearch.tsx`)

---

## 十三、发布系统 (Publish)

### 13.1 功能

- 对象发布为公开网页
- 发布管理 (`menu/publish.tsx`)
- 发布设置 (`data/publish.tsx`)
- 空间级发布配置

---

## 十四、历史版本系统 (History)

### 14.1 功能

- 对象版本历史查看 (`page/main/history.tsx`)
- 版本比较/预览
- 历史恢复 (`lib/history.ts`)
- 删除审计 (`settings/space/deletionAudit.tsx`)

---

## 十五、Onboarding 与引导系统

### 15.1 组件

| 组件 | 功能 |
|------|------|
| `popup/onboarding.tsx` | 新用户引导流程 |
| `popup/aiOnboarding.tsx` | AI 功能引导 |
| `popup/usecase.tsx` | 用例模板选择 |
| `popup/introduceChats.tsx` | 聊天功能介绍 |
| `menu/onboarding.tsx` | 引导菜单 |
| `store/sparkOnboarding.ts` | Spark Onboarding 状态 |
| `service/sparkOnboarding.ts` | Spark 引导 WebSocket 服务 |

### 15.2 Usecase 模板

- 个人笔记 / 任务管理 / 知识库 / CRM / 项目管理等场景模板

---

## 十六、设置系统 (Settings)

### 16.1 设置页面结构

| 设置项 | 路径 | 功能 |
|--------|------|------|
| Account | `settings/account.tsx` | 账户信息/身份/Space ID |
| Personal | `settings/personal.tsx` | 个人偏好 |
| Space | `settings/space/` | 空间管理（列表/共享/通知/存储/删除审计） |
| Data | `settings/data/` | 数据设置（发布管理） |
| Language | `settings/language.tsx` | 多语言选择 |
| Import | `settings/import/` | 导入功能 |
| Export | `settings/export/` | 导出功能 |
| PIN | `settings/pin/` | PIN 码管理 |
| API | `settings/api.tsx` | 本地 API 配置 |
| Membership | `settings/membership/` | 会员管理 |
| Delete | `settings/delete.tsx` | 账户删除 |
| Wallpaper | `settings/index.tsx` | 主题/壁纸 |

### 16.2 弹出式设置

- `popup/settings/onboarding.tsx` — 引导重播

---

## 十七、通知系统 (Notification)

### 17.1 类型

- 系统通知（空间加入/权限变更/会员状态）
- 聊天消息通知（Push notification via Electron）
- 评论通知
- 应用更新通知
- Toast 提示

### 17.2 组件

| 组件 | 路径 | 功能 |
|------|------|------|
| Notification List | `component/notification/index.tsx` | 通知面板 |
| Toast | `util/toast.tsx` | 临时消息 |
| Update Banner | `util/updateBanner.tsx` | 更新提示条 |

---

## 十八、Electron 桌面端功能

### 18.1 主进程模块

| 模块 | 文件 | 功能 |
|------|------|------|
| App 入口 | `electron/ts/main.ts` | 应用生命周期、协议注册、CSP、GPU 设置 |
| 窗口管理 | `electron/ts/window.ts` | 多窗口创建/状态恢复 |
| 菜单 | `electron/ts/menu.ts` | 原生菜单栏（文件/编辑/视图/窗口/帮助） |
| 自动更新 | `electron/ts/update.ts` | electron-updater 集成 |
| 下载管理 | `electron/ts/download.ts` | electron-dl 文件下载 |
| 服务器 | `electron/ts/server.ts` | Go middleware 子进程管理 |
| API | `electron/ts/api.ts` | IPC API 聚合 |
| 配置 | `electron/ts/config.ts` | 持久化配置存储 |
| 安全存储 | `electron/ts/safeStorage.ts` | OS Keychain (keytar) |
| 电源状态 | `electron/ts/lib/powerState.ts` | 系统休眠/唤醒监听 |
| 聊天状态 | `electron/ts/chatStatus.ts` | 系统托盘聊天状态 Badge |
| Link Approval | `electron/ts/linkApproval.ts` | 外部链接审批弹窗 |
| 校验 | `electron/ts/checksum.ts` | 下载文件校验 |
| 下载账本 | `electron/ts/downloadLedger.ts` | 下载记录 |
| Native Messaging | `electron/ts/lib/installNativeMessagingHost.ts` | 浏览器扩展通信 |

### 18.2 特殊功能

- **深度链接协议**: `anytype://` URL scheme
- **多窗口支持**: Tab 式多窗口（electron-window-state）
- **系统托盘**: 聊天未读消息数 Badge
- **Wayland 支持**: XWayland / native Wayland 两种 .desktop
- **硬件加速**: 可开关 GPU 加速
- **DevTools**: gRPC DevTools 扩展集成

---

## 十九、Web Clipper 浏览器扩展 (Extension)

### 19.1 架构

- **通信方式**: Native Messaging Host (Go 编译) + Electron IPC
- **入口**: `extension/entry.tsx`
- **构建**: Vite (`vite.extension.config.ts`)
- **支持浏览器**: Chrome / Firefox（manifest 切换）

### 19.2 页面组件

| 组件 | 文件 | 功能 |
|------|------|------|
| Popup | `extension/popup/` | 扩展弹出窗口（剪藏配置） |
| Iframe | `extension/iframe/` | 页面内嵌入框架 |
| Auth | `extension/auth/` | 认证页面 |
| Success | `extension/popup/success.tsx` | 成功反馈 |
| Create | `extension/popup/create.tsx` | 创建对象 |

### 19.3 功能

- 网页内容一键保存到 Anytype（自动提取 HTML）
- 支持选择目标 Space
- 支持自定义标题/内容
- 认证流程（与桌面端通信）

---

## 二十、Web 模式 (Browser-only)

### 20.1 启动方式

```bash
bun run start:web     # 纯浏览器开发模式
bun run build:web     # Web 生产构建
```

### 20.2 差异处理

- `lib/web/electronMock.ts`: Mock Electron API
- `lib/web/routeSync.ts`: URL 路由同步（代替 Memory History）
- `vite.web.config.ts`: Web 专用 Vite 配置
- `entry.web.tsx`: Web 入口文件

---

## 二十一、AI 功能集成

### 21.1 AI 能力

| 功能 | 位置 | 说明 |
|------|------|------|
| AI 模型列表 | `command.ts → AIListModels` | 验证配置并列出可用模型 |
| AI 导入 | `settings/import/aiSettings.tsx` | AI 辅助内容导入 |
| AI Onboarding | `popup/aiOnboarding.tsx` | AI 功能新手引导 |
| AI 聊天状态 | `lib/chatStatus/` | AI Agent 对话状态/时间线 |
| AI 提供商 | `lib/util/aiProvider.ts` | 多 AI 提供商管理 |

### 21.2 配置项

- `IMPORT_AI_ANYTYPE_ENDPOINT` — 端点
- `IMPORT_AI_ANYTYPE_MODEL` — 模型名
- `IMPORT_AI_ANYTYPE_TOKEN` — 认证 Token

---

## 二十二、嵌入式内容 (Embed)

### 22.1 支持的嵌入类型

| 类型 | 渲染方式 |
|------|----------|
| 网页 iframe | `block/embed.tsx` |
| Mermaid 图表 | `util/media/mermaid.tsx` (动态加载) |
| Excalidraw 画板 | `util/media/excalidraw.tsx` (动态加载) |
| Kroki 图表 | `menu/block/embedKroki.tsx` |
| PDF | `util/media/pdf.tsx` (react-pdf) |
| YouTube 等视频 | `block/media/video.tsx` |
| 音频 | `block/media/audio.tsx` |

### 22.2 懒加载策略

- Excalidraw / Mermaid / PDF / KaTeX / pako 均通过 `import()` 动态加载
- Vite `manualChunks` 确保这些库独立打包，不影响启动性能

---

## 二十三、拖拽系统 (Drag & Drop)

### 23.1 支持的拖拽类型 (DropType)

- Block / Menu / Relation / Record / Widget / View

### 23.2 实现

- **DragProvider** (`component/drag/provider.tsx`): 全局拖拽上下文
- **DragBox** (`component/drag/box.tsx`): 可拖拽容器
- **DragLayer** (`component/drag/layer.tsx`): 拖拽预览层
- **DragTarget** (`component/drag/target.tsx`): 放置目标区域
- 基于 @dnd-kit 实现

---

## 二十四、选择系统 (Selection)

### 24.1 功能

- 块多选（Shift 连续选择 / Cmd 离散选择）
- 跨块批量操作（删除/复制/移动/转类型）
- 虚拟滚动窗口化管理

### 24.2 组件

- **SelectionProvider** (`selection/provider.tsx`): 选择状态上下文
- **SelectionTarget** (`selection/target.tsx`): 可选中元素
- **BlockSelection** (`lib/util/blockSelection.ts`): 选择逻辑工具

---

## 二十五、媒体系统 (Media)

### 25.1 文件处理

- 上传进度条 (`mediaState.tsx`)
- 文件类型自动识别 (file-type)
- 图片加载优化 (blueimp-load-image)
- 音频/视频播放器自定义 UI
- PDF 分页渲染 + 文本层 + 注释层

### 25.2 封面系统 (Cover)

- CoverType: None / Upload / Color / Gradient / Image / Source
- 图标类型: Emoji / Image / Icon

---

## 二十六、国际化 (i18n)

### 26.1 实现

- `lib/translate.ts`: 翻译核心引擎
- `src/json/lang.ts`: 语言包映射
- Crowdin 平台管理翻译
- `bun run update:locale`: 拉取最新翻译

### 26.2 支持语言

通过 `electron/hook/locale.js` 动态拉取，支持 20+ 语言。

---

## 二十七、主题与样式系统

### 27.1 主题架构

- **亮色 / 暗色** 双主题 (`scss/theme/dark/`)
- **CSS 变量** 控制主题切换
- `src/json/theme.ts`: 主题配置枚举

### 27.2 SCSS 组织结构

```
scss/
├── _vars.scss          — 全局变量（颜色、间距、字号）
├── _mixins.scss        — 混入（响应式断点、文本截断等）
├── color.scss          — 颜色定义
├── common.scss         — 入口
├── block/              — 块编辑器样式（每种块一个文件）
├── component/          — UI 组件样式
├── form/               — 表单样式
├── list/               — 列表样式
├── media/              — 媒体样式
├── menu/               — 菜单样式（含 dataview/search/sidebar 子目录）
├── notification/       — 通知样式
├── page/               — 页面样式
├── popup/              — 弹窗样式
├── widget/             — Widget 样式
└── theme/dark/         — 暗色主题覆盖
```

### 27.3 设计系统

- BEM 命名约定
- 组件 Stories（Storybook 8）用于开发时预览
- Icon 组件化系统 (`generate-icon-components.ts` 脚本生成)

---

## 二十八、Analytics 与分析

### 28.1 集成

- Amplitude 事件追踪 (`lib/analytics.ts`)
- Sentry 错误报告 + Breadcrumbs
- 会员系统事件 (`analytics.membership.test.ts`)

### 28.2 埋点事件类型

- 页面浏览 / 对象操作 / 块编辑 / 导入导出 / 空间管理 / 会员购买 / 搜索 / 分享

---

## 二十九、数据持久化与同步

### 29.1 存储层

| 层 | 技术 | 用途 |
|----|------|------|
| 本地 | SQLite (via Go middleware) | 对象数据主存储 |
| 键值 | electron-json-storage | 应用配置 |
| 密钥 | keytar (OS Keychain) | Token/私钥 |
| Session | localStorage | 临时状态 |
| 同步 | any-sync (P2P) | 端到端加密同步 |

### 29.2 同步状态

`store/auth.ts` 中 `syncStatusMap`: 每个空间独立的同步状态追踪。

### 29.3 恢复机制

- Recovery Store: 数据恢复流程
- Peer Recovery: 对等节点恢复 (`menu/recoveryPeers.tsx`)
- 进度展示: `recoveryProgress.tsx` / `recoveryStatus.tsx`

---

## 三十、弹出窗口与模态系统 (Popup)

### 30.1 完整弹窗列表

| 弹窗 | 功能 |
|------|------|
| `about.tsx` | 关于页面 |
| `confirm.tsx` | 确认对话框 |
| `export.tsx` | 导出选择 |
| `exportResult.tsx` | 导出结果 |
| `help.tsx` | 帮助中心 |
| `invite/*` | 邀请管理 |
| `logout.tsx` | 登出确认 |
| `membership/*` | 会员激活/确认 |
| `objectManager.tsx` | 对象管理（批量操作） |
| `onboarding.tsx` | 新手引导 |
| `phrase.tsx` | 助记词展示 |
| `pin.tsx` | PIN 码输入 |
| `preview.tsx` | 预览弹窗 |
| `relation.tsx` | 关系编辑 |
| `search.tsx` | 全局搜索弹窗 |
| `settings/*` | 设置页面 |
| `share.tsx` | 分享弹窗 |
| `shortcut.tsx` | 快捷键列表 |
| `space/*` | 空间创建/管理 |
| `submitReport.tsx` | 提交报告 |
| `upload.tsx` | 上传弹窗 |
| `usecase.tsx` | 用例选择 |
| `cleanup.tsx` | 数据清理 |
| `api/*` | API Key 管理 |

### 30.2 弹窗状态管理

`store/popup.ts`: 弹窗栈式管理（支持多层嵌套弹窗），含打开/关闭/队列逻辑。

---

## 三十一、快捷操作与键盘系统

### 31.1 快捷键

- `lib/keyboard.ts`: 全局键盘事件注册
- `src/json/shortcut.ts`: 快捷键映射表
- 支持 Cmd/Ctrl 组合键、单键快捷方式
- 编辑器内快捷键（Markdown 风格快捷输入）

### 31.2 右键菜单

- `src/json/menu.ts`: 菜单场景配置（按上下文显示不同菜单项）
- 每种场景(cell/context/add/action/object...)有独立菜单栈

### 31.3 Slash Command / Mention

- `@` 提及对象
- `/` 快捷块类型输入
- Markdown 语法自动转换

---

## 三十二、对象管理与收藏

### 32.1 归档 (Archive)

- `page/main/archive.tsx`: 已删除对象列表
- `archiveListTree.tsx`: 树形归档视图
- `archiveSuggested.tsx`: 推荐归档

### 32.2 收藏 (Featured)

- `block/featured.tsx`: 对象属性精选区（Type/Relations/Created by 等）
- FeaturedRelationLayout: Inline / Column

### 32.3 模板 (Template)

- `menu/dataview/template/`: 对象创建模板
- 空间级模板管理

---

## 三十三、链接审批与安全 (Link Approval)

### 33.1 功能

外部应用/设备尝试连接 Anytype 本地 API 时的审批流程：
- `electron/ts/linkApproval.ts`: 独立 always-on-top 窗口
- `src/html/linkApproval.html`: 审批页面 HTML
- `lib/linkApproval.ts`: 审批逻辑
- `lib/linkApprovalGrant.ts`: 授权验证
- `lib/util/aiProvider.ts`: AI 提供商配置安全

### 33.2 安全特性

- Keytar 加密存储 Token
- 本地 API 仅监听 127.0.0.1
- 审批窗口独立进程隔离

---

## 三十四、性能优化

### 34.1 渲染优化

- **MobX reaction 调度器** (`lib/reactionScheduler.ts`): 批量 reaction 避免中间态渲染
- **虚拟滚动** (`react-virtualized`): 大列表性能
- **聊天消息窗口化** (`lib/util/chatWindow.ts`): 只渲染可视范围
- **计算属性缓存** (DetailStore): per-key IComputed 自动回收

### 34.2 构建优化

- **Vite manualChunks**: vendor-react / vendor-d3 / vendor-mermaid / vendor-sentry / vendor-excalidraw / protobuf 独立分包
- **懒加载**: Mermaid / KaTeX / Excalidraw / PDF / Prism 全部动态 import
- **Web Worker**: Pixi.js WebGL 渲染在独立 Worker 线程
- **资源内联**: <10KB 资源自动内联

### 34.3 运行时优化

- 块延迟更新 (`deferredParentUpdates` / `deferredNumberUpdates` / `deferredMarkupUpdates`)
- 订阅引用计数 (`subRefs`) 避免无效订阅
- 消息 ID 索引 O(1) 查找 (`messageByIdMap`)
- Session 创建 ID 跟踪 (`sessionCreatedIds`) 防止并发冲突

---

## 三十五、开发者工具与调试

### 35.1 内置工具

- `window.Anytype` 全局调试对象（dev 模式暴露 Lib/Store/Model 等）
- gRPC DevTools 扩展
- MobX Logger (可选启用)
- `scripts/analyze-deps.js`: 依赖分析
- `scripts/start-dev.js`: 一键启动开发环境

### 35.2 Storybook

- 组件级 Storybook (`.stories.tsx` 文件，覆盖几乎所有组件)
- 独立 Storybook 端口 6006

### 35.3 测试

- **Vitest**: 单元测试 + 集成测试
- **测试文件**: 与源码同级 `*.test.ts` + `tests/` 目录
- **测试覆盖**: Store / Model / Util / Component

---

## 三十六、Form & Cell 组件系统

### 36.1 表单组件

| 组件 | 功能 |
|------|------|
| Input | 文本输入框 |
| InputWithLabel | 带标签输入框 |
| InputWithFile | 文件输入 |
| Textarea | 多行文本 |
| Checkbox | 复选框 |
| Switch | 开关 |
| Select | 下拉选择 |
| TabSwitch | Tab 切换 |
| Button | 按钮 |
| Editable | 可编辑区域 |
| Filter | 过滤输入 |
| CommentEditor | 评论编辑器 (Lexical) |
| ApiKeyEditor | API Key 管理 |
| Pin | PIN 码输入 |
| Phrase | 助记词展示 |
| Drag | 拖拽排序 |

### 36.2 Cell 组件（数据库视图用）

| 组件 | 功能 |
|------|------|
| CellText | 文本单元格 |
| CellCheckbox | 布尔单元格 |
| CellSelect | 单选/多选 |
| CellObject | 对象引用 |
| CellFile | 文件展示 |

---

## 三十七、资源与图标系统

### 37.1 图标

- **自研 Icon 组件** (`util/icon.tsx` + `util/icons/`): 30+ 分类 SVG 图标组件
- **生成脚本** (`scripts/generate-icon-components.ts`): 从 SVG 自动生成 React 组件
- **Emoji 系统** (`util/iconEmoji.tsx` + `menu/smile/`): Emoji 选择器 + 肤色

### 37.2 静态资源

- 字体文件 (`dist/font/`)
- 图片 (`src/img/` + `dist/img/`)
- 主题图片 (`src/img/theme/dark/`)
- Logo (`src/img/logo/`)
- Onboarding 插图 (`src/img/onboarding/`)

---

## 三十八、路由与页面结构

### 38.1 主路由

```
/:page/:action/:id?
```

### 38.2 页面映射

| Page | Action | 对应组件 |
|------|--------|----------|
| index/void | — | `page/main/void.tsx` (空状态) |
| object | view/edit | `page/main/object.tsx` |
| set | — | `page/main/set.tsx` (集合浏览) |
| date | — | `page/main/date.tsx` (日期对象) |
| navigation | — | `page/main/navigation.tsx` |
| chat | — | `page/main/chat.tsx` |
| oneToOne | — | `page/main/oneToOne.tsx` |
| graph | — | `page/main/graph.tsx` |
| history | — | `page/main/history.tsx` |
| archive | — | `page/main/archive.tsx` |
| settings | 子路由 | `page/main/settings/` |
| import | — | `page/main/import.tsx` |
| media | — | `page/main/media.tsx` |
| membership | — | `page/main/membership.tsx` |
| invite | — | `page/main/invite.tsx` |
| edit | — | `page/main/edit.tsx` (空白页编辑) |
| blank | — | `page/main/blank.tsx` |
| quickSearch | — | `page/main/quickSearch.tsx` |

---

## 三十九、CSP 与安全

### 39.1 Content Security Policy

- 动态生成 CSP 头（`electron/json/cors.json`）
- 限制外部资源加载

### 39.2 安全特性

- End-to-End Encryption (any-sync 协议)
- 零知识架构（服务端无法解密）
- 本地 Token 加密存储 (keytar)
- 本地 API loopback-only
- 链接审批机制

---

## 四十、Misc 辅助功能

### 40.1 Survey 系统

- `lib/survey.ts`: 用户调研弹窗（NPS/反馈收集）

### 40.2 Sound 系统

- `lib/sound.ts`: 系统音效（消息提示音等）
- Web Audio API 播放
- 支持用户自定义音效文件

### 40.3 Storage 抽象

- `lib/storage.ts`: localStorage 封装（带命名空间 + JSON 序列化）

### 40.4 Export 辅助

- 下载管理 (`lib/download.ts`): Gateway 文件下载进度
- 导出报告 (`lib/util/exportReport.ts`)

### 40.5 Focus 管理

- `lib/focus.ts`: 编辑器焦点状态管理
- 点击空白聚焦 / Tab 切换 / 光标保持

### 40.6 Highlight 系统

- `lib/highlight.ts`: CSS Custom Highlight API 封装（搜索高亮）

### 40.7 Scroll 辅助

- `lib/scrollOnMove.ts`: 拖拽时自动滚动
- `hook/useScrollRestore.ts`: 滚动位置恢复

---

## 附录 A：Store 清单

| Store | 核心职责 |
|-------|----------|
| Common | 全局 UI 状态（平台/尺寸/侧边栏/模板/编辑器模式） |
| Auth | 账户/登录/网络配置/同步状态/本地 API |
| Detail | 对象属性缓存（Map<rootId, Map<objectId, Map<key, value>>>） |
| Block | 块树结构（blockMap + treeMap + restrictionMap） |
| Menu | 当前打开的菜单栈 |
| Popup | 弹窗栈管理 |
| Notification | 通知列表 |
| Chat | 聊天消息（windowed 列表 + attachments + discussions） |
| ChatStatus | AI 聊天状态 |
| Comment | 评论数据 |
| Progress | 上传/下载/处理进度 |
| Membership | 会员状态/产品/限额 |
| Record | 数据记录缓存 |
| Recovery | 数据恢复状态 |
| Presence | 在线/打字状态 |
| Extension | 浏览器扩展状态 |
| SparkOnboarding | Spark 引导服务 |

---

## 附录 B：Model 清单

| Model | 用途 |
|-------|------|
| Account | 账户信息模型 |
| Block | 块数据模型（含转换方法） |
| BlockStructure | 块父子关系模型 |
| ChatMessage | 聊天消息模型 |
| CommentMessage | 评论消息模型 |
| Notification | 通知模型 |
| View | 数据视图配置模型 |
| ViewRelation | 视图-关系映射 |
| Filter | 过滤条件模型 |
| Sort | 排序规则模型 |
| MembershipData | 会员数据模型 |
| MembershipProduct | 会员产品模型 |

---

## 附录 C：gRPC 命令域 (API Commands)

从 `lib/api/command.ts` (2181 行) 中提取的命令域：

| 域 | 核心命令 |
|----|----------|
| App | Shutdown / GetVersion / SetDeviceState |
| Account | Select / Create / Reauthenticate / Delete / Stop |
| Space | Join / Leave / InviteGenerate / InviteView / Status |
| Object | Create / Open / Close / Show / SetDetails / ListDelete |
| Block | Create / Delete / MoveToBlock / Duplicate / Text* / Style* |
| Dataview | ViewCreate / ViewDelete / ViewSetPosition / Relation* / Filter* / Sort* |
| Relation | Create / List / Options* / OptionCreate |
| Type | Create / Set* / Recommend* |
| Chat | SendMessage / GetMessages / DeleteMessage / EditMessage |
| Comment | Add / Edit / Delete / Reply / Resolve |
| Membership | GetStatus / GetProducts / RegisterName / Finalize |
| Import | Notion / Obsidian / HTML / File |
| Export | ToFile / ToNotion |
| Publish | Create / Update / Remove |
| AI | ListModels |
| Gallery | DownloadIndex / DownloadManifest |
| Notification | List / Reply |
| Process | Cancel |
| LinkPreview | URL 预览 |

---

## 附录 D：实现优先级建议

按模块依赖关系，建议实现顺序：

1. **基础架构层**: 对象系统 + 关系模型 + Block 数据结构 + Store 模式
2. **编辑器核心**: Text Block + 块操作菜单 + 键盘快捷键
3. **视图层**: Dataview (Grid → List → Gallery → Board)
4. **空间管理**: Space CRUD + 参与者 + 权限
5. **导航**: Sidebar + Widget + 路由
6. **协作**: Chat + Comment + Presence
7. **搜索**: 全局搜索 + 过滤
8. **高级视图**: Calendar + Graph + Timeline
9. **文件/媒体**: Upload / Preview / PDF
10. **认证与账户**: 登录 / 注册 / PIN / 恢复
11. **会员系统**: 状态 + 支付 + 限额
12. **导入导出**: Notion / Markdown / CSV
13. **桌面端特性**: 自动更新 / 通知 / 托盘 / 深度链接
14. **扩展**: Web Clipper + 本地 API
15. **AI 集成**: Agent 对话 + 智能导入
16. **Onboarding + Usecase 模板**
