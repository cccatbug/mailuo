import "./proxy-fetch.ts";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai/compat";
import type {
  AssistantAttachmentMeta,
  AssistantAttachmentPayload,
  AssistantEventPayload,
} from "../src/shared/assistant";

export interface AgentConfig {
  provider?: string | null;
  model?: string | null;
  thinking?: string | null;
  proxy?: string | null;
}

export type AssistantEvent = AssistantEventPayload;

/* ---------- 应用数据根：~/.mailuo ---------- */

export const MAILUO_HOME = path.join(os.homedir(), ".mailuo");

export function workspaceDir(projectId: string): string {
  // 项目 id 是 uuid，安全拼接
  return path.join(MAILUO_HOME, "workspace", projectId.replace(/[^\w-]/g, ""));
}

export function memoryPath(): string {
  return path.join(MAILUO_HOME, "memory.md");
}

/** 限制文件访问在 ~/.mailuo 内 */
function assertInHome(p: string): string {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(MAILUO_HOME + path.sep) && resolved !== MAILUO_HOME) {
    throw new Error("路径超出 ~/.mailuo 范围");
  }
  return resolved;
}

export async function readMailuoFile(p: string): Promise<string> {
  return fs.readFile(assertInHome(p), "utf8");
}

const SAFE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** 为工作区图片生成渲染用 data URL；路径和 MIME 均由主进程再次校验。 */
export async function readMailuoImageDataUrl(
  p: string,
  mimeType: string
): Promise<string> {
  const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();
  if (!SAFE_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new Error("不支持预览此图片格式");
  }
  const bytes = await fs.readFile(assertInHome(p));
  const detectedMime = detectImageMimeType(bytes);
  if (!detectedMime) throw new Error("文件内容不是受支持的图片");
  return `data:${detectedMime};base64,${bytes.toString("base64")}`;
}

export async function writeMailuoFile(p: string, content: string): Promise<void> {
  const file = assertInHome(p);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

export async function appendMemory(note: string): Promise<void> {
  const file = memoryPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  await fs.appendFile(file, `- (${stamp}) ${note.trim()}\n`, "utf8");
}

async function readMemory(): Promise<string> {
  try {
    return await fs.readFile(memoryPath(), "utf8");
  } catch {
    return "";
  }
}

/* ---------- skills（~/.pi/agent/skills，SKILL.md 带 frontmatter） ---------- */

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
}

export async function listSkills(): Promise<SkillInfo[]> {
  const dir = path.join(getAgentDir(), "skills");
  const out: SkillInfo[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    try {
      const raw = await fs.readFile(path.join(dir, name, "SKILL.md"), "utf8");
      const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
      const desc =
        fm?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      const skillName = fm?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? name;
      out.push({
        name: skillName,
        description: desc.slice(0, 200),
        content: raw.slice(0, 12000),
      });
    } catch {
      // 无 SKILL.md 的目录跳过
    }
  }
  return out;
}

/* ---------- ModelRuntime ---------- */

let mrPromise: Promise<ModelRuntime> | undefined;

function modelRuntime(): Promise<ModelRuntime> {
  mrPromise ??= ModelRuntime.create().catch((err: unknown) => {
    mrPromise = undefined;
    throw err;
  });
  return mrPromise;
}

export async function listModels(): Promise<
  { provider: string; id: string; name: string; reasoning: boolean }[]
> {
  const mr = await modelRuntime();
  const models = await mr.getAvailable();
  return models.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
    reasoning: Boolean(m.reasoning),
  }));
}

function applyProxy(config: AgentConfig) {
  const proxy = config.proxy?.trim();
  if (!proxy) return;
  process.env.http_proxy = proxy;
  process.env.https_proxy = proxy;
  process.env.HTTP_PROXY = proxy;
  process.env.HTTPS_PROXY = proxy;
}

/* ---------- 会话构造 ---------- */

