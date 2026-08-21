# json-render 深度集成增强计划

## Context

脉络 (Màiluò) 已经集成了 `@json-render/core` ^0.19.0 和 `@json-render/react` ^0.19.0，小枢可以通过 `mailuo-ui` 代码块输出 22 种结构化组件（卡片、图表、交互控件等）+ 7 个动作。但当前集成只用了 json-render 的基础渲染能力，以下高级特性尚未启用：

- **repeat 列表渲染**：List 组件靠静态 `items` 数组，无法绑定 state 动态渲染
- **state 数据注入**：`StateProvider initialState={{}}` 始终为空，AI 无法通过 `$state` 引用真实项目数据
- **visibility 条件显隐**：元素没有 `visible` 字段
- **`$template` / `$state` 动态 props**：所有 props 都是静态字面量
- **SpecStream 渐进式渲染**：UI 块是回复完成后一次性解析的，不能边生成边渲染
- **Provider 分散**：StateProvider / VisibilityProvider / ActionProvider 分开写，可合并为 `JSONUIProvider`

目标：在不破坏现有协议的前提下，逐层增强 json-render 的深度使用，让 AI 能生成更动态、更数据驱动的交互卡片。

## Approach

分 4 个 phase 渐进式增强，每个 phase 独立可验收：

1. **Phase 1 — 基础增强（低风险）**：合并 Provider、注入真实 state、更新 prompt
2. **Phase 2 — 数据绑定**：启用 `$state` / `$template` / `visible`，让卡片能引用真实数据
3. **Phase 3 — repeat 列表**：让 AI 能渲染动态列表（任务列表、标签云等）
4. **Phase 4 — SpecStream 流式渲染**：让 UI 卡片随 AI 回复渐进式出现

## Files to modify

| 文件 | 改动 |
|---|---|
| `src/features/ai/uiCatalog.tsx` | 合并 Provider → JSONUIProvider；注入 project state；新增 `repeat` 支持提示 |
| `src/features/ai/AssistantPanel.tsx` | 传 project/task 数据给 UiBlock；可选：SpecStream 接线 |
| `src/features/ai/actions.ts` | 更新 `ASSISTANT_SYSTEM` prompt，加入数据绑定/visibility/repeat 语法说明 |
| `src/shared/ai-prompts.ts` | 同步更新 `ASSISTANT_SYSTEM_PROMPT` |
| `src/features/ai/uiActions.ts` | 保持不动（动作已完备） |
| `src/features/ai/uiCatalog.test.ts` | 新增数据绑定/visibility/repeat 相关测试 |

## Reuse

| 现有代码 | 用途 |
|---|---|
| `uiCatalog.tsx` — `defineCatalog`, `defineRegistry`, `UiBlock` | 核心骨架，只需要增强 |
| `uiActions.ts` — `createUiActionHandlers`, `uiActions` | 动作处理器，不变 |
| `actions.ts` — `parseAssistantReply`, `sanitizeUiSpec` | 协议解析，`sanitizeUiSpec` 需要放松以允许 `$state`/`visible`/`repeat` 字段 |
| `actions.ts` — `projectContext()` | 构造项目快照，可复用于注入 state |
| `uiCatalog.test.ts` | 已有测试框架，新增用例 |

## Steps

### Phase 1 — 基础增强

- [ ] **Step 1.1**：`UiBlock` 中用 `JSONUIProvider` 替换三个独立 Provider（StateProvider + VisibilityProvider + ActionProvider）
- [ ] **Step 1.2**：`UiBlock` 接受可选的 `initialState` prop，允许调用方注入项目上下文数据
- [ ] **Step 1.3**：`AssistantPanel.tsx` 构造 state 快照（当前项目名、任务数量统计等），传给 `UiBlock`
- [ ] **Step 1.4**：`sanitizeUiSpec` 放行 `$state`、`$template`、`$item`、`visible`、`repeat` 等合法字段（当前未知字段会被 strip）
- [ ] **Step 1.5**：更新 AI 系统提示词（`actions.ts` + `ai-prompts.ts`），加入 `$state` 数据绑定和 `visible` 的基础语法示例

### Phase 2 — 数据绑定 & 条件显隐

- [ ] **Step 2.1**：在 `UI_CATALOG_PROMPT` 的 `customRules` 中增加数据绑定说明（`$state` 路径、`$template` 模板、`visible` 条件）
- [ ] **Step 2.2**：扩展 `sanitizeUiSpec`，允许元素携带 `visible` 字段（`{ "$state": "/path" }`、`{ "$state": "/path", "eq": "value" }` 等）
- [ ] **Step 2.3**：更新 `STATIC_AI_PROMPT`（`ASSISTANT_SYSTEM`），加入 `mailuo-ui` 的数据绑定例子（如用 `$state` 显示项目名、任务数）
- [ ] **Step 2.4**：AI prompt 中增加 `$cond`/`$then`/`$else` 条件 props 的语法示例

### Phase 3 — repeat 列表渲染

- [ ] **Step 3.1**：在 catalog 中为 `Card`/`Row` 等容器组件声明 `supportsRepeat: true`（或直接在 prompt 中说明）
- [ ] **Step 3.2**：更新 AI prompt，加入 `repeat` 的完整示例（如用 repeat 渲染项目任务列表）
- [ ] **Step 3.3**：`sanitizeUiSpec` 放行元素上的 `repeat` 字段（`{ statePath, key }`）
- [ ] **Step 3.4**：`AssistantPanel.tsx` 注入更完整的 state 数据（任务列表数组），支持 repeat 绑定

### Phase 4 — SpecStream 流式渲染（可选/实验性）

- [ ] **Step 4.1**：评估 `@json-render/react` 的 `useUIStream` / `createSpecStreamCompiler` 在当前 pi SDK 流式架构中的接入点
- [ ] **Step 4.2**：如果可行，在 AI 回复流中解析 JSONL patch 行，渐进式更新 spec
- [ ] **Step 4.3**：保留 `mailuo-ui` 围栏解析作为 fallback（兼容不支持 SpecStream 的模型）

## Verification

1. **Phase 1 验证**：
   - 发一条「显示当前项目概况」给小枢，确认 AI 生成的卡片能通过 `$state` 引用项目名
   - `pnpm vitest -- src/features/ai/uiCatalog.test.ts` 全部通过
   
2. **Phase 2 验证**：
   - 发「如果任务数 > 5 则显示警告卡片」，确认 AI 使用 `visible` 条件
   - 发「用 $template 拼一段项目名 + 统计」，确认模板渲染正确

3. **Phase 3 验证**：
   - 发「列出所有进行中的任务」，确认 AI 使用 `repeat` 而非静态 List
   - 检查 JSON 输出中是否包含 `repeat: { statePath: "/tasks", key: "id" }`

4. **Phase 4 验证**：
   - 发一条触发生成 UI 的消息，观察 UI 卡片是否渐进式出现（而非一次性闪现）
