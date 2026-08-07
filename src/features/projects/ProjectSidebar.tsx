import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Archive,
  BookOpen,
  BriefcaseBusiness,
  FlaskConical,
  FolderPlus,
  House,
  PanelLeftClose,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Rocket,
  Sparkles,
  Target,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { isBlocked } from "@/lib/deps";
import { isSubmitKey } from "@/lib/keyboard";
import type { Project, Task } from "@/types";
import { PROJECT_COLORS } from "@/types";

const PROJECT_ICON_OPTIONS: Array<{
  id: string;
  label: string;
  icon: LucideIcon;
  legacy?: string;
}> = [
  { id: "rocket", label: "推进", icon: Rocket, legacy: "\u{1F680}" },
  { id: "book-open", label: "阅读", icon: BookOpen, legacy: "\u{1F4DA}" },
  {
    id: "briefcase",
    label: "工作",
    icon: BriefcaseBusiness,
    legacy: "\u{1F4BC}",
  },
  { id: "house", label: "生活", icon: House, legacy: "\u{1F3E1}" },
  { id: "target", label: "目标", icon: Target, legacy: "\u{1F3AF}" },
  { id: "flask", label: "实验", icon: FlaskConical, legacy: "\u{1F9EA}" },
];

function normalizeProjectIcon(value: string | undefined): string {
  if (!value) return "";
  return (
    PROJECT_ICON_OPTIONS.find(
      (option) => option.id === value || option.legacy === value
    )?.id ?? ""
  );
}

function projectIconComponent(value: string | undefined): LucideIcon | null {
  const normalized = normalizeProjectIcon(value);
  return (
    PROJECT_ICON_OPTIONS.find((option) => option.id === normalized)?.icon ?? null
  );
}

