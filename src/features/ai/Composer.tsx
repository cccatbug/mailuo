import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import {
  AtSign,
  Check,
  ChevronDown,
  Cpu,
  FileImage,
  FileText,
  Paperclip,
  PlugZap,
  Send,
  Settings2,
  SlashSquare,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bridge } from "@/lib/bridge";
import { runAgent } from "@/lib/ai";
import { useAppStore } from "@/store/useAppStore";
import type { Task } from "@/types";
import type { AssistantContextUsage } from "@/shared/assistant";
import {
  prepareBrowserAttachments,
  releaseAttachment,
  type ComposerAttachment,
} from "./attachments";
import { getSkills, type SkillInfo } from "./skills";

/* ---------- 内置快捷指令（/） ---------- */

export interface SlashSkill {
  name: string;
  hint: string;
  template: string;
}

export const SLASH_SKILLS: SlashSkill[] = [
  { name: "看板", hint: "生成项目执行看板", template: "给我一个这个项目的执行看板，用结构化界面呈现。" },
  { name: "规划", hint: "从目标规划任务", template: "请基于以下目标为本项目规划任务与依赖关系：" },
  { name: "拆解", hint: "拆解某个任务", template: "请把「」拆解为可执行的子步骤，并给出先后依赖。" },
  { name: "周报", hint: "生成进展周报", template: "根据任务快照，用 markdown 写一份本项目的进展周报（已完成 / 进行中 / 受阻与风险 / 下一步）。" },
  { name: "风险", hint: "分析瓶颈与关键路径", template: "分析当前项目的关键路径与风险：哪些受阻任务影响面最大？先解决什么收益最高？" },
  {
    name: "图表",
    hint: "生成项目可视化分析",
    template:
      "基于当前任务快照做一次可视化分析：选择最合适的图表展示进度、构成或风险，并先指出最值得关注的结论。",
  },
];

interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function ContextUsageRing({ usage }: { usage?: AssistantContextUsage }) {
  const percent = Math.max(0, Math.min(100, usage?.percent ?? 0));
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent / 100);
  const color =
    percent >= 90
      ? "var(--viz-blocked)"
      : percent >= 70
        ? "var(--viz-doing)"
        : "var(--chart-1)";
  const label =
    usage?.tokens === null || usage === undefined
      ? "上下文用量将在首次回复后显示"
      : `上下文 ${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens（${Math.round(percent)}%）`;

  return (
    <div
      role="status"
      aria-label={label}
      title={label}
      className="relative flex size-7 items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2.5"
        />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="absolute text-[7px] font-medium tabular-nums text-muted-foreground">
        {usage?.percent === null || usage === undefined
          ? "—"
          : Math.round(percent)}
      </span>
    </div>
  );
}

