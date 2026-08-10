# pi 扩展与 Skills 管理支持计划

## Context

当前桌面应用通过 `@earendil-works/pi-coding-agent` SDK 在 Electron 主进程内创建 AgentSession，而不是直接运行独立 pi CLI。现状在 `electron/pi.ts` 中对 `DefaultResourceLoader` 设置了 `noExtensions: true`、`noSkills: true`，skills 由 `~/.mailuo/ai/skills` 下的自定义 `listSkills()` 手动读取；README 也明确应用不读取 `~/.pi`、项目 `.pi` 和 `~/.agents`。

目标是把 pi 生态真正接入应用：

- 应用独立管理 pi package，安装根目录规划为 `~/.mailuo/ai/packages/`，不复用 `~/.pi/agent` 的 settings、凭据或资源开关；
- 支持从 pi.dev/pi package 生态安装扩展包，并可启用、禁用、删除、更新；
- 支持扩展和 skills 的自定义路径，以及导入终端已经安装到其他目录的资源；
- 支持 skills.sh 的安装方式：应用内调用 `npx skills add <owner/repo>`（通过 `-a pi`、`--copy` 和受控工作目录接入），同时兼容终端安装后的目录注册；
- Extensions 全局开关，Skills 按上下文配置档控制可用范围，仍允许用户在单次对话中选择具体 skill；
- 在设置中提供清晰的资源列表、状态、来源、开关、安装/新建/查看/编辑/删除入口；
- 旧版 `~/.mailuo/ai/config.json` 无需手工迁移即可继续使用。

## Approach

推荐建立一层独立的 **Pi Resources 管理器**，由主进程负责安全、安装、发现和会话加载，渲染层只通过受控 IPC 操作：

1. 在应用 AI 配置中增加 pi 资源配置，保存应用管理的 package source、外部 extension/skill 路径及每项资源的启用状态/来源；context profile 增加可用 skill ID 覆盖。使用 Zod 默认值兼容旧配置。
2. `DefaultPackageManager` 使用 `agentDir=~/.mailuo/ai/packages` 和内存 settings，物理安装目录由 pi SDK 管理，但 package source/启用状态由 Mailuo config 持久化。应用启动时把配置中的 package source 注入内存 settings，再调用 `resolve()` 发现其资源。
3. pi.dev 包采用 pi package source（npm、git、HTTP/SSH URL、本地 package）；skills.sh 采用受控工作目录调用 `npx skills add <source> --skill ... --agent pi --copy --yes`，不使用 `-g` 写入用户的 `~/.pi/agent/skills`，安装完成后扫描生成的 `.pi/skills` 并登记来源。终端安装结果通过“添加路径/导入目录”接入，默认不自动读取外部 `~/.pi`。
4. 每次创建会话时根据当前快照解析 package 和路径，使用 `additionalExtensionPaths`、`additionalSkillPaths` 只装载启用资源；扩展仍可加载应用内置 inline extensions。配置变化后重置常驻 assistant，后续会话使用新资源。
5. 保留现有 `skillNames` 单次请求选择语义：资源管理器/loader 负责元数据和内容索引，context profile 决定哪些 skill 可出现在 Composer 候选，`assembleAiContext` 负责最终按请求注入，避免 Pi loader 自动注入一份、应用再拼接一份。
6. 设置页新增独立“Extensions & Skills”导航项：分为 Extensions、Skills、Packages/安装、路径四类操作，提供搜索、来源徽标、全局/配置档开关、错误状态、打开目录、查看详情和 skill 新建/编辑器；扩展编辑只提供路径/源码查看，不默认提供任意代码编辑，危险操作显示权限提示。

## Files to modify

