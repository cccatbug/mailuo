import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import {
  AlertCircle,
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleCheck,
  FileImage,
  FileText,
  Terminal,
  Settings2,
  Wrench,
  X,
  Globe2,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { assistantReset, assistantSend } from "@/lib/ai";
import {
  bridge,
  type AssistantAttachmentMeta,
  type AssistantContextUsage,
  type AssistantEventPayload,
} from "@/lib/bridge";
import { useAppStore } from "@/store/useAppStore";
import { openFilePanel } from "@/components/DockLayout";
import {
  applyAssistantOps,
  parseAssistantReply,
  projectContext,
  type AssistantOp,
} from "./actions";
import { AiChart, type ChartSpec } from "./AiChart";
import { UiBlock, type UiSpec } from "./uiCatalog";
import { Composer } from "./Composer";
import {
  attachmentMeta,
  attachmentPayload,
  type ComposerAttachment,
} from "./attachments";
import { Md } from "./Markdown";
import type { AiModelRef } from "@/shared/ai-config";
import type { RouteResolutionStatus } from "@/shared/ai-config";
import type { AssetRecord, AssetReference } from "@/shared/assets";
import { openAsset } from "@/features/files/AssetPanel";
import type {
  AssistantMention,
  BrowserApprovalRequest,
  BrowserTabMention,
} from "@/shared/browser";
import { mentionKey, mentionLabel } from "./mentions";

/* ---------- 消息模型：分段时间线（文本 / 思考 / 工具） ---------- */

export type MsgPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: string;
      status: "run" | "ok" | "err";
      output: string;
      file?: string;
    };

export interface Message {
  role: "user" | "assistant";
  content: string; // user 原文；assistant 为完整原始文本（含协议块）
  parts?: MsgPart[];
  streaming?: boolean;
  ops?: AssistantOp[];
  opsApplied?: boolean;
  charts?: ChartSpec[];
  uiSpecs?: UiSpec[];
  files?: string[];
  attachments?: AssistantAttachmentMeta[];
  assets?: AssetReference[];
  mentions?: AssistantMention[];
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  modelOverride?: AiModelRef;
}

/* ---------- 会话历史（localStorage 持久化） ---------- */

const CHATS_KEY = "mailuo-chats-v1";

