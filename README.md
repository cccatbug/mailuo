# 脉络 · Màiluò

> 理清事务的脉络 —— 项目驱动、带任务依赖树的桌面 TODO 应用。

米纸为底，松墨为骨，朱砂点睛。「脉络」把一个项目里的事务组织成依赖有向图（DAG）：
先做什么、后做什么、谁在阻塞谁，一目了然。

## 功能

- **三栏布局**：项目侧栏（进度条、⌘K 入口、深浅色切换）｜任务面板（列表 / 脉络图）｜详情面板
- **任务依赖树**：任务可声明前置任务，自动检测并拒绝依赖环；前置未完成时任务「受阻」，不可标记完成；删除任务自动解除下游引用，支持 toast 撤销
- **脉络图（@xyflow/react）**：dagre 自动分层布局（横向/纵向可切换）、自定义节点、
  MiniMap、缩放控制；**从节点拖出连线即建立依赖**（成环连接实时拦截），选中连线按 ⌫ 移除；
  阻塞中的依赖以朱砂虚线动画标出
- **列表视图**：按「进行中 / 可着手 / 受阻 / 已完成」分组，优先级（急·常·缓）排序，
  全文搜索（标题/备注/标签）+ 状态筛选，右键菜单（开始/完成/复制/删除）
- **详情面板**：状态与优先级 ToggleGroup、日历期限选择（中文 locale）、标签、备注、
  搜索式前置任务选择器、后续任务列表、递归展开的「上游脉络」树
- **命令面板（⌘K）**：跳转项目/任务、AI 操作、切换视图（⌘1/⌘2）、打开设置（⌘,）
- **统计视图（⌘3）**：概览数字（全部/已完成/受阻/逾期）、状态构成堆叠条、近 14 天完成趋势、
  优先级与标签分布、依赖结构指标 —— 图表色板经 CVD/对比度脚本双主题验证
- **AI（pi SDK 进程内直连）**：主进程内嵌 `@earendil-works/pi-coding-agent` SDK——
  `ModelRuntime` 只注册脉络显式启用的 Provider 与模型，`AgentSession` 提供**流式输出与
  多轮记忆**；AI 规划项目（目标 → 任务 DAG 草案）、AI 拆解任务为前置子任务、AI 依赖建议
  （勾选后批量建立）、AI 撰写/润色备注，以及「脉络助手」对话侧栏（⌘J）——助手可提出
  create_task / add_dep / set_status 等操作（确认后一键应用），也能主动输出 bar / line / area /
  donut / radar / gauge / stacked-bar / scatter **图表**（基于任务快照实时计算）；对话框支持
  选择附件、粘贴图片、拖入文件，并以环形进度显示当前会话的真实上下文占用
- **右键菜单**：任务（状态、复制、优先级、快捷期限、AI 子菜单、删除）、项目（编辑、AI、删除）、
  脉络图节点与画布均有专属菜单
- **设置（⌘,）**：外观（主题/缩放/字体）、**小枢**（权限、Provider/模型/用途路由/
  上下文配置档/提示词、网络、扩展、技能、记忆一站式配置，含状态概览）、
  浏览器（会话/历史/主页/搜索引擎）、数据（位置、导出、重置）、关于
- **内置浏览器**：共享持久化 Chromium 会话、多标签、地址栏访问历史补全（域名/标题匹配、
  键盘选择）、最近访问与一键清空，可配置主页与搜索引擎（Google / Bing / 百度 / DuckDuckGo）
- **系统级文件管理**：项目文件面板提供后退/前进/上一级导航、列头排序（升降序）、
  行内重命名（自动选中主文件名）、空格 Quick Look 快速预览、⌘I 显示简介、
  橡皮筋多选、从系统文件管理器拖入即导入、可折叠文件夹树、批量移动/复制/回收/恢复
  （一次索引读写），并支持 ⌘A/C/X/V/O/D/I/↑ 等系统风格快捷键
- **顶部标题栏**：品牌、窗口拖动区、搜索（⌘K）、AI 助手、设置、主题切换；
  macOS 原生红绿灯 / Windows 自绘窗口控制按钮
- **本地持久化**：主进程原子写入 `mailuo.json`（userData 目录）；纯浏览器环境自动降级 localStorage
- **项目数据库**：每个项目一个专属 SQLite 数据库（`node:sqlite`，零依赖），小枢可通过全量 `db_*` 工具（建表、查询、编辑、事务）直接操作；应用数据自动镜像为 `app_*` 只读表，一条 SQL 即可 JOIN 任务、定时执行历史与用户自建表；定时任务 headless 执行也能读写数据库

## 技术栈

Electron + electron-vite · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (radix) · dockview（VSCode 式可拖拽布局）·
@xyflow/react + dagre · Recharts · Zustand · sonner · cmdk · @earendil-works/pi-coding-agent（pi SDK）

```
electron/          # 主进程：窗口、持久化、pi SDK 服务、代理 fetch
  main.ts  preload.ts  pi.ts  proxy-fetch.ts
src/
  components/ui/   # shadcn 组件
  features/        # projects / tasks / graph / stats / details / command / ai / settings
  store/           # zustand 状态与种子数据
  lib/             # 依赖图算法、持久化、原生桥接、平台工具
```

## 开发

```bash
pnpm install
pnpm dev     # Electron 桌面应用（renderer 热更新）
pnpm test    # Vitest 配置、发现与运行时测试
pnpm dist    # 打包（dmg / nsis / AppImage，图标在 build/）
pnpm web     # 纯浏览器预览（localStorage 持久化，无 AI）
```

> AI 配置完全独立于 pi CLI：`~/.mailuo/ai/config.json` 保存 Provider、模型库、用途路由、
> 上下文策略和资源开关，`~/.mailuo/ai/auth.json` 以 `0600` 权限保存凭据。应用管理的 pi
> packages 位于 `~/.mailuo/ai/packages/`，skills.sh 的受控安装目录位于 `~/.mailuo/ai/skills-sh/`，
> 应用 skills 位于 `skills/`。设置页可以登记终端已安装的 `.pi`/`.agents` 资源，但默认不会读取或
> 回退到 `~/.pi`、项目 `.pi`、`~/.agents`、Provider 环境变量或登录 shell 凭据。代理只使用 AI
> 设置中的应用级网络配置。
> 旧 Tauri 版本的任务数据会在首次启动时自动迁移。
