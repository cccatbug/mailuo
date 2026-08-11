import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { bridge } from "@/lib/bridge";
import { useAppStore } from "@/store/useAppStore";
import { useScheduledTasksStore } from "@/store/useScheduledTasksStore";
import type { AiModelRef, EnabledModelSummary } from "@/shared/ai-config";
import type { ScheduledJob, ScheduledTaskSchedule } from "@/shared/scheduled-tasks";

const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
const WEEKDAY_CHARS: Record<number, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
  7: "日",
};

function modelRefValue(ref: AiModelRef | null | undefined): string {
  return ref ? `${ref.providerId}/${ref.modelId}` : "default";
}

/** 新建 / 编辑定时任务弹窗 */
export function ScheduledTaskEditorDialog({
  open,
  onOpenChange,
  job,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新建 */
  job: ScheduledJob | null;
  defaultProjectId?: string | null;
}) {
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const save = useScheduledTasksStore((s) => s.save);

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<"daily" | "weekly">("daily");
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [prompt, setPrompt] = useState("");
  const [modelValue, setModelValue] = useState("default");
  const [models, setModels] = useState<EnabledModelSummary[]>([]);
  const [saving, setSaving] = useState(false);

  // 打开时用编辑对象或默认值重置表单，并拉取可选模型
  useEffect(() => {
    if (!open) return;
    setName(job?.name ?? "");
    setProjectId(job?.projectId ?? defaultProjectId ?? selectedProjectId ?? projects[0]?.id ?? "");
    setKind(job?.schedule.kind ?? "daily");
    setTime(job?.schedule.time ?? "09:00");
    setWeekdays(job?.schedule.kind === "weekly" ? [...job.schedule.weekdays] : [1]);
    setPrompt(job?.prompt ?? "");
    setModelValue(modelRefValue(job?.modelOverride));
    setSaving(false);
    if (bridge) {
      void bridge
        .listModels()
        .then(setModels)
        .catch(() => setModels([]));
    }
  }, [open, job, defaultProjectId, selectedProjectId, projects]);

  const valid = useMemo(() => {
    if (!name.trim()) return "请填写名称";
    if (!projectId) return "请选择所属项目";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "时间格式应为 HH:mm";
    if (kind === "weekly" && weekdays.length === 0) return "请至少选择一个星期";
    if (!prompt.trim()) return "提示词不能为空";
    return null;
  }, [name, projectId, time, kind, weekdays, prompt]);

  const toggleWeekday = (day: number) => {
    setWeekdays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b)
    );
  };

  const submit = async () => {
    if (valid || saving) return;
    const schedule: ScheduledTaskSchedule =
      kind === "daily" ? { kind, time } : { kind, time, weekdays };
    const modelOverride =
      modelValue === "default"
        ? null
        : (() => {
            const [providerId, ...rest] = modelValue.split("/");
            return { providerId, modelId: rest.join("/") };
          })();
    setSaving(true);
    try {
      await save({
        ...(job ? { id: job.id } : {}),
        projectId,
        name: name.trim(),
        prompt: prompt.trim(),
        schedule,
        enabled: job?.enabled ?? true,
        modelOverride,
      });
      toast.success(job ? "定时任务已更新" : `定时任务「${name.trim()}」已创建`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" />
            {job ? "编辑定时任务" : "新建定时任务"}
          </DialogTitle>
          <DialogDescription>
            到点后小枢将在所选项目的上下文中自动执行提示词，并生成报告。
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="scheduled-name">名称</FieldLabel>
            <Input
              id="scheduled-name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder="例如：每周进展汇总"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>所属项目</FieldLabel>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: p.color }}
                        />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>模型</FieldLabel>
              <Select value={modelValue} onValueChange={setModelValue}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="跟随路由配置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">跟随「定时任务」路由</SelectItem>
                  {models.map((m) => (
                    <SelectItem
                      key={`${m.providerId}/${m.modelId}`}
                      value={`${m.providerId}/${m.modelId}`}
                    >
                      {m.name}
                      <span className="ml-1 text-muted-foreground">
                        · {m.providerName}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel>执行时间</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={kind}
                onValueChange={(v) => v && setKind(v as "daily" | "weekly")}
              >
                <ToggleGroupItem value="daily">每天</ToggleGroupItem>
                <ToggleGroupItem value="weekly">每周</ToggleGroupItem>
              </ToggleGroup>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-8 w-28 tabular-nums"
                aria-label="执行时间"
              />
              {kind === "weekly" && (
                <div className="flex items-center gap-1">
                  {WEEKDAY_OPTIONS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={weekdays.includes(day)}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full border text-xs transition-colors",
                        weekdays.includes(day)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                      onClick={() => toggleWeekday(day)}
                    >
                      {WEEKDAY_CHARS[day]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="scheduled-prompt">提示词</FieldLabel>
            <Textarea
              id="scheduled-prompt"
              rows={6}
              value={prompt}
              maxLength={8000}
              placeholder={"例如：汇总本项目本周完成与进行中的任务，指出风险与下周重点，写成一份简短周报。"}
              onChange={(e) => setPrompt(e.target.value)}
              className="resize-y"
            />
          </Field>
        </FieldGroup>

        <DialogFooter className="gap-2 sm:gap-2">
          {valid && (
            <span className="mr-auto text-xs text-muted-foreground">{valid}</span>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={Boolean(valid) || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {job ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