function loadChats(): Conversation[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

interface ChatStore {
  conversations: Conversation[];
  currentId: string | null;
  busy: boolean;
  contextUsage?: AssistantContextUsage;
  /** pi 会话与 UI 历史脱节（切换过会话/重启后），下次发送需附带上下文摘录 */
  stale: boolean;
  set: (p: Partial<ChatStore>) => void;
}

export const useChat = create<ChatStore>((set) => ({
  conversations: loadChats(),
  currentId: null,
  busy: false,
  contextUsage: undefined,
  stale: false,
  set,
}));

function persistChats() {
  const { conversations } = useChat.getState();
  localStorage.setItem(
    CHATS_KEY,
    // 只留最近 60 条会话，单会话消息裁到 60
    JSON.stringify(
      [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 60)
        .map((c) => ({ ...c, messages: c.messages.slice(-60) }))
    )
  );
}

function currentConversation(): Conversation | null {
  const { conversations, currentId } = useChat.getState();
  return conversations.find((c) => c.id === currentId) ?? null;
}

function updateCurrent(mutate: (c: Conversation) => Conversation) {
  const { conversations, currentId, set } = useChat.getState();
  set({
    conversations: conversations.map((c) =>
      c.id === currentId ? { ...mutate(c), updatedAt: Date.now() } : c
    ),
  });
}

function ensureConversation(projectId: string): Conversation {
  const existing = currentConversation();
  if (existing && existing.projectId === projectId) return existing;
  const conv: Conversation = {
    id: crypto.randomUUID(),
    projectId,
    title: "新对话",
    updatedAt: Date.now(),
    messages: [],
  };
  const { conversations, set } = useChat.getState();
  set({
    conversations: [conv, ...conversations],
    currentId: conv.id,
    contextUsage: undefined,
    stale: false,
  });
  return conv;
}

/** 新对话（供组头按钮调用） */
export function resetShuConversation() {
  useChat
    .getState()
    .set({ currentId: null, contextUsage: undefined, stale: false });
  void assistantReset();
  toast("已开启新对话");
}

/** 切换到历史会话 */
export function switchConversation(id: string) {
  useChat
    .getState()
    .set({ currentId: id, contextUsage: undefined, stale: true });
  void assistantReset();
}

export function deleteConversation(id: string) {
  const { conversations, currentId, set } = useChat.getState();
  set({
    conversations: conversations.filter((c) => c.id !== id),
    currentId: currentId === id ? null : currentId,
    ...(currentId === id ? { contextUsage: undefined } : {}),
  });
  persistChats();
}

/** 打开长期记忆文件（不存在则先建） */
export async function openMemoryFile() {
  const p = await bridge?.memoryPath();
  if (!p) return;
  try {
    await bridge!.readFile(p);
  } catch {
    await bridge!.writeFile(p, "# 小枢的长期记忆\n\n");
  }
  openFilePanel(p);
}

/* ---------- 发送 ---------- */

function conversationExcerpt(conv: Conversation): string {
  const recentMessages = conv.messages
    .slice(-8)
    .map((message) => {
      const attachmentRefs = (message.attachments ?? [])
        .map((attachment) =>
          attachment.path
            ? `${attachment.name}（${attachment.path.replace(/^.*[/\\\\]workspace[/\\\\][^/\\\\]+[/\\\\]?/, "")}）`
            : attachment.name
        )
        .join("、");
      const body = message.content.slice(0, 400);
      return `${message.role === "user" ? "用户" : "小枢"}：${
        body || "（无文字）"
      }${attachmentRefs ? `\n附件：${attachmentRefs}` : ""}`;
    })
    .join("\n");
  const attachmentIndex = [
    ...new Map(
      conv.messages
        .flatMap((message) => message.attachments ?? [])
        .filter(
          (attachment): attachment is AssistantAttachmentMeta & { path: string } =>
            Boolean(attachment.path)
        )
        .map((attachment) => [attachment.id, attachment])
    ).values(),
  ]
    .slice(-20)
    .map(
      (attachment) =>
        `- ${attachment.name}（${attachment.mimeType}）：${attachment.path.replace(/^.*[/\\\\]workspace[/\\\\][^/\\\\]+[/\\\\]?/, "")}`
    )
    .join("\n");
  return `${recentMessages}${
    attachmentIndex ? `\n\n历史附件索引：\n${attachmentIndex}` : ""
  }`;
}

async function sendMessage(
  text: string,
  mentions: AssistantMention[],
  skillNames: string[],
  attachments: ComposerAttachment[],
  assetRefs: AssetRecord[]
): Promise<boolean> {
  const store = useAppStore.getState();
  const projectId = store.selectedProjectId;
  if (!projectId) return false;
  if (useChat.getState().busy) return false;

  const conv = ensureConversation(projectId);
  const modelOverride = conv.modelOverride;
  const wasStale = useChat.getState().stale;
  const agentText =
    text.trim() || "请查看本轮附件，并结合当前项目给出分析或完成请求。";

  const projectTasks = store.tasks.filter((t) => t.projectId === projectId);
  const mentionedTaskIds = new Set(
    mentions
      .filter((mention) => mention.kind === "task")
      .map((mention) => mention.taskId)
  );
  const mentioned = projectTasks.filter((t) => mentionedTaskIds.has(t.id));
  const browserTabs = mentions.filter(
    (mention): mention is BrowserTabMention =>
      mention.kind === "browser-tab"
  );
  const mentionContext = mentioned.length
    ? `\n\n【用户 @ 引用的任务详情】\n${mentioned
        .map(
          (t) =>
            `「${t.title}」 状态:${t.status} 优先级:${t.priority}${
              t.dueDate ? ` 期限:${t.dueDate}` : ""
            }${t.notes ? `\n备注:${t.notes}` : ""}`
        )
        .join("\n")}`
    : "";

  const staleContext =
    wasStale && conv.messages.length
      ? `\n\n【此前对话摘录（会话已重启，供衔接）】\n${conversationExcerpt(conv)}`
      : "";
  const attachmentPayloads = attachments.map(attachmentPayload);
  const resolvedAssets = await Promise.all(
    assetRefs.map(async (asset) => {
      const resolved = await bridge?.resolveAsset(projectId, asset.id);
      return resolved
        ? {
            ref: {
              assetId: asset.id,
              name: asset.name,
              relativePath: asset.relativePath,
              mimeType: asset.mimeType,
              size: asset.size,
            } satisfies AssetReference,
            absolutePath: resolved.absolutePath,
          }
        : null;
    })
  );
  const validAssets = resolvedAssets.filter((item): item is NonNullable<typeof item> => Boolean(item));
  const assetContext = validAssets.length
    ? `\n\n【用户 # 引用的项目资产】\n${validAssets
        .map((item) => `- ${item.ref.name}（${item.ref.mimeType}）：${item.absolutePath}`)
        .join("\n")}\n请按需使用 read/bash 读取这些文件。`
    : "";

  updateCurrent((c) => ({
    ...c,
    title:
      c.messages.length === 0
        ? (text.trim() || attachments.map((item) => item.name).join("、")).slice(
            0,
            24
          )
        : c.title,
    messages: [
      ...c.messages,
      {
        role: "user",
        content: text,
        attachments: attachments.map(attachmentMeta),
        assets: validAssets.map((item) => item.ref),
        mentions,
      },
      { role: "assistant", content: "", parts: [], streaming: true },
    ],
  }));
  useChat.getState().set({ busy: true, stale: false });
  persistChats();
  void completeAssistantTurn({
    agentText,
    attachmentPayloads,
    mentionContext: `${mentionContext}${assetContext}`,
    browserTabs,
    projectId,
    skillNames,
    staleContext,
    modelOverride,
  });
  return true;
}

async function completeAssistantTurn({
  agentText,
  attachmentPayloads,
  mentionContext,
  projectId,
  skillNames,
  staleContext,
  modelOverride,
  browserTabs,
}: {
  agentText: string;
  attachmentPayloads: ReturnType<typeof attachmentPayload>[];
  mentionContext: string;
  projectId: string;
  skillNames: string[];
  staleContext: string;
  modelOverride?: AiModelRef;
  browserTabs: BrowserTabMention[];
}): Promise<void> {
  let fullText = "";
  let segText = "";

  const patchLast = (fn: (m: Message) => Message) => {
    updateCurrent((c) => {
      const msgs = [...c.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") msgs[msgs.length - 1] = fn(last);
      return { ...c, messages: msgs };
    });
  };
  const patchLatestUserAttachments = (
    stored: AssistantAttachmentMeta[]
  ) => {
    updateCurrent((c) => {
      const messages = [...c.messages];
      for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role !== "user") continue;
        messages[index] = { ...messages[index], attachments: stored };
        break;
      }
      return { ...c, messages };
    });
    persistChats();
  };

  const onEvent = (e: AssistantEventPayload) => {
    if (e.type === "attachments") {
      patchLatestUserAttachments(e.attachments);
    } else if (e.type === "delta" && e.text) {
      fullText += e.text;
      segText += e.text;
      const visible = segText
        .replace(/```mailuo-(actions|chart|ui)[\s\S]*?(```|$)/g, "")
        .trimStart();
      patchLast((m) => {
        const parts = [...(m.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last?.kind === "text") {
          parts[parts.length - 1] = { kind: "text", text: visible };
        } else {
          parts.push({ kind: "text", text: visible });
        }
        return { ...m, parts };
      });
    } else if (e.type === "thinking" && e.text) {
      segText = "";
      patchLast((m) => {
        const parts = [...(m.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last?.kind === "thinking") {
          parts[parts.length - 1] = {
            kind: "thinking",
            text: last.text + (e.text ?? ""),
          };
        } else {
          parts.push({ kind: "thinking", text: e.text ?? "" });
        }
        return { ...m, parts };
      });
    } else if (e.type === "tool_start") {
      segText = "";
      patchLast((m) => ({
        ...m,
        parts: [
          ...(m.parts ?? []),
          {
            kind: "tool",
            id: e.id ?? "",
            name: e.name ?? "tool",
            args: e.args ?? "",
            status: "run",
            output: "",
            file: e.file,
          },
        ],
      }));
    } else if (e.type === "tool_end") {
      patchLast((m) => ({
        ...m,
        parts: (m.parts ?? []).map((p) =>
          p.kind === "tool" && p.id === e.id
            ? { ...p, status: e.ok ? "ok" : "err", output: e.output ?? "" }
            : p
        ),
        files: extractFiles(m, e),
      }));
    } else if (e.type === "context") {
      useChat.getState().set({ contextUsage: e.usage });
    }
  };

  try {
    await assistantSend(
      agentText,
      projectId,
      attachmentPayloads,
      {
        projectSnapshot: projectContext(projectId),
        taskDetails: mentionContext,
        conversationHistory: staleContext,
        skillNames,
        browserTabs,
      },
      modelOverride,
      onEvent
    );
    // 回合结束：解析协议块（在完整文本上），清理各文本段
    patchLast((m) => {
      const { content, ops, charts, uiSpecs } = parseAssistantReply(fullText);
      let parts = (m.parts ?? [])
        .map((p) =>
          p.kind === "text"
            ? {
                ...p,
                text: p.text
                  .replace(/```mailuo-[\s\S]*?(```|$)/g, "")
                  .trim(),
              }
            : p
        )
        .filter((p) => p.kind !== "text" || p.text);
      // 最后一个文本段替换为最终正文，保证协议块剥净
      let replaced = false;
      parts = parts.map((p, i) => {
        if (
          !replaced &&
          p.kind === "text" &&
          !parts.slice(i + 1).some((x) => x.kind === "text")
        ) {
          replaced = true;
          return { kind: "text" as const, text: content || p.text };
        }
        return p;
      });
      if (!replaced && content) parts.push({ kind: "text", text: content });
      if (parts.length === 0) parts.push({ kind: "text", text: "（收到）" });
      return { ...m, content: fullText, parts, streaming: false, ops, charts, uiSpecs };
    });
    persistChats();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error("小枢回复失败", { description: message });
    patchLast((assistantMessage) => ({
      ...assistantMessage,
      content: fullText,
      streaming: false,
      parts: [
        ...(assistantMessage.parts ?? []),
        { kind: "text", text: `请求失败：${message}` },
      ],
    }));
    persistChats();
  } finally {
    useChat.getState().set({ busy: false });
  }
}

