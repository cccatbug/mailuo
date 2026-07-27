import { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/useAppStore";
import { PRIORITY_LABEL } from "@/types";
import {
  aiBreakdownTask,
  aiPlanProject,
  aiSuggestDeps,
  applyDrafts,
  type DepSuggestion,
  type DraftTask,
} from "./actions";

function DraftList({
  drafts,
  checked,
  onToggle,
}: {
  drafts: DraftTask[];
  checked: Set<number>;
  onToggle: (i: number) => void;
}) {
  return (
    <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
      {drafts.map((d, i) => (
        <Label
          key={i}
          className={cn(
            "flex items-start gap-2.5 rounded-lg border bg-card p-2.5 font-normal",
            !checked.has(i) && "opacity-50"
          )}
        >
          <Checkbox
            checked={checked.has(i)}
            onCheckedChange={() => onToggle(i)}
            className="mt-0.5"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{d.title}</span>
              {d.priority && d.priority !== "normal" && (
                <Badge
                  variant={d.priority === "high" ? "default" : "secondary"}
                  className="h-4 px-1.5 text-[10px]"
                >
                  {PRIORITY_LABEL[d.priority]}
                </Badge>
              )}
              {(d.deps?.length ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground">
                  依赖 #{d.deps!.map((n) => n + 1).join(",#")}
                </span>
              )}
            </span>
            {d.notes && (
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {d.notes}
              </span>
            )}
          </span>
        </Label>
      ))}
    </div>
  );
}

function useDraftSelection(drafts: DraftTask[] | null) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => {
    setChecked(new Set(drafts?.map((_, i) => i) ?? []));
  }, [drafts]);
  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return { checked, toggle };
}

function PlanProjectDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const projects = useAppStore((s) => s.projects);
  const project = projects.find((p) => p.id === projectId);
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<DraftTask[] | null>(null);
  const { checked, toggle } = useDraftSelection(drafts);

  const generate = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    try {
      setDrafts(await aiPlanProject(projectId, goal));
    } catch (e) {
      toast.error("AI 规划失败", { description: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!drafts) return;
    const n = applyDrafts(projectId, drafts, [...checked]);
    toast.success(`已写入 ${n} 个任务`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI 规划项目「{project?.name}」
          </DialogTitle>
          <DialogDescription>
            描述目标，AI 会生成带依赖关系的任务草案，确认后写入项目。
          </DialogDescription>
        </DialogHeader>

        {!drafts ? (
          <Textarea
            autoFocus
            value={goal}
            placeholder="例如：三周内完成产品官网改版并上线"
            className="min-h-24"
            onChange={(e) => setGoal(e.target.value)}
          />
        ) : (
          <DraftList drafts={drafts} checked={checked} onToggle={toggle} />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          {!drafts ? (
            <Button onClick={generate} disabled={loading || !goal.trim()}>
              {loading && <Spinner data-icon="inline-start" />}
              {loading ? "规划中…" : "生成任务"}
            </Button>
          ) : (
            <Button onClick={apply} disabled={checked.size === 0}>
              写入 {checked.size} 个任务
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BreakdownDialog({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const tasks = useAppStore((s) => s.tasks);
  const task = tasks.find((t) => t.id === taskId);
  const [drafts, setDrafts] = useState<DraftTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { checked, toggle } = useDraftSelection(drafts);

  useEffect(() => {
    let cancelled = false;
    aiBreakdownTask(taskId)
      .then((d) => !cancelled && setDrafts(d))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const apply = () => {
    if (!drafts || !task) return;
    const n = applyDrafts(task.projectId, drafts, [...checked], task.id);
    toast.success(`已拆解为 ${n} 个前置子任务`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI 拆解「{task?.title}」
          </DialogTitle>
          <DialogDescription>
            生成的子任务将成为该任务的前置任务。
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !drafts ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner /> 正在拆解…
          </div>
        ) : (
          <DraftList drafts={drafts} checked={checked} onToggle={toggle} />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={apply} disabled={!drafts || checked.size === 0}>
            写入 {checked.size} 个子任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestDepsDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const tasks = useAppStore((s) => s.tasks);
  const addDep = useAppStore((s) => s.addDep);
  const list = tasks.filter((t) => t.projectId === projectId);
  const [suggestions, setSuggestions] = useState<DepSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    aiSuggestDeps(projectId)
      .then((s) => {
        if (cancelled) return;
        setSuggestions(s);
        setChecked(new Set(s.map((_, i) => i)));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const apply = () => {
    if (!suggestions) return;
    let n = 0;
    for (const i of checked) {
      const s = suggestions[i];
      const from = list[s.fromIdx];
      const to = list[s.toIdx];
      if (from && to && addDep(to.id, from.id) === "ok") n++;
    }
    toast.success(`已建立 ${n} 条依赖`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI 依赖建议
          </DialogTitle>
          <DialogDescription>
            AI 分析了当前项目的任务，找出可能缺失的前后置关系。
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !suggestions ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner /> 正在分析依赖…
          </div>
        ) : suggestions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            没有发现缺失的依赖，脉络已经很清晰了。
          </p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
            {suggestions.map((s, i) => (
              <Label
                key={i}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border bg-card p-2.5 font-normal",
                  !checked.has(i) && "opacity-50"
                )}
              >
                <Checkbox
                  checked={checked.has(i)}
                  onCheckedChange={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className="mt-0.5"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className="truncate font-medium">
                      {list[s.fromIdx]?.title}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">
                      {list[s.toIdx]?.title}
                    </span>
                  </span>
                  {s.reason && (
                    <span className="text-xs text-muted-foreground">
                      {s.reason}
                    </span>
                  )}
                </span>
              </Label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={apply}
            disabled={!suggestions || suggestions.length === 0 || checked.size === 0}
          >
            建立 {checked.size} 条依赖
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** AI 对话框协调器：根据 store 中的 aiDialog 状态渲染对应对话框 */
export function AiDialogs() {
  const aiDialog = useAppStore((s) => s.aiDialog);
  const setAiDialog = useAppStore((s) => s.setAiDialog);
  if (!aiDialog) return null;
  const close = () => setAiDialog(null);
  switch (aiDialog.type) {
    case "plan":
      return <PlanProjectDialog projectId={aiDialog.projectId} onClose={close} />;
    case "breakdown":
      return <BreakdownDialog taskId={aiDialog.taskId} onClose={close} />;
    case "suggestDeps":
      return (
        <SuggestDepsDialog projectId={aiDialog.projectId} onClose={close} />
      );
  }
}
