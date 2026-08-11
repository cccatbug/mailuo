# 项目数据库（Project Database）

## Context

脉络的应用数据（任务、项目、定时任务、资产、记忆）分散在 `mailuo.json`、
`scheduled-tasks-v1.json`、资产目录与记忆文件中，小枢只能通过各自的专用工具零散地访问。
用户希望：**每个项目拥有一个独立的数据库**，小枢带着全量工具（查询 / 编辑 / 执行 /
建表……）直接操作它，并且能透过它看到应用下的各种数据。

## Approach

**引擎**：Node 内置 `node:sqlite`（`DatabaseSync`），零依赖、无 native 编译与打包负担
（Electron 43 内置 Node 24 直接可用，vitest 在系统 Node 22 上也可跑测试）。

**布局**：每个项目一个 SQLite 文件 `~/.mailuo/workspace/<projectId>/mailuo.db`，
复用既有 `workspaceDir()`。主进程 `PROJECT_DB` 单例管理连接缓存（WAL、busy_timeout、
外键约束）、操作串行化与关闭。

**应用数据镜像（`app_*` 系统表，只读）**：数据库首次被访问、以及每次距上次同步超过
15 秒时，自动从应用数据重建镜像表——`app_projects` / `app_tasks` /
`app_scheduled_jobs` / `app_scheduled_runs` / `app_assets` / `app_memories`。
镜像表由系统独占：`app_` 与 `_mailuo` 前缀禁止用户建表，结构化写接口与
`db_execute` 都拒绝触碰它们。这样一条 SQL 即可把用户自建表与任务、执行历史 JOIN 起来。

**小枢工具（`db_*`，共 12 个）**：

- 只读：`db_overview`（表清单 + 行数）、`db_describe`（结构 + 索引 + 样例行）、
  `db_query`（SELECT/WITH/PRAGMA/EXPLAIN，强制只读，默认 200 行上限 / 最高 2000）。
- 执行：`db_execute`（单条 DML/DDL，参数绑定）、`db_batch`（多语句事务）。
- 结构化：`db_create_table`、`db_alter_table`、`db_drop_table`、
  `db_insert`、`db_update`、`db_delete`（where 条件数组，全部参数绑定，
  update/delete 强制要求 where）。
- 维护：`db_sync_app_data`（强制刷新镜像）。

安全：标识符正则校验；值一律参数绑定；结果 40k 字符截断；
变更类工具纳入 `MUTATING_TOOLS` 审批（confirm-sensitive / read-only 模式下受控，
yolo 直通）。

**会话接入**：`db_*` 工具挂在主进程引擎上，**不依赖渲染进程窗口**——
常驻小枢会话与定时任务 headless 执行都可用（定时任务首次获得数据写能力：
可以把周报、统计结果写进项目数据库）。`runOneShot` 的轻量用途不挂。

**UI**：dock 面板「项目数据库」——表侧栏（用户表 / 应用数据镜像分组）、
数据网格（rowid、分页、按行删除、按列插入）、SQL 控制台（Ctrl/⌘+Enter 执行，
自动识别读/写路由）、新建表对话框。入口：Ribbon、⌘K 命令面板、项目右键菜单。

**IPC**：`db:list / db:describe / db:query / db:execute / db:create-table /
db:insert / db:update / db:delete / db:sync / db:path / db:delete-database`。
删除项目时一并删除其数据库文件。

## Files

- `src/shared/project-db.ts`（新增）：共享类型（表信息、列、条件、查询结果等）。
- `electron/project-db.ts`（新增）：`ProjectDbManager` 引擎 + 应用数据同步。
- `electron/db-tools.ts`（新增）：12 个 `db_*` 工具定义。
- `electron/project-db.test.ts`（新增）：引擎与守卫测试。
- `electron/pi.ts`：会话注入 `projectId`，assistant / scheduled 均挂 db 工具。
- `electron/assistant-control.ts`：db 变更类工具纳入审批与标签。
- `electron/main.ts`：IPC handlers、应用数据源注入、退出时关闭连接。
- `electron/preload.ts`、`src/lib/bridge.ts`：db API 桥接。
- `src/features/database/DatabasePanel.tsx`（新增）：面板 UI。
- `src/store/useProjectDbStore.ts`（新增）：面板状态。
- `src/components/DockLayout.tsx`、`Ribbon.tsx`、`CommandPalette.tsx`、
  `ProjectSidebar.tsx`：入口与项目删除联动。
- `src/shared/ai-prompts.ts`：助手与定时任务系统提示词加入数据库章节。

## Reuse

- `workspaceDir()`（electron/pi.ts）确定每项目数据库位置。
- `ScheduledTasksStore` 的串行队列与原子化风格。
- `task-tools.ts` 的 `defineTool` + TypeBox + 输出截断模式。
- `MUTATING_TOOLS` / `TOOL_LABELS` 审批机制（assistant-control.ts）。
- 应用数据来源：`mailuo.json`（项目/任务）、`SCHEDULED_TASKS_STORE`、
  `listProjectAssets()`、`MEMORY_ENGINE.snapshot()`。