function extractFiles(
  m: Message,
  e: Extract<AssistantEventPayload, { type: "tool_end" }>
): string[] {
  const files = new Set(m.files ?? []);
  if ((e.name === "write" || e.name === "edit") && e.ok) {
    const part = (m.parts ?? []).find(
      (p) => p.kind === "tool" && p.id === e.id
    ) as Extract<MsgPart, { kind: "tool" }> | undefined;
    // 主进程已在截断前解析好绝对路径
    if (part?.file) files.add(part.file);
  }
  return [...files];
}

/* ---------- 渲染 ---------- */

const OP_LABEL: Record<string, string> = {
  create_task: "创建任务",
  set_status: "更新状态",
  set_priority: "调整优先级",
  set_due: "设定期限",
  add_dep: "建立依赖",
  set_notes: "更新备注",
  delete_task: "删除任务",
  add_tags: "添加标签",
  remove_tags: "移除标签",
  remember: "记住",
};

function ToolPart({ part }: { part: Extract<MsgPart, { kind: "tool" }> }) {
  return (
    <details className="group w-full rounded-lg border bg-muted/30 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {part.name === "bash" ? (
          <Terminal className="size-3 shrink-0" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="font-mono font-medium">{part.name}</span>
        <span className="truncate font-mono text-muted-foreground">
          {part.args.slice(0, 80)}
        </span>
        <span className="ml-auto shrink-0">
          {part.status === "run" && (
            <span className="inline-block size-2.5 animate-pulse rounded-full bg-[var(--viz-doing)]" />
          )}
          {part.status === "ok" && (
            <Check className="size-3 text-[var(--viz-done)]" />
          )}
          {part.status === "err" && (
            <X className="size-3 text-[var(--viz-blocked)]" />
          )}
        </span>
      </summary>
      {part.output && (
        <pre className="max-h-56 overflow-auto border-t px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {part.output}
        </pre>
      )}
    </details>
  );
}