- `src/shared/ai-config.ts`：增加 pi 资源配置、安装来源、启用状态、package scope 和 skills.sh 安装记录 schema；为 context profile 增加可用 skill ID；补充默认值和类型。
- `electron/ai-config-store.ts`：兼容旧配置、规范化路径/来源、创建 `~/.mailuo/ai/packages` 和 skills.sh 管理目录；保存资源配置所需目录。
- `electron/pi.ts`：根据资源配置创建 `DefaultPackageManager`/`DefaultResourceLoader`，加载启用的 extension/skill 路径；重构 skills 列表与内容读取，保留当前请求级筛选。
- `electron/pi-resources.ts`（新增）：集中实现资源发现、pi package 安装/移除/更新、skills.sh CLI 调用、外部目录导入、`SKILL.md` 扫描、启停与诊断，避免把安装逻辑塞入会话文件。
- `electron/main.ts`：增加资源列表、安装、卸载、更新、切换、打开路径、创建/读取/写入资源的 IPC handlers；所有路径和来源在主进程校验。
- `electron/preload.ts`、`src/lib/bridge.ts`：扩展受控 IPC 类型和 API。
- `src/store/useAiConfigStore.ts` 或新增 `src/store/usePiResourcesStore.ts`：管理资源快照、保存状态、安装进度和错误。
- `src/features/settings/SettingsDialog.tsx`、新增 `src/features/settings/PiResourcesPane.tsx`：增加独立导航项并实现资源管理设置页。
- `src/features/ai/skills.ts`、相关 AI 选择器：从资源快照读取可用 skills，支持查看、新建和按名称启用。
- `src-tauri` 不纳入本次改动：当前 AI/主进程实际走 Electron；若保留旧 Tauri 构建需另开兼容任务。
- 测试：`src/shared/ai-config` 对应测试（如新增）、`electron/ai-config-store.test.ts`、新增 `electron/pi-resources.test.ts`、`electron/pi.test.ts` 或现有 SDK/运行时测试。

## Reuse

- pi SDK `DefaultPackageManager`：`installAndPersist`、`removeAndPersist`、`update`、`listConfiguredPackages`、`resolveExtensionSources`。
- pi SDK `DefaultResourceLoader`：`additionalExtensionPaths`、`additionalSkillPaths`、`extensionFactories`、`skillsOverride`、`getExtensions()`、`getSkills()`。
- 当前 `electron/pi.ts:247-280` 的 `SettingsManager.inMemory`、模型/会话构造和内置 `extensionFactories`。
- 当前 `electron/pi.ts:183-205` 的 skills 读取逻辑及 `src/features/ai/skills.ts` 的缓存协议，改为由资源管理器返回统一记录。
- 当前 `AI_CONFIG.save`/`AI_RUNTIME.snapshot`/`assistantReset` 及 `useAiConfigStore` 的乐观 etag 保存模式。
- `electron/main.ts` 已有 `dialog.showOpenDialog`、`shell.openPath`、文件创建/读写 IPC 的安全模式。
- 现有设置页的 `SectionHeading`、`SettingRow`、`Field`、`ToggleField`、`Dialog`、`AlertDialog` 和 toast 交互模式。

## Steps

- [x] 明确资源模型：区分 app-managed package（可安装/更新）与外部 local path，定义 package source、installed path、resource ID、enabled、skill profile IDs、source kind、resolved path、diagnostics 字段；固定 `~/.mailuo/ai/packages` 为应用安装根目录。
- [x] 增加配置 schema 默认值和旧配置兼容策略；为应用专用资源目录、package 安装目录和 skills.sh 目录确定布局。
- [x] 实现主进程 `PiResourcesManager`：扫描资源、解析 manifest/frontmatter、生成稳定 ID、收集加载错误和版本/来源信息。
- [x] 接入 pi package 管理：npm、git、HTTP/SSH URL、本地 package 的安装、移除、更新、进度事件；安装完成后自动发现其中的 extensions/skills。
- [x] 接入 skills.sh：用 argv 调用 `npx skills add`，支持 source、指定 skill、`--agent pi`、`--copy`、`--yes` 和受控 cwd；提供 `--list` 预览、stdout/stderr 诊断、安装后目录扫描及更新/删除映射；支持已通过终端 `skills add` 安装的目录注册，不执行未经确认的任意 shell 字符串。
- [x] 改造 AgentSession 资源加载：只加载启用资源，保留内置扩展；将 extension 工具纳入工具注册/allowlist，避免加载成功但工具不可调用。
- [x] 重构 skills 列表和上下文注入：支持查看 `SKILL.md`、按请求选择、启停后立即刷新，不重复拼接 pi loader 与应用自定义内容。
- [x] 增加 IPC/preload/store，并让安装/刷新/配置保存后重置 assistant runtime。
- [x] 设计并实现设置页：Extensions、Skills、Packages/安装、路径四个子区；支持 pi package 源输入/安装进度、skills.sh 搜索链接与 source 安装、终端命令提示、路径选择、资源卡片、全局/配置档开关、更新/卸载、查看/新建/编辑 skill、重载和错误诊断。
- [x] 增加安全限制：来源白名单/确认、路径规范化、禁止越界写入、安装命令 argv 化、扩展全权限警告、超时/取消/日志截断。
- [x] 补齐单元测试、安装/扫描 fixtures 和手工验收流程。

