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