function ThinkingPart({ text }: { text: string }) {
  return (
    <details className="group w-full rounded-lg border border-dashed bg-transparent text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        <Brain className="size-3" />
        思考过程
      </summary>
      <div className="border-t border-dashed px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground/80">
        {text}
      </div>
    </details>
  );
}

function UserAttachment({
  attachment,
}: {
  attachment: AssistantAttachmentMeta;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isImage = attachment.kind === "image";

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    if (!isImage || !attachment.path || !bridge) return;
    void bridge
      .readImageDataUrl(attachment.path, attachment.mimeType)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.mimeType, attachment.path, isImage]);

  return (
    <button
      type="button"
      disabled={!attachment.path}
      aria-label={
        attachment.path
          ? `打开附件 ${attachment.name}`
          : `正在保存附件 ${attachment.name}`
      }
      title={attachment.path ? "在标签页中打开" : "附件正在保存"}
      className="group flex max-w-56 items-center gap-2 rounded-lg border border-primary/20 bg-primary/8 px-2 py-1.5 text-left text-xs enabled:hover:border-primary/50 enabled:hover:bg-primary/12 disabled:cursor-default"
      onClick={() =>
        attachment.path &&
        openFilePanel(attachment.path, attachment.mimeType, attachment.name)
      }
    >
      {isImage && previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="size-10 shrink-0 rounded-md border object-cover"
        />
      ) : isImage ? (
        <FileImage className="size-4 shrink-0 text-primary" />
      ) : (
        <FileText className="size-4 shrink-0 text-primary" />
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium">{attachment.name}</span>
        <span className="block text-[10px] text-muted-foreground">
          {attachment.path ? "点击打开" : "正在保存"}
        </span>
      </span>
    </button>
  );
}