## Verification

- 使用旧版仅含 providers/models/routes/contextProfiles/network 的 config 启动，确认自动补齐新配置且不破坏原数据。
- 从设置页安装一个 npm/git pi package，确认 package、其中的 extension 和 skill 都能列出；切换 enabled 后重新启动会话，确认只加载启用项，且物理文件位于 `~/.mailuo/ai/packages`。
- 从设置页用 `npx skills add` 安装一个 skills.sh 仓库，确认只写入应用管理目录；用终端安装到 `.pi/skills`/`.agents/skills` 后添加该目录，点击刷新，确认能查看 `SKILL.md`、新建/编辑并在 AI 请求中按 skill 名称注入。
- 为不同 context profile 配置不同 skill 集合，确认 Composer 只展示当前用途允许的 skill；Extensions 的开关对所有会话生效。
- 验证扩展自定义工具在启用后出现在可用工具中，禁用后不会被模型调用；内置 inline extensions 仍正常工作。
- 验证安装失败、来源不存在、路径不存在、重复 package、非 skill 目录、恶意/越界路径和取消操作均有可读错误且不会破坏配置。
- 运行 `pnpm test`、`pnpm build`，并手工检查设置页在空资源、加载中、错误、长路径和多资源场景下的布局。

---

# 定时任务（Scheduled Tasks）计划

## Context

目标是在**项目维度**提供类似 Codex Scheduled Tasks 的能力：用户为某个项目配置「时间 + 提示词」，到点后应用自动在后台让小枢执行一轮，产出 Markdown 报告并通知用户。典型场景：每天早上汇总本项目任务进展、每周五生成周报、每月初整理记忆与待办。

现状调研结论（决定方案走向）：

- `runOneShot()`（electron/pi.ts:641）是现成的主进程 headless 执行先例：resolve 路由 → buildPrompt 组装上下文 → 一次性 session → `AgentTurnAccumulator` 收尾 → dispose，全程无 UI 参与。**定时执行直接仿此实现**。
- `buildPrompt()` / `assembleAiContext()`（electron/context-assembly.ts）已支持按 projectId 注入项目快照与长期记忆，可直接复用，保证定时产出与交互式小枢上下文一致。
- `AssistantTurnRuntime` 单 turn 锁只约束交互式 assistant；定时任务用独立一次性 session，不占用该锁，但**多个定时任务之间需串行**（对齐 task 工具的 `executionMode: "sequential"` 先例）。
- task 工具（electron/task-runtime.ts）通过 IPC 依赖渲染进程响应、10s 超时；**窗口关闭时后台执行会失败，因此 v1 定时执行不挂 task 工具**，只给文件工具（read/bash/edit/write），cwd = `workspaceDir(projectId)`。
- 主进程无系统通知、无常驻定时器先例；macOS 关窗后进程保活（main.ts:1102），Win/Linux 关窗即退出——调度可靠性限制需在 UI 中说明。
- AI 配置是 per-useCase 路由（`AiUseCase`）；新增 `"scheduled"` useCase 后，用户可为定时任务单独指定便宜模型。
- 对话历史只存渲染端 localStorage，主进程无结果落盘——定时任务需要**自己的持久化**。

## Approach

1. **数据模型**（放 `src/shared/scheduled-tasks.ts`，Zod schema + 类型）：
   - `ScheduledJob`：`{ id, projectId, name, prompt, schedule, enabled, modelOverride?, createdAt, updatedAt, lastRun?, nextRunAt }`；`schedule = { kind: "daily"; time: "HH:mm" } | { kind: "weekly"; time: string; weekdays: number[] }`（1=周一…7=周日，复用现有 `WEEKDAY_LABEL` 语义）。本地时区。
   - `ScheduledRun`：`{ id, jobId, projectId, startedAt, finishedAt, status: "running"|"ok"|"error"|"missed"|"cancelled", resultMarkdown?, error? }`；每个 job 保留最近 20 条。
