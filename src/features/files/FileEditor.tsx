import { useEffect, useState } from "react";
import { Eye, ImageIcon, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { bridge } from "@/lib/bridge";
import { Md } from "@/features/ai/Markdown";
import { cn } from "@/lib/utils";

/** ~/.mailuo 内文件的查看/编辑器（小枢产出物、附件、记忆文件等） */
export function FileEditor({
  path,
  mimeType,
}: {
  path: string;
  mimeType?: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(path.endsWith(".md"));
  const isMd = path.endsWith(".md");
  const isImage = Boolean(mimeType?.startsWith("image/"));

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setImageUrl(null);
    const request =
      isImage && mimeType
        ? bridge?.readImageDataUrl(path, mimeType)
        : bridge?.readFile(path);
    request
      ?.then((value) => {
        if (cancelled) return;
        if (isImage) setImageUrl(value);
        else setContent(value);
      })
      .catch((e) => {
        if (!cancelled) {
          if (isImage) setImageUrl("");
          else setContent("");
          toast.error("读取文件失败", { description: String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isImage, mimeType, path]);

  const save = async () => {
    if (content === null) return;
    setSaving(true);
    try {
      await bridge?.writeFile(path, content);
      setDirty(false);
      toast.success("已保存");
    } catch (e) {
      toast.error("保存失败", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  if ((isImage && imageUrl === null) || (!isImage && content === null)) {
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
          {path.replace(/^.*\/\.mailuo\//, "~/.mailuo/")}
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
          ) : isMd ? (
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
          {!isImage && (
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
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-5">
            <img
              src={imageUrl}
              alt={path.split("/").pop() ?? "附件图片"}
              className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="size-8" />
            图片无法预览
          </div>
        )
      ) : isMd && preview ? (
        <div
          className="min-h-0 flex-1 cursor-text overflow-y-auto px-5 py-4"
          onDoubleClick={() => setPreview(false)}
          title="双击进入编辑"
        >
          <Md text={content ?? ""} />
        </div>
      ) : (
        <textarea
          value={content ?? ""}
          spellCheck={false}
          className={cn(
            "min-h-0 flex-1 resize-none bg-transparent px-5 py-4 text-sm leading-relaxed outline-none",
            !isMd && "font-mono text-xs"
          )}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              void save();
            }
          }}
        />
      )}
    </div>
  );
}