export function AssistantPanel() {
  const { t } = useTranslation();
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const tasks = useAppStore((s) => s.tasks);
  const projectTasks = tasks.filter((t) => t.projectId === selectedProjectId);

  const conversations = useChat((s) => s.conversations);
  const currentId = useChat((s) => s.currentId);
  const busy = useChat((s) => s.busy);
  const contextUsage = useChat((s) => s.contextUsage);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [assistantStatus, setAssistantStatus] =
    useState<RouteResolutionStatus | null>(null);
  const [browserApprovals, setBrowserApprovals] = useState<
    BrowserApprovalRequest[]
  >([]);
  const conv = conversations.find((c) => c.id === currentId) ?? null;
  const messages =
    conv && conv.projectId === selectedProjectId ? conv.messages : [];

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastProjectRef = useRef(selectedProjectId);

  useEffect(() => {
    if (lastProjectRef.current !== selectedProjectId) {
      lastProjectRef.current = selectedProjectId;
      useChat
        .getState()
        .set({ currentId: null, contextUsage: undefined });
      void assistantReset();
    }
  }, [selectedProjectId]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 999999 }));
  }, [messages]);

  useEffect(() => {
    const refreshStatus = () => {
      void bridge
        ?.getAiRouteStatuses()
        .then((statuses) =>
          setAssistantStatus(
            statuses.find((status) => status.useCase === "assistant") ?? null
          )
        )
        .catch((error) =>
          setAssistantStatus({
            useCase: "assistant",
            ready: false,
            message: String(error),
          })
        );
    };
    refreshStatus();
    const onRuntimeChanged = () => {
      useChat.getState().set({ stale: true, contextUsage: undefined });
      void assistantReset();
      refreshStatus();
    };
    window.addEventListener("mailuo-ai-runtime-changed", onRuntimeChanged);
    return () =>
      window.removeEventListener("mailuo-ai-runtime-changed", onRuntimeChanged);
  }, []);

  useEffect(() => {
    const pending = new Set<string>();
    const unsubscribe = bridge?.onBrowserApprovalRequest((request) => {
      pending.add(request.id);
      setBrowserApprovals((current) => [
        ...current.filter((item) => item.id !== request.id),
        request,
      ]);
    });
    return () => {
      unsubscribe?.();
      for (const id of pending) {
        bridge?.respondBrowserApproval({ id, allowed: false });
      }
    };
  }, []);

  const applyOps = (idx: number) => {
    const msg = messages[idx];
    if (!msg.ops || !selectedProjectId) return;
    toast.success(applyAssistantOps(selectedProjectId, msg.ops));
    updateCurrent((c) => ({
      ...c,
      messages: c.messages.map((m, i) =>
        i === idx ? { ...m, opsApplied: true } : m
      ),
    }));
    persistChats();
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <Bot className="size-12 text-primary/70" />
            <p className="font-heading text-base font-bold text-foreground">
              我是小枢
            </p>
            <p>
              创建任务、编织依赖、画图表、写文档——
              <br />
              我能操作任务、文件和你当前打开的内置浏览器标签页。
            </p>
            <p className="text-xs">@ 引用任务或浏览器 · $ 引用 skill · / 快捷指令</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "flex flex-col gap-1.5",
                  m.role === "user" ? "items-end" : "items-start"
                )}
              >
                {m.role === "assistant" && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Bot className="size-4 text-primary" />
                    小枢
                  </span>
                )}

                {m.role === "user" ? (
                  <div className="flex max-w-[85%] flex-col items-end gap-1">
                    {m.content && (
                      <div className="rounded-xl bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                        {m.content}
                      </div>
                    )}
                    {m.mentions && m.mentions.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {m.mentions.map((mention) => (
                          <button
                            key={mentionKey(mention)}
                            className="flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/8 px-2 py-1 text-[11px]"
                            onClick={() => {
                              if (mention.kind === "browser-tab") {
                                void bridge?.commandBrowserTab(
                                  "focus",
                                  mention.tabId
                                ).catch(() =>
                                  toast.error(t("browser.closedTab"))
                                );
                              } else {
                                useAppStore
                                  .getState()
                                  .selectTask(mention.taskId);
                              }
                            }}
                          >
                            {mention.kind === "browser-tab" ? (
                              <Globe2 className="size-3" />
                            ) : (
                              <Check className="size-3" />
                            )}
                            @{mentionLabel(mention)}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {m.attachments.map((attachment) => (
                          <UserAttachment
                            key={attachment.id}
                            attachment={attachment}
                          />
                        ))}
                      </div>
                    )}
                    {m.assets && m.assets.length > 0 && selectedProjectId && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {m.assets.map((asset) => (
                          <button
                            key={asset.assetId}
                            className="rounded-lg border border-primary/20 bg-primary/8 px-2 py-1.5 text-xs"
                            onClick={() => void openAsset(selectedProjectId, {
                              id: asset.assetId,
                              projectId: selectedProjectId,
                              name: asset.name,
                              relativePath: asset.relativePath,
                              mimeType: asset.mimeType,
                              size: asset.size,
                              createdAt: 0,
                              modifiedAt: 0,
                              source: "ai",
                              tags: [],
                              favorite: false,
                              trashed: false,
                            })}
                          >#{asset.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex w-[94%] flex-col gap-1.5">
                    {(m.parts ?? []).map((p, j) =>
                      p.kind === "text" ? (
                        p.text ? (
                          <div
                            key={j}
                            className="rounded-xl border bg-card px-3.5 py-2"
                          >
                            <Md text={p.text} />
                            {m.streaming &&
                              j === (m.parts?.length ?? 0) - 1 && (
                                <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />
                              )}
                          </div>
                        ) : null
                      ) : p.kind === "thinking" ? (
                        <ThinkingPart key={j} text={p.text} />
                      ) : (
                        <ToolPart key={j} part={p} />
                      )
                    )}
                    {m.streaming && (m.parts?.length ?? 0) === 0 && (
                      <div className="rounded-xl border bg-card px-3.5 py-2 text-sm text-muted-foreground">
                        小枢思考中…
                      </div>
                    )}

                    {m.files && m.files.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.files.map((f) => (
                          <button
                            key={f}
                            className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs hover:border-primary/50 hover:bg-accent"
                            onClick={() => openFilePanel(f)}
                          >
                            <FileText className="size-3.5 text-primary" />
                            {f.split("/").pop()}
                          </button>
                        ))}
                      </div>
                    )}

                    {m.charts?.map((spec, j) => (
                      <AiChart key={`c${j}`} spec={spec} />
                    ))}
                    {m.uiSpecs?.map((spec, j) => (
                      <UiBlock key={`u${j}`} spec={spec} />
                    ))}

                    {m.ops && m.ops.length > 0 && (
                      <div className="rounded-xl border bg-card p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          建议的操作
                        </p>
                        <ul className="mb-2.5 flex flex-col gap-1">
                          {m.ops.map((op, j) => (
                            <li
                              key={j}
                              className="flex items-center gap-1.5 text-xs"
                            >
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                                {OP_LABEL[op.op] ?? op.op}
                              </span>
                              <span className="truncate text-muted-foreground">
                                {op.title ?? op.task ?? op.notes}
                                {op.depends_on ? ` ← ${op.depends_on}` : ""}
                                {op.status ? ` → ${op.status}` : ""}
                                {op.priority ? ` → ${op.priority}` : ""}
                                {op.date ? ` → ${op.date}` : ""}
                                {op.tags?.length ? ` [${op.tags.join(", ")}]` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {m.opsApplied ? (
                          <p className="flex items-center gap-1.5 text-xs text-status-done">
                            <CircleCheck className="size-3.5" /> 已应用
                          </p>
                        ) : (
                          <Button size="sm" onClick={() => applyOps(i)}>
                            应用 {m.ops.length} 项操作
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {assistantStatus?.ready === false && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-dashed p-2.5 text-xs">
          <AlertCircle className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            尚未完成 AI 配置。{assistantStatus.message}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
            前往设置
          </Button>
        </div>
      )}

      {browserApprovals.map((approval) => (
        <div
          key={approval.id}
          className="mx-3 mb-2 rounded-xl border border-primary/25 bg-card p-3 shadow-sm"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {t("browser.approvalTitle")}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {approval.tabTitle} ·{" "}
                {t(`browser.actions.${approval.action}`, {
                  defaultValue: approval.action,
                })}
                {approval.target ? ` · ${approval.target}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  approval.reason === "read-only"
                    ? "browser.approvalReasonReadOnly"
                    : "browser.approvalReasonSensitive"
                )}
              </p>
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                bridge?.respondBrowserApproval({
                  id: approval.id,
                  allowed: false,
                });
                setBrowserApprovals((items) =>
                  items.filter((item) => item.id !== approval.id)
                );
              }}
            >
              {t("common.deny")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                bridge?.respondBrowserApproval({
                  id: approval.id,
                  allowed: true,
                });
                setBrowserApprovals((items) =>
                  items.filter((item) => item.id !== approval.id)
                );
              }}
            >
              {t("common.allowOnce")}
            </Button>
          </div>
        </div>
      ))}

      <Composer
        tasks={projectTasks}
        busy={busy || assistantStatus?.ready === false}
        contextUsage={contextUsage}
        modelOverride={conv?.modelOverride}
        onModelOverrideChange={(modelOverride) => {
          if (!selectedProjectId) return;
          ensureConversation(selectedProjectId);
          updateCurrent((conversation) => ({
            ...conversation,
            ...(modelOverride ? { modelOverride } : { modelOverride: undefined }),
          }));
          useChat
            .getState()
            .set({ stale: true, contextUsage: undefined });
          persistChats();
          void assistantReset();
        }}
        onSend={(text, ids, skills, attachments, assetRefs) =>
          sendMessage(text, ids, skills, attachments, assetRefs)
        }
      />
    </div>
  );
}