/** 现代 agent 式输入区：@任务引用、/快捷指令、模型选择、测试连接 */
export function Composer({
  tasks,
  busy,
  contextUsage,
  onSend,
}: {
  tasks: Task[];
  busy: boolean;
  contextUsage?: AssistantContextUsage;
  onSend: (
    text: string,
    mentionedIds: string[],
    skillNames: string[],
    attachments: ComposerAttachment[]
  ) => Promise<boolean>;
}) {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const [input, setInput] = useState("");
  const [mentions, setMentions] = useState<Task[]>([]);
  const [menu, setMenu] = useState<"none" | "mention" | "slash" | "skill">("none");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [usedSkills, setUsedSkills] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [testing, setTesting] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const attachmentQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAttachmentJobsRef = useRef(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => attachmentsRef.current.forEach(releaseAttachment),
    []
  );

  /* 自适应高度 */
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  }, [input]);

  const detectMenu = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (at) {
      setMenu("mention");
      setQuery(at[1]);
      setHighlight(0);
      return;
    }
    const slash = /^\/([^\s/]*)$/.exec(before);
    if (slash) {
      setMenu("slash");
      setQuery(slash[1]);
      setHighlight(0);
      return;
    }
    const dollar = /(?:^|\s)\$([^\s$]*)$/.exec(before);
    if (dollar) {
      setMenu("skill");
      setQuery(dollar[1]);
      setHighlight(0);
      void getSkills().then(setSkills);
      return;
    }
    setMenu("none");
  };

  const mentionCandidates = tasks
    .filter((t) => !mentions.some((m) => m.id === t.id))
    .filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);
  const slashCandidates = SLASH_SKILLS.filter((s) =>
    s.name.includes(query)
  );
  const skillCandidates = skills
    .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  const applyMention = (task: Task) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? input.length;
    const before = input.slice(0, caret).replace(/@([^\s@]*)$/, "");
    setInput(`${before}@${task.title} ${input.slice(caret)}`);
    setMentions((prev) => [...prev, task]);
    setMenu("none");
    ta?.focus();
  };

  const applySlash = (skill: SlashSkill) => {
    setInput(skill.template);
    setMenu("none");
    taRef.current?.focus();
  };

  const applySkill = (skill: SkillInfo) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? input.length;
    const before = input.slice(0, caret).replace(/\$([^\s$]*)$/, "");
    setInput(`${before}$${skill.name} ${input.slice(caret)}`);
    setUsedSkills((prev) =>
      prev.includes(skill.name) ? prev : [...prev, skill.name]
    );
    setMenu("none");
    ta?.focus();
  };

  const addFiles = (files: Iterable<File>): Promise<void> => {
    const incoming = [...files];
    if (incoming.length === 0) return Promise.resolve();

    pendingAttachmentJobsRef.current++;
    setPreparingAttachments(true);
    const run = attachmentQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const result = await prepareBrowserAttachments(
            incoming,
            attachmentsRef.current
          );
          if (result.accepted.length > 0) {
            const next = [...attachmentsRef.current, ...result.accepted];
            attachmentsRef.current = next;
            setAttachments(next);
          }
          if (result.errors.length > 0) {
            toast.error("部分附件未添加", {
              description: result.errors.join("；"),
            });
          }
        } catch (error) {
          toast.error("附件读取失败", { description: String(error) });
        }
      })
      .finally(() => {
        pendingAttachmentJobsRef.current = Math.max(
          0,
          pendingAttachmentJobsRef.current - 1
        );
        if (pendingAttachmentJobsRef.current === 0) {
          setPreparingAttachments(false);
        }
      });
    attachmentQueueRef.current = run;
    return run;
  };

  const removeAttachment = (id: string) => {
    const target = attachmentsRef.current.find((item) => item.id === id);
    if (target) releaseAttachment(target);
    const next = attachmentsRef.current.filter((item) => item.id !== id);
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith("image/")
    );
    if (images.length === 0) return;
    event.preventDefault();
    void addFiles(images);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current++;
    setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dragActive) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files);
    }
  };

  const send = async () => {
    if (busy || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    const queuedBeforeSend = attachmentQueueRef.current;
    try {
      await queuedBeforeSend;
      const text = input.trim();
      const sendingAttachments = [...attachmentsRef.current];
      if (!text && sendingAttachments.length === 0) return;
      const sent = await onSend(
        text,
        mentions.filter((m) => input.includes(`@${m.title}`)).map((m) => m.id),
        usedSkills.filter((n) => input.includes(`$${n}`)),
        sendingAttachments
      );
      if (!sent) return;
      const sentIds = new Set(sendingAttachments.map((item) => item.id));
      sendingAttachments.forEach(releaseAttachment);
      const remaining = attachmentsRef.current.filter(
        (item) => !sentIds.has(item.id)
      );
      attachmentsRef.current = remaining;
      setInput("");
      setMentions([]);
      setUsedSkills([]);
      setAttachments(remaining);
      setMenu("none");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const loadModels = async () => {
    if (models !== null || !bridge) return;
    try {
      setModels(await bridge.listModels());
    } catch (e) {
      toast.error("获取模型列表失败", { description: String(e) });
      setModels([]);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const reply = await runAgent({
        system: "你是连通性测试助手。",
        prompt: "只回复两个字符：OK",
      });
      toast.success("连接正常", { description: `回复：${reply.slice(0, 30)}` });
    } catch (e) {
      toast.error("连接失败", { description: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const currentModelLabel = settings.model
    ? settings.model.split("/").pop()
    : "pi 默认";

  const menuItems =
    menu === "mention"
      ? mentionCandidates
      : menu === "slash"
        ? slashCandidates
        : menu === "skill"
          ? skillCandidates
          : [];

  return (
    <div
      className="relative border-t p-3"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) void addFiles(files);
        }}
      />

      {dragActive && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/95 text-sm font-medium text-primary shadow-sm">
          <Upload className="size-4" />
          松开以添加附件
        </div>
      )}

      {mentions.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <Badge key={m.id} variant="secondary" className="gap-1 pr-1 text-[11px]">
              @{m.title}
              <button
                aria-label="移除引用"
                className="rounded-full p-0.5 hover:bg-foreground/10"
                onClick={() => {
                  setMentions((prev) => prev.filter((x) => x.id !== m.id));
                  setInput((v) => v.replace(`@${m.title}`, "").replace(/\s{2,}/g, " "));
                }}
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {preparingAttachments && (
        <div
          role="status"
          className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <Spinner className="size-3" />
          正在读取附件，发送会自动等待
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex max-w-48 shrink-0 items-center gap-2 rounded-lg border bg-card px-2 py-1.5"
            >
              {attachment.previewUrl ? (
                <img
                  src={attachment.previewUrl}
                  alt=""
                  className="size-8 rounded-md border object-cover"
                />
              ) : attachment.kind === "image" ? (
                <FileImage className="size-4 shrink-0 text-primary" />
              ) : (
                <FileText className="size-4 shrink-0 text-primary" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium">
                  {attachment.name}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {formatBytes(attachment.size)}
                </span>
              </span>
              <button
                type="button"
                aria-label={`移除附件 ${attachment.name}`}
                className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => removeAttachment(attachment.id)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative rounded-xl border bg-card focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/40">
        {menu !== "none" && menuItems.length > 0 && (
          <div className="absolute bottom-full left-0 z-20 mb-1.5 w-72 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
            <p className="px-2 py-1 text-[10px] tracking-wider text-muted-foreground">
              {menu === "mention"
                ? "引用任务（↑↓ 选择，⏎ 确认）"
                : menu === "skill"
                  ? "引用 skill（~/.pi/agent/skills）"
                  : "快捷指令"}
            </p>
            {menu === "mention"
              ? mentionCandidates.map((t, i) => (
                  <button
                    key={t.id}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      i === highlight ? "bg-accent" : "hover:bg-accent/60"
                    )}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => applyMention(t)}
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
                  </button>
                ))
              : menu === "skill"
                ? skillCandidates.map((s, i) => (
                    <button
                      key={s.name}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                        i === highlight ? "bg-accent" : "hover:bg-accent/60"
                      )}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => applySkill(s)}
                    >
                      <span className="font-mono font-medium text-primary">
                        ${s.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {s.description}
                      </span>
                    </button>
                  ))
                : slashCandidates.map((s, i) => (
                  <button
                    key={s.name}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      i === highlight ? "bg-accent" : "hover:bg-accent/60"
                    )}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => applySlash(s)}
                  >
                    <span className="font-medium">/{s.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {s.hint}
                    </span>
                  </button>
                ))}
          </div>
        )}

        <textarea
          ref={taRef}
          value={input}
          placeholder="对小枢说点什么… 可粘贴图片、拖入文件"
          rows={1}
          disabled={submitting}
          className="max-h-33 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setInput(e.target.value);
            detectMenu(e.target.value, e.target.selectionStart ?? 0);
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (menu !== "none" && menuItems.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % menuItems.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + menuItems.length) % menuItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (menu === "mention") applyMention(mentionCandidates[highlight]);
                else if (menu === "skill") applySkill(skillCandidates[highlight]);
                else applySlash(slashCandidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                setMenu("none");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />

        <div className="flex items-center gap-0.5 px-2 pb-2">
          <DropdownMenu onOpenChange={(open) => open && void loadModels()}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6.5 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Cpu className="size-3.5" />
                {currentModelLabel}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <div className="p-1" onKeyDown={(e) => e.stopPropagation()}>
                <input
                  value={modelQuery}
                  placeholder="搜索模型…"
                  className="w-full rounded-md border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary/50"
                  onChange={(e) => setModelQuery(e.target.value)}
                />
              </div>
              <div className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">模型</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => setSettings({ provider: "", model: "" })}
                >
                  {!settings.model && <Check className="size-3.5" />}
                  <span className={cn(!settings.model && "font-medium")}>
                    pi 默认模型
                  </span>
                </DropdownMenuItem>
                {models === null ? (
                  <DropdownMenuItem disabled>
                    <Spinner className="size-3.5" /> 加载中…
                  </DropdownMenuItem>
                ) : (
                  models
                    .filter((m) =>
                      `${m.provider}/${m.id} ${m.name}`
                        .toLowerCase()
                        .includes(modelQuery.toLowerCase())
                    )
                    .slice(0, 60)
                    .map((m) => {
                    const full = `${m.provider}/${m.id}`;
                    const selected =
                      settings.model === full || settings.model === m.id;
                    return (
                      <DropdownMenuItem
                        key={full}
                        onClick={() =>
                          setSettings({ provider: m.provider, model: full })
                        }
                      >
                        {selected && <Check className="size-3.5" />}
                        <span className={cn("truncate", selected && "font-medium")}>
                          {m.name}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {m.provider}
                        </span>
                      </DropdownMenuItem>
                    );
                    })
                )}
              </DropdownMenuGroup>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => void testConnection()}>
                  {testing ? <Spinner className="size-3.5" /> : <PlugZap />}
                  测试连接
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  <Settings2 />
                  AI 设置…
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="引用任务"
            className="size-6.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setInput((v) => `${v}@`);
              setMenu("mention");
              setQuery("");
              taRef.current?.focus();
            }}
          >
            <AtSign className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="快捷指令"
            className="size-6.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setInput("/");
              setMenu("slash");
              setQuery("");
              taRef.current?.focus();
            }}
          >
            <SlashSquare className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="添加附件"
            title="添加附件，也可粘贴图片或拖入文件"
            className="size-6.5 text-muted-foreground hover:text-foreground"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="size-3.5" />
          </Button>

          <div className="flex-1" />

          <ContextUsageRing usage={contextUsage} />
          <Button
            size="icon-sm"
            aria-label="发送"
            className="size-7 rounded-lg"
            disabled={
              busy ||
              submitting ||
              (!input.trim() &&
                attachments.length === 0 &&
                !preparingAttachments)
            }
            onClick={() => void send()}
          >
            {busy || submitting ? (
              <Spinner className="size-3.5" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