function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`选择颜色 ${c}`}
          className={cn(
            "size-6 rounded-full border-2 transition-transform",
            value === c
              ? "scale-110 border-foreground"
              : "border-transparent hover:scale-105"
          )}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function ProjectEditorDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null; // null = 新建
}) {
  const addProject = useAppStore((s) => s.addProject);
  const renameProject = useAppStore((s) => s.renameProject);
  const setProjectColor = useAppStore((s) => s.setProjectColor);
  const setProjectIcon = useAppStore((s) => s.setProjectIcon);
  const setProjectTags = useAppStore((s) => s.setProjectTags);
  const tagLibrary = useAppStore((s) => s.tagLibrary);

  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [icon, setIcon] = useState(normalizeProjectIcon(project?.icon));
  const [tagsText, setTagsText] = useState((project?.tags ?? []).join(" "));

  const submit = () => {
    if (!name.trim()) return;
    const tags = tagsText.split(/[\s,，]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6);
    if (project) {
      renameProject(project.id, name);
      setProjectColor(project.id, color);
      setProjectIcon(project.id, icon.trim());
      setProjectTags(project.id, tags);
      toast.success("项目已更新");
    } else {
      const created = addProject(name, color);
      if (created) {
        if (icon.trim()) setProjectIcon(created.id, icon.trim());
        if (tags.length) setProjectTags(created.id, tags);
      }
      toast.success(`项目「${name.trim()}」已创建`);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{project ? "编辑项目" : "新建项目"}</DialogTitle>
          <DialogDescription>
            {project ? "修改项目名称与颜色。" : "为一组相关的事务开一条脉络。"}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="project-name">名称</FieldLabel>
            <Input
              id="project-name"
              autoFocus
              value={name}
              placeholder="例如：新版官网上线"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && submit()}
            />
          </Field>
          <Field>
            <FieldLabel>颜色</FieldLabel>
            <ColorSwatches value={color} onChange={setColor} />
          </Field>
          <Field>
            <FieldLabel>图标</FieldLabel>
            <div className="flex items-center gap-1.5">
              {PROJECT_ICON_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={icon === option.id}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      icon === option.id &&
                        "border-primary bg-accent text-primary ring-2 ring-ring/30"
                    )}
                    onClick={() =>
                      setIcon((current) =>
                        current === option.id ? "" : option.id
                      )
                    }
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="project-tags">标签</FieldLabel>
            <Input
              id="project-tags"
              value={tagsText}
              placeholder="空格分隔，如：工作 长期"
              onChange={(e) => setTagsText(e.target.value)}
            />
            {tagLibrary.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {tagLibrary.slice(0, 12).map((t) => {
                  const applied = tagsText.split(/[\s,，]+/).includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                        applied
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-dashed text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() =>
                        setTagsText((v) =>
                          applied
                            ? v
                                .split(/[\s,，]+/)
                                .filter((x) => x && x !== t)
                                .join(" ")
                            : `${v.trim()} ${t}`.trim()
                        )
                      }
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            {project ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectSidebar() {
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectProject = useAppStore((s) => s.selectProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const restoreProject = useAppStore((s) => s.restoreProject);
  const setAiDialog = useAppStore((s) => s.setAiDialog);
  const togglePinProject = useAppStore((s) => s.togglePinProject);
  const toggleArchiveProject = useAppStore((s) => s.toggleArchiveProject);
  const duplicateProject = useAppStore((s) => s.duplicateProject);

  const [editorOpen, setEditorOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  // 第一栏头部（NavColumn）的「新建项目」按钮通过全局事件触发
  useEffect(() => {
    const onNew = () => {
      setEditing(null);
      setEditorOpen(true);
    };
    window.addEventListener("mailuo:new-project", onNew);
    return () => window.removeEventListener("mailuo:new-project", onNew);
  }, []);

  const today = format(new Date(), "yyyy-MM-dd");
  const stats = useMemo(() => {
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      const list = byProject.get(t.projectId) ?? [];
      list.push(t);
      byProject.set(t.projectId, list);
    }
    const m = new Map<
      string,
      { total: number; done: number; doing: number; blocked: number; overdue: number }
    >();
    for (const [pid, list] of byProject) {
      const byId = new Map(list.map((t) => [t.id, t]));
      m.set(pid, {
        total: list.length,
        done: list.filter((t) => t.status === "done").length,
        doing: list.filter((t) => t.status === "doing").length,
        blocked: list.filter((t) => t.status === "todo" && isBlocked(t, byId))
          .length,
        overdue: list.filter(
          (t) => t.status !== "done" && t.dueDate && t.dueDate < today
        ).length,
      });
    }
    return m;
  }, [tasks, today]);

  const totals = useMemo(() => {
    const all = [...stats.values()];
    return {
      tasks: all.reduce((s, x) => s + x.total, 0),
      open: all.reduce((s, x) => s + (x.total - x.done), 0),
      blocked: all.reduce((s, x) => s + x.blocked, 0),
    };
  }, [stats]);

  const EMPTY = { total: 0, done: 0, doing: 0, blocked: 0, overdue: 0 };

  const allTags = [...new Set(projects.flatMap((p) => p.tags ?? []))];
  const activeList = [...projects]
    .filter((p) => !p.archived)
    .filter((p) => !tagFilter || (p.tags ?? []).includes(tagFilter))
    .sort(
      (a, b) =>
        Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
        a.createdAt - b.createdAt
    );
  const archivedList = projects.filter((p) => p.archived);

  return (
    // min-w：拖拽收窄时内容整体裁切而非文字换行挤压
    <nav className="flex h-full min-w-[170px] flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
        <span className="text-[11px] font-medium text-muted-foreground">
          项目
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {activeList.length}
        </span>
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="新建项目"
            className="size-6.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <FolderPlus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="收起项目栏"
            className="size-6.5 text-muted-foreground hover:text-foreground"
            onClick={() => useAppStore.getState().togglePanel("left")}
          >
            <PanelLeftClose />
          </Button>
        </div>
      </div>
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pt-2">
          {allTags.map((tag) => (
            <button
              key={tag}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] transition-colors",
                tagFilter === tag
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/6 text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
      <div className="h-1.5" />
      <ul className="flex-1 overflow-y-auto px-2.5">
        {activeList.map((p) => {
          const s = stats.get(p.id) ?? EMPTY;
          const active = p.id === selectedProjectId;
          const ProjectIcon = projectIconComponent(p.icon);
          return (
            <li key={p.id} className="group relative">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    className={cn(
                      "flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/50"
                    )}
                    onClick={() => selectProject(p.id)}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md",
                          ProjectIcon
                            ? "bg-foreground/6"
                            : "font-heading text-[11px] font-bold text-white"
                        )}
                        style={
                          ProjectIcon ? { color: p.color } : { background: p.color }
                        }
                      >
                        {ProjectIcon ? (
                          <ProjectIcon className="size-3.5" />
                        ) : (
                          p.name.trim().charAt(0)
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        <span className="truncate text-sm font-medium">
                          {p.name}
                        </span>
                        {p.pinned && (
                          <Pin className="size-3 shrink-0 fill-current text-muted-foreground" />
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {s.total} 任务
                      </span>
                    </span>
                    {(p.tags?.length ?? 0) > 0 && (
                      <span className="flex flex-wrap items-center gap-1 leading-none">
                        {p.tags!.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-foreground/6 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            #{tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuGroup>
                    <ContextMenuItem onClick={() => togglePinProject(p.id)}>
                      {p.pinned ? <PinOff /> : <Pin />}
                      {p.pinned ? "取消置顶" : "置顶"}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        setEditing(p);
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil />
                      编辑项目
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        duplicateProject(p.id);
                        toast.success("已复制项目（含任务与依赖）");
                      }}
                    >
                      <CopyPlus />
                      复制项目
                    </ContextMenuItem>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    <ContextMenuItem
                      onClick={() => {
                        selectProject(p.id);
                        setAiDialog({ type: "plan", projectId: p.id });
                      }}
                    >
                      <Sparkles />
                      AI 规划任务
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        selectProject(p.id);
                        setAiDialog({ type: "suggestDeps", projectId: p.id });
                      }}
                    >
                      <ListPlus />
                      AI 依赖建议
                    </ContextMenuItem>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    <ContextMenuItem
                      onClick={() => {
                        toggleArchiveProject(p.id);
                        toast(`已归档「${p.name}」`);
                      }}
                    >
                      <Archive />
                      归档项目
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 />
                      删除项目
                    </ContextMenuItem>
                  </ContextMenuGroup>
                </ContextMenuContent>
              </ContextMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1.5 right-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent data-[state=open]:opacity-100"
                    aria-label="项目操作"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => togglePinProject(p.id)}>
                      {p.pinned ? <PinOff /> : <Pin />}
                      {p.pinned ? "取消置顶" : "置顶"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setEditing(p);
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil />
                      编辑项目
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        duplicateProject(p.id);
                        toast.success("已复制项目（含任务与依赖）");
                      }}
                    >
                      <CopyPlus />
                      复制项目
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        selectProject(p.id);
                        setAiDialog({ type: "plan", projectId: p.id });
                      }}
                    >
                      <Sparkles />
                      AI 规划任务
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        toggleArchiveProject(p.id);
                        toast(`已归档「${p.name}」`);
                      }}
                    >
                      <Archive />
                      归档项目
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 />
                      删除项目
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}

        {archivedList.length > 0 && (
          <li className="mt-2">
            <button
              className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] tracking-wide text-muted-foreground hover:text-foreground"
              onClick={() => setArchivedOpen((v) => !v)}
            >
              {archivedOpen ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              已归档
              <span className="tabular-nums">{archivedList.length}</span>
            </button>
            {archivedOpen && (
              <ul>
                {archivedList.map((p) => (
                  <li key={p.id}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-sidebar-accent/50"
                          onClick={() => selectProject(p.id)}
                        >
                          <span
                            className="size-2 shrink-0 rounded-full opacity-50"
                            style={{ background: p.color }}
                          />
                          <span className="truncate">{p.name}</span>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuGroup>
                          <ContextMenuItem
                            onClick={() => {
                              toggleArchiveProject(p.id);
                              toast(`已恢复「${p.name}」`);
                            }}
                          >
                            <ArchiveRestore />
                            取消归档
                          </ContextMenuItem>
                          <ContextMenuItem
                            variant="destructive"
                            onClick={() => setDeleting(p)}
                          >
                            <Trash2 />
                            删除项目
                          </ContextMenuItem>
                        </ContextMenuGroup>
                      </ContextMenuContent>
                    </ContextMenu>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>

      <footer className="border-t px-4 py-2 text-[11px] text-muted-foreground tabular-nums">
        {totals.tasks} 任务 · {totals.open} 待办
        {totals.blocked > 0 && (
          <span className="text-[var(--viz-blocked)]"> · {totals.blocked} 受阻</span>
        )}
      </footer>

      {editorOpen && (
        <ProjectEditorDialog
          key={editing?.id ?? "new"}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          project={editing}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              项目下的
              {deleting
                ? ` ${tasks.filter((t) => t.projectId === deleting.id).length} 个任务`
                : "所有任务"}
              将一并删除。删除后可通过提示中的「撤销」恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                const removed = deleteProject(deleting.id);
                if (!removed) return;
                toast(`已删除「${removed.project.name}」`, {
                  description:
                    removed.tasks.length > 0
                      ? `连同 ${removed.tasks.length} 个任务`
                      : undefined,
                  action: {
                    label: "撤销",
                    onClick: () => restoreProject(removed),
                  },
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </nav>
  );
}
