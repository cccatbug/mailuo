import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, RefreshCw, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { bridge } from "@/lib/bridge";
import { useAppStore } from "@/store/useAppStore";
import type {
  MemoryEntry,
  MemoryKind,
  MemoryScope,
  MemorySnapshot,
} from "@/shared/memory";

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: "用户事实",
  preference: "稳定偏好",
  project: "项目记忆",
  inference: "推断画像",
  unclassified: "待整理",
};

function EntryEditor({
  entry,
  currentProjectId,
  onChanged,
}: {
  entry: MemoryEntry;
  currentProjectId: string | null;
  onChanged: () => Promise<void>;
}) {
  const [content, setContent] = useState(entry.content);
  const [kind, setKind] = useState<MemoryKind>(entry.kind);
  const [scopeType, setScopeType] = useState<MemoryScope["type"]>(entry.scope.type);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setContent(entry.content);
    setKind(entry.kind);
    setScopeType(entry.scope.type);
  }, [entry.id, entry.content, entry.kind, entry.scope.type]);

  const save = async () => {
    if (!bridge) return;
    const projectId =
      scopeType === "project"
        ? entry.scope.type === "project"
          ? entry.scope.projectId
          : currentProjectId
        : null;
    if (scopeType === "project" && !projectId) {
      setError("请先选择一个项目，再把记忆设为项目范围。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await bridge.updateMemory(entry.id, {
        content,
        kind,
        scope:
          scopeType === "global"
            ? { type: "global" }
            : { type: "project", projectId: projectId! },
      });
      await onChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  const lastEvidence = entry.evidence[entry.evidence.length - 1];
  return (
    <article className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={kind === "inference" ? "outline" : "secondary"}>
          {KIND_LABEL[kind]}
        </Badge>
        <Badge variant="outline">
          {scopeType === "global" ? "全局" : "当前项目"}
        </Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">
          置信度 {Math.round(entry.confidence * 100)}% · 强化 {entry.reinforcementCount} 次
        </span>
      </div>

      <Textarea
        value={content}
        className="min-h-20 resize-y"
        onChange={(event) => setContent(event.target.value)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={(value) => setKind(value as MemoryKind)}>
          <SelectTrigger size="sm" className="w-28" aria-label="记忆类型">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={scopeType}
          onValueChange={(value) => setScopeType(value as MemoryScope["type"])}
        >
          <SelectTrigger size="sm" className="w-24" aria-label="记忆范围">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">全局</SelectItem>
            <SelectItem value="project">项目</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" disabled={saving || !content.trim()} onClick={() => void save()}>
          <Save />{saving ? "保存中" : "保存"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="ml-auto text-destructive">
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
              <AlertDialogDescription>
                这会从本机结构化记忆中永久移除该条目，无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  void bridge?.deleteMemory(entry.id)
                    .then(onChanged)
                    .catch((reason) => setError(String(reason)));
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {lastEvidence && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          证据：{lastEvidence.excerpt}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </article>
  );
}

export function MemorySettingsPane() {
  const currentProjectId = useAppStore((state) => state.selectedProjectId);
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [filter, setFilter] = useState<"all" | MemoryKind>("all");
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!bridge) return;
    try {
      setSnapshot(await bridge.getMemory());
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const entries = useMemo(
    () =>
      (snapshot?.entries ?? [])
        .filter((entry) => entry.status === "active")
        .filter((entry) => filter === "all" || entry.kind === filter)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [filter, snapshot]
  );

  if (loading && !snapshot) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在读取记忆…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-6 rounded-lg border p-3">
        <div>
          <h3 className="text-sm font-medium">自动记忆</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            每轮对话后异步学习。事实、偏好、项目记忆和推断严格分开；关闭后保留已有数据，但不再提取或注入。
          </p>
        </div>
        <Checkbox
          checked={snapshot?.enabled ?? true}
          onCheckedChange={(checked) => {
            void bridge?.setMemoryEnabled(checked === true)
              .then(setSnapshot)
              .catch((reason) => setError(String(reason)));
          }}
        />
      </div>

      {snapshot?.profileSummary && (
        <div className="rounded-lg border bg-muted/25 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium">
            <BrainCircuit className="size-3.5" /> 当前用户画像
          </p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {snapshot.profileSummary}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter}
          onValueChange={(value) => setFilter(value as typeof filter)}
        >
          <SelectTrigger size="sm" className="w-32" aria-label="记忆筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {entries.length} 条有效记忆
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={rebuilding}
          onClick={() => {
            setRebuilding(true);
            void bridge?.rebuildMemory()
              .then(setSnapshot)
              .catch((reason) => setError(String(reason)))
              .finally(() => setRebuilding(false));
          }}
        >
          <RefreshCw className={rebuilding ? "animate-spin" : ""} />
          {rebuilding ? "重建中" : "重新整理画像"}
        </Button>
      </div>

      {(error || snapshot?.lastError) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {error || `最近一次自动学习失败：${snapshot?.lastError}`}
        </div>
      )}

      <div className="space-y-2">
        {entries.map((entry) => (
          <EntryEditor
            key={entry.id}
            entry={entry}
            currentProjectId={currentProjectId}
            onChanged={refresh}
          />
        ))}
        {entries.length === 0 && (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            还没有符合筛选条件的记忆。继续与小枢交流，它会逐步了解你。
          </div>
        )}
      </div>
    </div>
  );
}
