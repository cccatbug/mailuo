import type {
  AssistantAttachmentKind,
  AssistantAttachmentMeta,
  AssistantAttachmentPayload,
} from "@/shared/assistant";

export interface ComposerAttachment extends AssistantAttachmentPayload {
  previewUrl?: string;
}

export interface AttachmentPreparation {
  accepted: ComposerAttachment[];
  errors: string[];
}

const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "c",
  "cpp",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "log",
  "md",
  "py",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const VISION_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function attachmentKind(file: File): AssistantAttachmentKind {
  if (VISION_MIME_TYPES.has(file.type)) return "image";
  if (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    file.type === "application/xml" ||
    file.type === "application/x-yaml" ||
    TEXT_EXTENSIONS.has(extensionOf(file.name))
  ) {
    return "text";
  }
  return "file";
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取附件失败"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("读取附件失败"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** 浏览器附件入口：集中处理数量、体积、编码、类型和图片预览。 */
export async function prepareBrowserAttachments(
  files: Iterable<File>,
  current: ComposerAttachment[]
): Promise<AttachmentPreparation> {
  const accepted: ComposerAttachment[] = [];
  const errors: string[] = [];
  let totalBytes = current.reduce((sum, item) => sum + item.size, 0);
  let slots = Math.max(0, MAX_FILES - current.length);

  for (const file of files) {
    if (slots <= 0) {
      errors.push(`最多添加 ${MAX_FILES} 个附件`);
      break;
    }
    if (file.size <= 0) {
      errors.push(`「${file.name || "未命名文件"}」内容为空`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`「${file.name}」超过 10 MB`);
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      errors.push("附件总大小不能超过 25 MB");
      break;
    }

    try {
      const kind = attachmentKind(file);
      accepted.push({
        id: crypto.randomUUID(),
        name: file.name || `image-${Date.now()}.png`,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        kind,
        data: await readAsBase64(file),
        ...(kind === "image" ? { previewUrl: URL.createObjectURL(file) } : {}),
      });
      totalBytes += file.size;
      slots--;
    } catch (error) {
      errors.push(`「${file.name}」读取失败：${String(error)}`);
    }
  }

  return { accepted, errors: [...new Set(errors)] };
}

export function attachmentMeta(
  attachment: ComposerAttachment
): AssistantAttachmentMeta {
  const { id, name, mimeType, size, kind } = attachment;
  return { id, name, mimeType, size, kind };
}

export function attachmentPayload(
  attachment: ComposerAttachment
): AssistantAttachmentPayload {
  const { id, name, mimeType, size, kind, data } = attachment;
  return { id, name, mimeType, size, kind, data };
}

export function releaseAttachment(attachment: ComposerAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}
