import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  FolderOpen,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { bridge } from "@/lib/bridge";
import type { AssetRecord } from "@/shared/assets";
import { openFilePanel } from "@/components/DockLayout";
import { Md } from "@/features/ai/Markdown";
import { PdfViewer } from "./PdfViewer";

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Quick Look 快速预览（空格触发，macOS Finder 风格）：
 * 图片 / PDF / 音视频 / Markdown / 文本 / 未知类型，← → 切换，Esc / 空格关闭。
 */
export function QuickLook({
  projectId,
  items,
  initialIndex,
  onClose,
}: {
  projectId: string;
  items: AssetRecord[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0))
  );
  const [resolved, setResolved] = useState<{
    path: string;
    asset: AssetRecord;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const asset = items[index];

  useEffect(() => {
    cancelledRef.current = false;
    setResolved(null);
    setLoadError(null);
    if (!asset) return;
    void bridge
      ?.resolveAsset(projectId, asset.id)
      .then((result) => {
        if (!cancelledRef.current) {
          setResolved({ path: result.absolutePath, asset: result.asset });
        }
      })
      .catch((error) => {
        if (!cancelledRef.current) setLoadError(String(error));
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [asset, projectId]);

  const navigate = useCallback(
    (delta: number) => {
      setIndex((current) =>
        Math.min(Math.max(current + delta, 0), Math.max(items.length - 1, 0))
      );
    },
    [items.length]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigate(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        navigate(1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [navigate, onClose]);

  const preview = useMemo(() => {
    if (!resolved) return null;
    const { path, asset: current } = resolved;
    const mime = current.mimeType;
    const extension = current.name.split(".").pop()?.toLowerCase() ?? "";
    if (mime.startsWith("image/")) {
      return <ImagePreview path={path} mimeType={mime} name={current.name} />;
    }
    if (mime === "application/pdf" || extension === "pdf") {
      return <PdfPreview path={path} mimeType={mime} />;
    }
    if (mime.startsWith("video/")) {
      return <MediaPreview path={path} mimeType={mime} kind="video" />;
    }
    if (mime.startsWith("audio/")) {
      return <MediaPreview path={path} mimeType={mime} kind="audio" />;
    }
    if (mime === "text/markdown" || extension === "md") {
      return <TextPreview path={path} render="markdown" />;
    }
    if (mime === "text/html" || extension === "html" || extension === "htm") {
      return <TextPreview path={path} render="html" />;
    }
    if (
      mime.startsWith("text/") ||
      ["json", "xml", "yaml", "yml", "js", "jsx", "ts", "tsx", "css", "csv", "log"].includes(extension)
    ) {
      return <TextPreview path={path} render="plain" />;
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <FileQuestion className="size-12 opacity-50" />
        <p className="text-sm">暂不支持内嵌预览此格式</p>
        <p className="font-mono text-xs">{mime || "未知文件类型"}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void bridge?.openPath(path)}
          >
            <SquareArrowOutUpRight />
            用系统应用打开
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openFilePanel(path, mime, current.name)}
          >
            <FolderOpen />
            在面板中打开
          </Button>
        </div>
      </div>
    );
  }, [resolved]);

  if (!asset) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{asset.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {formatSize(asset.size)} · {asset.relativePath}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={index <= 0}
              onClick={() => navigate(-1)}
            >
              <ChevronLeft />
            </Button>
            <span className="w-10 text-center text-xs text-muted-foreground">
              {index + 1}/{items.length}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={index >= items.length - 1}
              onClick={() => navigate(1)}
            >
              <ChevronRight />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
          {loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <FileQuestion className="size-10 opacity-50" />
              <p>无法读取文件</p>
              <p className="max-w-md break-all text-center font-mono text-xs">
                {loadError}
              </p>
            </div>
          ) : (
            preview ?? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Spinner />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ImagePreview({ path, mimeType, name }: { path: string; mimeType: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void bridge
      ?.readImageDataUrl(path, mimeType)
      .then((value) => !cancelled && setUrl(value))
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [path, mimeType]);
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-black/80 p-4">
      <img
        src={url}
        alt={name}
        className="max-h-full max-w-full rounded-lg object-contain shadow-lg"
      />
    </div>
  );
}

function PdfPreview({ path, mimeType }: { path: string; mimeType: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void bridge
      ?.fileUrl(path, mimeType)
      .then((value) => !cancelled && setSrc(value))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [path, mimeType]);
  if (!src) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  return <PdfViewer path={path} src={src} />;
}

function MediaPreview({
  path,
  mimeType,
  kind,
}: {
  path: string;
  mimeType: string;
  kind: "video" | "audio";
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void bridge
      ?.fileUrl(path, mimeType)
      .then((value) => !cancelled && setSrc(value))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [path, mimeType]);
  if (!src) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-black/80 p-6">
        <video src={src} controls autoPlay className="max-h-full max-w-full rounded-lg" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-black/80 p-10">
      <audio src={src} controls autoPlay className="w-full max-w-xl" />
    </div>
  );
}

function TextPreview({
  path,
  render,
}: {
  path: string;
  render: "plain" | "markdown" | "html";
}) {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void bridge
      ?.readFile(path)
      .then((value) => !cancelled && setContent(value))
      .catch(() => !cancelled && setContent(null));
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  if (render === "markdown") {
    return (
      <div className="h-full overflow-y-auto bg-background px-6 py-5">
        <Md text={content} />
      </div>
    );
  }
  if (render === "html") {
    return (
      <iframe
        srcDoc={content}
        sandbox="allow-forms allow-modals allow-popups allow-scripts"
        title="HTML 预览"
        className="h-full w-full border-0 bg-white"
      />
    );
  }
  return (
    <pre className="h-full overflow-auto bg-background p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {content}
    </pre>
  );
}
