import { useEffect, useMemo, useState } from "react";
import {
  ChartPie,
  Folder,
  FolderPlus,
  Globe2,
  Grid2x2,
  Home,
  ListPlus,
  ListTree,
  MessageCircleMore,
  MoonStar,
  Settings,
  Sparkles,
  SquareKanban,
  SquareSplitVertical,
  SunMedium,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useAppStore, type ViewMode } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { MOD_KEY } from "@/lib/platform";
import {
  ensureWorkspace,
  focusOrOpenBrowser,
  openAssetPanel,
  openBrowserPanel,
} from "@/components/DockLayout";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen);
  const setOpen = useAppStore((s) => s.setCommandOpen);
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const selectProject = useAppStore((s) => s.selectProject);
  const selectTask = useAppStore((s) => s.selectTask);
  const setView = useAppStore((s) => s.setView);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const setAiDialog = useAppStore((s) => s.setAiDialog);

  const [query, setQuery] = useState("");

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  // 一次挂载上千个 CommandItem 会让面板一打开就卡；没输入时只给当前项目的近期任务
  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return tasks
        .filter((t) => t.projectId === selectedProjectId && t.status !== "done")
        .slice(0, 20);
    }
    return tasks
      .filter((t) => {
        const project = projectById.get(t.projectId);
        return `${t.title} ${project?.name ?? ""}`.toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [tasks, query, selectedProjectId, projectById]);

  // 面板关掉后清查询，下次打开不该还留着上次输的东西
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const goToView = (v: ViewMode) => {
    // 与 ⌘1/⌘2 保持一致：工作区标签被关掉时先把它开回来
    ensureWorkspace();
    setView(v);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="命令面板"
      description="搜索项目、任务或执行操作"
    >
      {/* 交给 cmdk 做匹配与高亮，这里只负责别把上千个任务全挂上去 */}
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="搜索项目、任务或操作…"
        />
        <CommandList>
        <CommandEmpty>没有找到匹配项</CommandEmpty>
        {/* 最高频的两个动作原本只能靠鼠标点，命令面板里反而没有 */}
        <CommandGroup heading="新建">
          <CommandItem
            value="新建任务 new task"
            onSelect={() =>
              run(() => {
                ensureWorkspace();
                setView("list");
                requestAnimationFrame(() =>
                  window.dispatchEvent(new CustomEvent("mailuo:new-task"))
                );
              })
            }
            disabled={!selectedProjectId}
          >
            <ListPlus />
            新建任务
            <CommandShortcut>{MOD_KEY}N</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="新建项目 new project"
            onSelect={() =>
              run(() => {
                const store = useAppStore.getState();
                if (!store.panelLeft) store.togglePanel("left");
                requestAnimationFrame(() =>
                  window.dispatchEvent(new CustomEvent("mailuo:new-project"))
                );
              })
            }
          >
            <FolderPlus />
            新建项目
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="项目">
          {projects.map((p) => (
            <CommandItem
              key={p.id}
              value={`project-${p.name}`}
              onSelect={() => run(() => selectProject(p.id))}
            >
              <Folder />
              <span className="truncate">{p.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="任务">
          {visibleTasks.map((t) => {
            const project = projectById.get(t.projectId);
            return (
              <CommandItem
                key={t.id}
                value={`task-${t.title}-${project?.name ?? ""}`}
                onSelect={() =>
                  run(() => {
                    selectProject(t.projectId);
                    selectTask(t.id);
                  })
                }
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    t.status === "done" && "bg-status-done",
                    t.status === "doing" && "bg-status-doing",
                    t.status === "todo" && "bg-status-todo"
                  )}
                />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {project?.name}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="AI">
          <CommandItem onSelect={() => run(() => setAssistantOpen(true))}>
            <MessageCircleMore />
            呼叫小枢（AI 助手）
            <CommandShortcut>{MOD_KEY}J</CommandShortcut>
          </CommandItem>
          {selectedTaskId && (
            <CommandItem
              onSelect={() =>
                run(() => setAiDialog({ type: "breakdown", taskId: selectedTaskId }))
              }
            >
              <SquareSplitVertical />
              AI 拆解当前任务
            </CommandItem>
          )}
          {selectedProjectId && (
            <>
              <CommandItem
                onSelect={() =>
                  run(() =>
                    setAiDialog({ type: "plan", projectId: selectedProjectId })
                  )
                }
              >
                <Sparkles />
                AI 规划当前项目
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  run(() =>
                    setAiDialog({
                      type: "suggestDeps",
                      projectId: selectedProjectId,
                    })
                  )
                }
              >
                <ListPlus />
                AI 依赖建议
              </CommandItem>
            </>
          )}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="操作">
          <CommandItem onSelect={() => run(() => focusOrOpenBrowser())}>
            <Globe2 />
            打开 / 聚焦浏览器
            <CommandShortcut>{MOD_KEY}⇧G</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => openBrowserPanel())}>
            <Globe2 />
            新建浏览器标签
          </CommandItem>
          <CommandItem onSelect={() => run(() => openAssetPanel())}>
            <Folder />
            打开项目资产
          </CommandItem>
          <CommandItem onSelect={() => run(() => setSettingsOpen(true))}>
            <Settings />
            打开设置
            <CommandShortcut>{MOD_KEY},</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => goToView("home"))}>
            <Home />
            切换到主页
            <CommandShortcut>{MOD_KEY}1</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => goToView("list"))}>
            <SquareKanban />
            切换到列表视图
            <CommandShortcut>{MOD_KEY}2</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => goToView("graph"))}>
            <ListTree />
            切换到脉络图
            <CommandShortcut>{MOD_KEY}3</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => goToView("stats"))}>
            <ChartPie />
            切换到统计
            <CommandShortcut>{MOD_KEY}4</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => goToView("matrix"))}>
            <Grid2x2 />
            切换到四象限
            <CommandShortcut>{MOD_KEY}5</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => setTheme(theme === "dark" ? "light" : "dark"))
            }
          >
            {theme === "dark" ? <SunMedium /> : <MoonStar />}
            切换{theme === "dark" ? "浅色" : "深色"}模式
          </CommandItem>
        </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