2. **持久化**：新建 `electron/scheduled-tasks-store.ts`，仿 `memory-engine.ts` 模式——存 `~/.mailuo/scheduled-tasks-v1.json`，串行操作队列 + `atomicWrite`（tmp+rename）。jobs 与 runs 同文件。**不塞进** `ai-config-store`（etag 语义不符）也**不塞进** mailuo.json（渲染端防抖写入，主进程写历史会竞态）。
3. **调度器**：新建 `electron/scheduled-task-scheduler.ts` 单例：
   - app ready 启动，`will-quit` 停止；30s tick 检查 `nextRunAt <= now` 的启用 job。
   - 触发后把 job 推入**串行执行队列**，调用执行器；完成后重算 `nextRunAt` 并落盘。
   - **错过补偿策略**：tick/启动时发现 `now > nextRunAt + 5min` 宽限，记一条 `missed` run 并把 `nextRunAt` 滚到下一次，不自动补跑（Codex 同语义）。
   - `nextRunAt` 计算为纯函数（daily/weekly + 本地时区），单独可测。
4. **执行器**：`electron/pi.ts` 新增 `runScheduledJob(job)`：
   - `AI_RUNTIME.resolve("scheduled", job.modelOverride)` 路由（`AiUseCase` 增加 `"scheduled"`，`ai-prompts.ts` 增加 `SCHEDULED_TASK_SYSTEM_PROMPT`：要求小枢基于项目上下文执行提示词并输出简明 Markdown 报告）。
   - 复用 `buildPrompt()` 注入项目快照/记忆；`makeSessionRuntime(resolved, system, { cwd: workspaceDir(projectId), withTools: true })` 但**剔除 task 工具**（注册处过滤，避免后台 IPC 超时）。
   - 事件流累积用 `AgentTurnAccumulator`；超时上限（如 10 分钟）与取消支持（用户可在 UI 停止 running 的 run）。
   - 完成后 `MEMORY_ENGINE.learnTurn()` 同样适用（定时产出的事实也应进记忆，v1 可先保守关闭，验收后再定）。
5. **通知**：完成/失败时——窗口存在用 `safeSendToWindow` 发 `scheduled:run-done` 事件触发 sonner toast；同时新增 Electron `new Notification()`（`Notification.isSupported()` 兜底），保证窗口关闭（macOS 保活）也能提醒。
6. **IPC / preload / bridge**（三处手工同步，沿用现有模式）：
   - handle：`scheduled:list`、`scheduled:save`（create/update）、`scheduled:delete`、`scheduled:toggle`、`scheduled:run-now`、`scheduled:cancel`、`scheduled:runs`。
   - 事件：`scheduled:run-state`（running/进度）、`scheduled:run-done`。
   - `preload.ts` 扁平 api + `src/lib/bridge.ts` `MailuoApi` 类型同步。
7. **渲染层**：
   - 新建 `src/store/useScheduledTasksStore.ts`：jobs/runs 快照、保存态、运行态订阅。
   - 新建 dock 面板 `ScheduledTasksPanel.tsx`（component 名 `"scheduled"`，注册进 `DockLayout.tsx` 的 `components` 表 + 打开函数仿 `focusBrowserPanel` 模式）：左侧 job 列表（按项目分组，显示启用态/下次运行/上次结果），右侧运行历史与 Markdown 结果（react-markdown，与助手消息同款渲染）；工具栏含新建、编辑、启停、立即运行、停止。
   - 编辑弹窗 `ScheduledTaskEditorDialog.tsx`：名称、项目选择、daily/weekly + 时间 + 星期多选、提示词多行输入、模型覆盖（下拉，来自 AI 配置路由）。
   - 入口：Ribbon 加「定时任务」按钮；`ProjectSidebar.tsx` 项目右键菜单加「定时任务」，打开面板并过滤到该项目。
   - 面板顶部提示常驻条件（macOS 关窗可跑、Win/Linux 需保持应用开启）。

## Files to modify

