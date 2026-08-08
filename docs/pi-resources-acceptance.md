# Pi Resources 手工验收

## 前置

```bash
pnpm install
pnpm dev
```

确认本机有 Node.js、npm/npx；Extension 和远程 Skill 会执行下载或加载操作，只使用可信来源。

## 配置兼容与目录

1. 启动应用，确认设置侧栏分别显示「扩展」和「技能」两个入口。
2. 确认页面可加载，且应用目录下出现：
   - `~/.mailuo/ai/packages/`
   - `~/.mailuo/ai/skills-sh/`
   - `~/.mailuo/ai/skills/`
3. 在旧版 `config.json` 中删除 `pi` 字段后重启，确认配置自动补齐且 Provider/模型/用途路由不丢失。

## pi package

1. 打开「设置 → 扩展」，在 pi.dev 搜索框输入关键词，确认显示名称、版本、作者、月下载量与描述。
2. 点击搜索结果的「预览」，确认安装前展示 package 来源、许可证、扩展入口和 Electron 主进程权限提示；关闭预览时不得触发安装。
3. 点击「确认安装」，确认安装过程中能看到进度；也可在“通过 package 地址安装”中预览可信的 `npm:<package>` 或 `git:<host>/<owner>/<repo>`。
4. 安装完成后确认 package、Extension、Skill 都能被扫描出来。
5. 关闭 package 或单个 Extension，重新发送一个带工具的助手请求，确认对应资源不再加载；内置浏览器/任务工具仍可用。
6. 点击更新和卸载，确认资源列表和 `~/.mailuo/ai/packages` 内容同步变化。
7. 用不存在的来源、带换行的来源和 `bash -c ...` 测试，确认被拒绝且配置不被破坏。

## skills.sh

1. 打开「设置 → 技能」，搜索 `react`，确认显示 skills.sh 的技能名称、来源与安装量。
2. 点击搜索结果的「预览」，确认结构化展示技能描述和仓库来源，且此时不写入安装目录；点击取消不得触发安装。
3. 点击「确认安装」，确认命令等价于受控的：

   ```bash
   npx --yes skills add <source> --skill <name> --agent pi --copy --yes
   ```

4. 确认文件落在 `~/.mailuo/ai/skills-sh/<id>/.pi/skills/`，不会写入 `~/.pi/agent/skills`。
5. 在已安装技能列表查看、停用、按上下文配置档限制，再在助手输入框使用 `$skill` 选择，确认只有允许的 Skill 被注入。
6. 点击编辑并保存 `SKILL.md`，确认重新扫描后内容立即生效；新建 Skill 后确认目录和 frontmatter 正确。
7. 更新、删除 skills.sh 安装记录，确认目录、配置记录和列表同步移除。

## 终端安装兼容

1. 在终端使用 pi CLI 或 skills.sh 安装到外部目录，例如项目 `.pi/skills` 或 `.agents/skills`。
2. 在对应的「扩展」或「技能」页面的“自定义路径”区选择目录并标记为「终端安装目录」。
3. 点击刷新，确认 Skill/Extension 出现；禁用路径后确认不加载；移除登记时确认不会删除外部文件。

## 诊断与取消

1. 断网或输入不可访问的 source，确认页面显示 stdout/stderr 或路径诊断。
2. 安装期间点击「取消」，确认子进程终止，页面可继续操作。
3. 添加不存在的路径，确认路径卡片显示错误而不是让助手启动失败。
4. 长路径、长日志和空资源列表下检查页面不溢出。

## 自动化检查

```bash
pnpm test
pnpm build
```