async function makeSession(
  config: AgentConfig,
  system: string,
  opts: { cwd?: string; withTools?: boolean } = {}
): Promise<AgentSession> {
  applyProxy(config);
  const mr = await modelRuntime();

  let model;
  const wanted = config.model?.trim();
  if (wanted) {
    const [p, ...rest] = wanted.includes("/")
      ? wanted.split("/")
      : [config.provider?.trim() ?? "", wanted];
    model = mr.getModel(p, rest.join("/"));
    if (!model) throw new Error(`未找到模型：${wanted}（检查设置中的 Provider/模型）`);
  }

  const cwd = opts.cwd ?? process.cwd();
  if (opts.cwd) await fs.mkdir(cwd, { recursive: true });

  const memory = opts.withTools ? await readMemory() : "";
  const fullSystem = opts.withTools
    ? `${system}\n\n# 工作目录\n你拥有 read/bash/edit/write 工具。当前工作目录：${cwd}。用户让你产出文档/文件时，写入工作目录（相对路径即可），完成后告知文件名。\n${
        memory ? `\n# 用户长期记忆\n${memory.slice(0, 4000)}\n` : ""
      }`
    : system;

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    systemPromptOverride: () => fullSystem,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    modelRuntime: mr,
    model,
    sessionManager: SessionManager.inMemory(cwd),
    resourceLoader,
    // 纯任务型调用不开工具；小枢会话开放安全内建工具
    tools: opts.withTools ? ["read", "bash", "edit", "write", "grep", "find", "ls"] : [],
    ...(config.thinking?.trim()
      ? { thinkingLevel: config.thinking.trim() as never }
      : {}),
  });
  return session;
}

function extractResultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .map((c) =>
          c && typeof c === "object" && "text" in c
            ? String((c as { text: unknown }).text)
            : ""
        )
        .filter(Boolean)
        .join("\n");
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}\n…（截断）` : s;

/* ---------- 用户附件 ---------- */

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 100_000;

function detectImageMimeType(bytes: Uint8Array): string | null {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  const ascii = (text: string, offset = 0) =>
    [...text].every(
      (character, index) => bytes[offset + index] === character.charCodeAt(0)
    );

  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (ascii("GIF")) return "image/gif";
  if (ascii("RIFF") && ascii("WEBP", 8)) return "image/webp";
  return null;
}

function safeAttachmentName(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(-120);
  return cleaned || "attachment";
}

async function prepareAttachments(
  cwd: string,
  message: string,
  attachments: AssistantAttachmentPayload[]
): Promise<{
  message: string;
  images: ImageContent[];
  attachments: AssistantAttachmentMeta[];
}> {
  const picked = attachments.slice(0, 8);
  if (picked.length === 0) {
    return { message, images: [], attachments: [] };
  }

  const dir = path.join(cwd, ".attachments");
  await fs.mkdir(dir, { recursive: true });

  const manifest: string[] = [];
  const textBlocks: string[] = [];
  const images: ImageContent[] = [];
  const storedAttachments: AssistantAttachmentMeta[] = [];
  let totalBytes = 0;
  let totalTextChars = 0;

  for (const item of picked) {
    if (!item.data || typeof item.data !== "string") {
      throw new Error(`附件「${item.name}」内容为空`);
    }
    const bytes = Buffer.from(item.data, "base64");
    if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`附件「${item.name}」超过 10 MB 或内容无效`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("附件总大小不能超过 25 MB");
    }

    const name = safeAttachmentName(item.name);
    const id = item.id.replace(/[^\w-]/g, "").slice(0, 48) || crypto.randomUUID();
    const relativePath = path.join(".attachments", `${id}-${name}`);
    const absolutePath = path.join(cwd, relativePath);
    await fs.writeFile(absolutePath, bytes);

    const detectedImageMime =
      item.kind === "image" ? detectImageMimeType(bytes) : null;
    if (item.kind === "image" && !detectedImageMime) {
      await fs.unlink(absolutePath).catch(() => undefined);
      throw new Error(`附件「${item.name}」不是受支持的 PNG、JPEG、GIF 或 WebP 图片`);
    }
    const mimeType =
      (detectedImageMime ?? item.mimeType) || "application/octet-stream";
    storedAttachments.push({
      id: item.id,
      name,
      mimeType,
      size: bytes.length,
      kind: item.kind,
      path: absolutePath,
    });
    manifest.push(
      `- ${name}（${mimeType}，${bytes.length} bytes）路径：${relativePath}`
    );

    if (item.kind === "image" && detectedImageMime) {
      images.push({
        type: "image",
        data: bytes.toString("base64"),
        mimeType: detectedImageMime,
      });
    } else if (item.kind === "text" && totalTextChars < MAX_ATTACHMENT_TEXT_CHARS) {
      const remaining = MAX_ATTACHMENT_TEXT_CHARS - totalTextChars;
      const text = bytes.toString("utf8").slice(0, remaining);
      totalTextChars += text.length;
      textBlocks.push(
        `<attachment name="${name}" path="${relativePath}">\n${text}\n</attachment>`
      );
    }
  }

  const attachmentContext = [
    "【本轮附件】",
    ...manifest,
    "附件已保存到当前工作目录；需要完整内容时可使用 read/bash 读取上述相对路径。",
    ...(textBlocks.length
      ? ["以下是可直接加入上下文的文本附件内容：", ...textBlocks]
      : []),
  ].join("\n");

  return {
    message: `${message}\n\n${attachmentContext}`,
    images,
    attachments: storedAttachments,
  };
}