- `src/shared/scheduled-tasks.ts`（新增）：Zod schema、类型、`describeSchedule` 文案。
- `src/shared/ai-prompts.ts` / `src/shared/ai-config.ts`：`AiUseCase` 增加 `"scheduled"` 与系统提示词、默认路由。
- `electron/scheduled-tasks-store.ts`（新增）+ `electron/scheduled-tasks-store.test.ts`。
- `electron/scheduled-task-scheduler.ts`（新增）+ next-run/missed 纯函数测试。
- `electron/pi.ts`：`runScheduledJob()`、task 工具过滤、`OneShotUseCase` 兼容检查。
- `electron/main.ts`：IPC 注册、ready/will-quit 接线。
- `electron/preload.ts`、`src/lib/bridge.ts`：API 与类型。
- `src/store/useScheduledTasksStore.ts`（新增）。
- `src/features/tasks/ScheduledTasksPanel.tsx`、`ScheduledTaskEditorDialog.tsx`（新增）。
- `src/components/DockLayout.tsx`：注册 `"scheduled"` 面板与打开函数。
- `src/components/Ribbon.tsx`、`src/features/projects/ProjectSidebar.tsx`：入口。
- `src/lib/i18n.ts`：文案（如启用）。

## Reuse

- `runOneShot()`（pi.ts:641）执行骨架；`buildPrompt()` + `assembleAiContext()` 上下文组装；`workspaceDir()`（pi.ts:69）项目工作目录。
- `memory-engine.ts` 的串行队列 + `atomicWrite` 持久化模式。
- `safeSendToWindow()`（window-lifecycle.ts）主→渲染推送；task-runtime 的 sequential 执行语义。
- `src/lib/task-schedule.ts` 的本地时区日期工具（`toISODate`/`fromISODate` 正午避夏令时）与 `WEEKDAY_LABEL`。
- DockLayout `components` 注册 + `focusBrowserPanel` 打开/聚焦模式；`ProjectEditorDialog` 弹窗交互模式；`SectionHeading`/`SettingRow` 布局件。
- AI 路由：`AI_RUNTIME.resolve(useCase, modelOverride)` 天然支持按 useCase 配模型。

## Steps

- [ ] `src/shared/scheduled-tasks.ts`：schema 与类型；`AiUseCase` 增加 `"scheduled"` 及默认路由/系统提示词。
- [ ] `scheduled-tasks-store`：load/save/CRUD/appendRun/裁剪历史，串行队列 + 原子写 + 测试。
- [ ] next-run 纯函数（daily/weekly、本地时区、missed 判定）+ 测试。
- [ ] 调度器单例：30s tick、串行执行队列、错过记 missed、启动/停止接线 main.ts。
- [ ] `runScheduledJob()`：路由 → buildPrompt → 带文件工具（剔除 task 工具）的 headless session → 结果/错误 → learnTurn 策略；超时与取消。
- [ ] IPC/preload/bridge：7 个 handle + 2 个事件，类型三处同步。
- [ ] `useScheduledTasksStore` + 事件订阅（running 状态实时刷新）。
- [ ] UI：ScheduledTasksPanel（列表/历史/Markdown 结果）、编辑弹窗、Ribbon 与项目右键入口、系统通知 + toast。
- [ ] 手工验收全流程（见 Verification）。

## Verification

- 新建 daily 09:00 任务并「立即运行」：确认主进程 headless 执行、结果落盘、toast + 系统通知、Markdown 正常渲染；执行期间助手对话不被阻塞，两个定时任务串行不并发。
- 把系统时间场景改为 nextRunAt 已过 10 分钟再启动应用：确认记 missed 并滚到下一次，不补跑。
- macOS 关窗后等待触发：确认任务仍执行且系统通知出现；Win/Linux 文档化限制。
- 禁用/删除 job 后不再触发；编辑 schedule 后 `nextRunAt` 立即重算；modelOverride 指向的模型确实被使用（看日志/用量）。
- 提示词引用项目上下文：确认报告内容包含该项目任务快照（验证 buildPrompt 注入）；跨项目 job 不串上下文。
- 执行中取消、模型报错、空回复、超时四类异常均有可读错误且 run 状态正确；`~/.mailuo/scheduled-tasks-v1.json` 结构完整、历史不超过 20 条/job。
- `pnpm test`、`pnpm build` 全绿。
