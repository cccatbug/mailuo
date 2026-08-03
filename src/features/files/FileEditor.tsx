import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Eye,
  FileQuestion,
  ImageIcon,
  Music2,
  Pencil,
  Play,
  Save,
  SquareArrowOutUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { bridge } from "@/lib/bridge";
import { Md } from "@/features/ai/Markdown";
import { useAppStore } from "@/store/useAppStore";
import { ImageViewer } from "./ImageViewer";
import { fileEditorLanguage } from "./editor-language";

const MonacoFileEditor = lazy(() =>
  import("./MonacoFileEditor").then((module) => ({
    default: module.MonacoFileEditor,
  }))
);

/** ~/.mailuo 内文件的查看/编辑器（小枢产出物、附件、记忆文件等） */
export function FileEditor({
  path,
  mimeType,
}: {
  path: string;
  mimeType?: string;
}) {
  const theme = useAppStore((state) => state.theme);
  const [content, setContent] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const [preview, setPreview] = useState(
    /\.(?:md|html?)$/i.test(path) ||
      mimeType === "text/markdown" ||
      mimeType === "text/html"
  );
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const normalizedMime =
    mimeType?.toLowerCase().split(";")[0] ||
    ({
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      bmp: "image/bmp",
      ico: "image/x-icon",
      pdf: "application/pdf",
      html: "text/html",
      htm: "text/html",
      md: "text/markdown",
    }[extension] ?? "");
  const isMd = extension === "md" || normalizedMime === "text/markdown";
  const isHtml =
    extension === "html" ||
    extension === "htm" ||
    normalizedMime === "text/html";
  const isImage = normalizedMime.startsWith("image/");
  const isPdf = extension === "pdf" || normalizedMime === "application/pdf";
  const isAudio = normalizedMime.startsWith("audio/");
  const isVideo = normalizedMime.startsWith("video/");
  const isMedia = isPdf || isAudio || isVideo;
  const isText =
    isMd ||
    isHtml ||
    normalizedMime.startsWith("text/") ||
    ["json", "xml", "yaml", "yml", "js", "jsx", "ts", "tsx", "css", "csv", "log"].includes(extension);
  const isUnknown = !isImage && !isMedia && !isText;
  const editorLanguage = fileEditorLanguage(path);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setImageUrl(null);
    const request =
      isImage
        ? bridge?.readImageDataUrl(path, normalizedMime)
        : isMedia
          ? bridge?.readDataUrl(path, normalizedMime)
        : bridge?.readFile(path);
    request
      ?.then((value) => {
        if (cancelled) return;
        if (isImage || isMedia) setImageUrl(value);
        else {
          contentRef.current = value;
          setContent(value);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          if (isImage || isMedia) setImageUrl("");
          else setContent("");
          toast.error("读取文件失败", { description: String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isImage, isMedia, mimeType, path]);

  const save = async () => {
    if (content === null) return;
    setSaving(true);
    try {
      await bridge?.writeFile(path, content);
      setDirty(false);
      dirtyRef.current = false;
      toast.success("已保存");
    } catch (e) {
      toast.error("保存失败", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    return () => {
      // Dockview 没有可取消的 before-close 钩子；关闭文件标签时把最后一次文本
      // 修改直接落盘，避免用户因关闭标签丢失内容。窗口退出仍由 beforeunload 拦截。
      if (dirtyRef.current && contentRef.current !== null) {
        void bridge?.writeFile(path, contentRef.current);
      }
    };
  }, [path]);

  if (((isImage || isMedia) && imageUrl === null) || (!isImage && !isMedia && content === null)) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {path.replace(/^.*[/\\]workspace[/\\][^/\\]+[/\\]?/, "").replace(/\\/g, "/")}
          {dirty && (
            <span
              className="ml-1 inline-block size-1.5 rounded-full bg-primary align-middle"
              aria-label="有未保存更改"
            />
          )}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isImage ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ImageIcon className="size-3.5" />
              图片
            </span>
          ) : isMedia ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {isAudio ? <Music2 className="size-3.5" /> : <Play className="size-3.5" />}
              {isPdf ? "PDF" : isAudio ? "音频" : "视频"}
            </span>
          ) : isMd || isHtml ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={preview ? "编辑" : "预览"}
              className="size-6.5 text-muted-foreground hover:text-foreground"
              onClick={() => setPreview((v) => !v)}
            >
              {preview ? <Pencil /> : <Eye />}
            </Button>
          ) : null}
          {!isImage && !isMedia && !isUnknown && (
            <Button
              variant="outline"
              size="sm"
              className="h-6.5 px-2 text-xs"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? <Spinner className="size-3" /> : <Save className="size-3" />}
              保存
            </Button>
          )}
        </div>
      </div>
      {isImage ? (
        imageUrl ? (
          <ImageViewer src={imageUrl} alt={path.split("/").pop() ?? "附件图片"} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="size-8" />
            图片无法预览
          </div>
        )
      ) : isPdf && imageUrl ? (
        <iframe
          src={imageUrl}
          title={path.split("/").pop() ?? "PDF"}
          className="min-h-0 flex-1 border-0 bg-background"
        />
      ) : isVideo && imageUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-5">
          <video src={imageUrl} controls className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : isAudio && imageUrl ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-8">
          <audio src={imageUrl} controls className="w-full max-w-xl" />
        </div>
      ) : isHtml && preview ? (
        <iframe
          srcDoc={content ?? ""}
          sandbox="allow-forms allow-modals allow-popups allow-scripts"
          title={path.split("/").pop() ?? "HTML 预览"}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : isMd && preview ? (
        <div
          className="min-h-0 flex-1 cursor-text overflow-y-auto px-5 py-4"
          onDoubleClick={() => setPreview(false)}
          title="双击进入编辑"
        >
          <Md text={content ?? ""} />
        </div>
      ) : isUnknown ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <FileQuestion className="size-10" />
          <div className="text-center">
            <p className="font-medium text-foreground">暂不支持内嵌预览此格式</p>
            <p className="mt-1 text-xs">{mimeType || "未知文件类型"}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void bridge?.openPath(path)}>
            <SquareArrowOutUpRight />
            用系统应用打开
          </Button>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <Spinner />
            </div>
          }
        >
          <MonacoFileEditor
            path={path}
            value={content ?? ""}
            language={editorLanguage}
            theme={theme}
            onChange={(value) => {
              contentRef.current = value;
              dirtyRef.current = true;
              setContent(value);
              setDirty(true);
            }}
            onSave={() => void save()}
          />
        </Suspense>
      )}
    </div>
  );
}