/* ---------- 一次性调用 ---------- */

export async function runOneShot(
  config: AgentConfig,
  system: string | null,
  prompt: string
): Promise<string> {
  const session = await makeSession(config, system ?? "You are a helpful assistant.");
  let acc = "";
  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      acc += event.assistantMessageEvent.delta;
    }
  });
  try {
    await session.prompt(prompt);
    const result = acc.trim();
    if (!result) throw new Error("模型返回了空回复");
    return result;
  } finally {
    unsub();
    session.dispose();
  }
}

/* ---------- 常驻小枢会话（带工具 + 全事件流式） ---------- */

let assistant: { session: AgentSession; key: string } | null = null;

function configKey(config: AgentConfig, system: string, cwd: string): string {
  return [
    config.provider ?? "",
    config.model ?? "",
    config.thinking ?? "",
    cwd,
    system,
  ].join("|");
}

export async function assistantSend(
  config: AgentConfig,
  system: string,
  message: string,
  projectId: string,
  attachments: AssistantAttachmentPayload[],
  emit: (event: AssistantEvent) => void
): Promise<void> {
  const cwd = workspaceDir(projectId || "default");
  const key = configKey(config, system, cwd);
  if (assistant && assistant.key !== key) {
    assistant.session.dispose();
    assistant = null;
  }
  if (!assistant) {
    assistant = {
      session: await makeSession(config, system, { cwd, withTools: true }),
      key,
    };
  }
  const { session } = assistant;
  const prepared = await prepareAttachments(cwd, message, attachments);
  if (prepared.attachments.length > 0) {
    emit({ type: "attachments", attachments: prepared.attachments });
  }
  if (
    prepared.images.length > 0 &&
    !session.model?.input.includes("image")
  ) {
    throw new Error("当前模型不支持图片输入，请切换到支持视觉的模型");
  }

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") emit({ type: "delta", text: ame.delta });
        else if (ame.type === "thinking_delta")
          emit({ type: "thinking", text: ame.delta });
        break;
      }
      case "tool_execution_start": {
        // write/edit：在截断前解析出目标文件的绝对路径（限 ~/.mailuo 内）
        let file: string | undefined;
        if (event.toolName === "write" || event.toolName === "edit") {
          const a = event.args as Record<string, unknown> | undefined;
          const raw = a?.path ?? a?.file_path ?? a?.filePath;
          if (typeof raw === "string" && raw) {
            const abs = path.resolve(cwd, raw);
            if (abs.startsWith(MAILUO_HOME + path.sep)) file = abs;
          }
        }
        emit({
          type: "tool_start",
          id: event.toolCallId,
          name: event.toolName,
          args: clip(JSON.stringify(event.args ?? {}), 600),
          ...(file ? { file } : {}),
        });
        break;
      }
      case "tool_execution_end":
        emit({
          type: "tool_end",
          id: event.toolCallId,
          name: event.toolName,
          ok: !event.isError,
          output: clip(extractResultText(event.result), 4000),
        });
        break;
      default:
        break;
    }
  });

  try {
    await session.prompt(prepared.message, { images: prepared.images });
    const usage = session.getContextUsage();
    if (usage) {
      emit({
        type: "context",
        usage: {
          tokens: usage.tokens,
          contextWindow: usage.contextWindow,
          percent: usage.percent,
        },
      });
    }
    emit({ type: "done" });
  } catch (err) {
    assistantReset();
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: msg });
    throw new Error(msg);
  } finally {
    unsubscribe();
  }
}

export function assistantReset(): void {
  assistant?.session.dispose();
  assistant = null;
}
