import {
  Folder,
  Globe2,
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
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { MOD_KEY } from "@/lib/platform";
import { focusOrOpenBrowser, openAssetPanel, openBrowserPanel } from "@/components/DockLayout";

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

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="命令面板"
      description="搜索项目、任务或执行操作"
    >
      <Command>
        <CommandInput placeholder="搜索项目、任务或操作…" />
        <CommandList>
        <CommandEmpty>没有找到匹配项</CommandEmpty>
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
          {tasks.map((t) => {
            const project = projects.find((p) => p.id === t.projectId);
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
          <CommandItem onSelect={() => run(() => setView("list"))}>
            <SquareKanban />
            切换到列表视图
            <CommandShortcut>{MOD_KEY}1</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => setView("graph"))}>
            <ListTree />
            切换到脉络图
            <CommandShortcut>{MOD_KEY}2</CommandShortcut>
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
