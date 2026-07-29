import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  File,
  FileImage,
  FileText,
  FolderOpen,
  FolderPlus,
  Grid2x2,
  Heart,
  Import,
  List,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { bridge } from "@/lib/bridge";
import { useAppStore } from "@/store/useAppStore";
import type { AssetRecord } from "@/shared/assets";
import { openFilePanel } from "@/components/DockLayout";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const sourceLabel = { ai: "AI 产物", attachment: "附件", import: "导入" } as const;

function assetIcon(asset: AssetRecord) {
  if (asset.mimeType.startsWith("image/")) return <FileImage />;
  if (asset.mimeType.startsWith("text/") || asset.mimeType.includes("json")) return <FileText />;
  return <File />;
}

function AssetThumbnail({ projectId, asset }: { projectId: string; asset: AssetRecord }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!asset.mimeType.startsWith("image/")) return;
    void bridge?.resolveAsset(projectId, asset.id)
      .then(({ absolutePath }) => bridge!.readImageDataUrl(absolutePath, asset.mimeType))
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setSrc(""); });
    return () => { cancelled = true; };
  }, [asset.id, asset.mimeType, projectId]);
  if (!src) return <>{assetIcon(asset)}</>;
  return <img src={src} alt="" className="h-full w-full rounded-lg object-cover" />;
}

function TagDialog({
  asset,
  allTags,
  onClose,
  onSave,
}: {
  asset: AssetRecord;
  allTags: string[];
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const [value, setValue] = useState(asset.tags.join(", "));
  const tags = value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>管理「{asset.name}」的标签</DialogTitle></DialogHeader>
        <Input autoFocus value={value} placeholder="输入标签，用逗号分隔" onChange={(event) => setValue(event.target.value)} />
        <div className="flex flex-wrap gap-1">
          {allTags.map((tag) => (
            <Button key={tag} variant={tags.includes(tag) ? "secondary" : "outline"} size="sm" onClick={() => {
              const next = tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag];
              setValue(next.join(", "));
            }}>{tag}</Button>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={() => onSave(tags)}>保存标签</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export async function openAsset(projectId: string, asset: AssetRecord) {
  if (asset.trashed) return;
  const resolved = await bridge?.resolveAsset(projectId, asset.id);
  if (resolved) openFilePanel(resolved.absolutePath, asset.mimeType, asset.name);
}

export function AssetPanel() {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | AssetRecord["source"] | "trash">("all");
  const [grid, setGrid] = useState(true);
  const [sort, setSort] = useState<"modified" | "name" | "size">("modified");
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<string[]>([""]);
  const [folder, setFolder] = useState("all");
  const [type, setType] = useState<"all" | "image" | "document" | "media" | "other">("all");
  const [tag, setTag] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tagging, setTagging] = useState<AssetRecord | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId || !bridge) return;
    setLoading(true);
    try {
      const [nextAssets, nextFolders] = await Promise.all([
        bridge.listAssets(projectId),
        bridge.listAssetFolders(projectId),
      ]);
      setAssets(nextAssets);
      setFolders(nextFolders);
    } catch (error) {
      toast.error("读取项目资产失败", { description: String(error) });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () =>
      assets.filter((asset) => {
        if (source === "trash" ? !asset.trashed : asset.trashed) return false;
        if (source !== "all" && source !== "trash" && asset.source !== source) return false;
        if (favoritesOnly && !asset.favorite) return false;
        if (tag !== "all" && !asset.tags.includes(tag)) return false;
        const normalizedPath = asset.relativePath.replace(/\\/g, "/");
        const normalizedFolder = folder.replace(/\\/g, "/");
        if (folder !== "all" && (folder === "" ? normalizedPath.includes("/") : !normalizedPath.startsWith(`${normalizedFolder}/`))) return false;
        const assetType = asset.mimeType.startsWith("image/")
          ? "image"
          : asset.mimeType.startsWith("audio/") || asset.mimeType.startsWith("video/")
            ? "media"
            : asset.mimeType.startsWith("text/") || asset.mimeType.includes("pdf") || asset.mimeType.includes("json")
              ? "document"
              : "other";
        if (type !== "all" && assetType !== type) return false;
        const haystack = `${asset.name} ${asset.relativePath} ${asset.tags.join(" ")}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      }).sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name, "zh-CN")
          : sort === "size"
            ? b.size - a.size
            : b.modifiedAt - a.modifiedAt
      ),
    [assets, query, source, sort, favoritesOnly, tag, folder, type]
  );
  const allTags = [...new Set(assets.flatMap((asset) => asset.tags))].sort();

  const mutate = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error("资产操作失败", { description: String(error) });
    }
  };

  if (!projectId) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先选择项目</div>;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} className="h-8 pl-8" placeholder="搜索名称、路径或标签…" onChange={(event) => setQuery(event.target.value)} />
        </div>
        {(["all", "ai", "attachment", "import", "trash"] as const).map((value) => (
          <Button key={value} variant={source === value ? "secondary" : "ghost"} size="sm" onClick={() => setSource(value)}>
            {value === "all" ? "全部" : value === "trash" ? "回收站" : sourceLabel[value]}
          </Button>
        ))}
        <select
          value={sort}
          className="h-8 rounded-md border bg-background px-2 text-xs"
          aria-label="资产排序"
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="modified">最近修改</option>
          <option value="name">按名称</option>
          <option value="size">按大小</option>
        </select>
        <select value={type} className="h-8 rounded-md border bg-background px-2 text-xs" onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="all">全部类型</option><option value="image">图片</option><option value="document">文档</option><option value="media">音视频</option><option value="other">其他</option>
        </select>
        <select value={folder} className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs" onChange={(event) => setFolder(event.target.value)}>
          <option value="all">全部文件夹</option>
          {folders.map((item) => <option key={item || "root"} value={item}>{item || "项目根目录"}</option>)}
        </select>
        <select value={tag} className="h-8 max-w-32 rounded-md border bg-background px-2 text-xs" onChange={(event) => setTag(event.target.value)}>
          <option value="all">全部标签</option>{allTags.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <Button variant={favoritesOnly ? "secondary" : "ghost"} size="icon-sm" title="只看收藏" onClick={() => setFavoritesOnly((value) => !value)}><Heart className={favoritesOnly ? "fill-primary text-primary" : ""} /></Button>
        <Button variant="ghost" size="icon-sm" title="刷新" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
        <Button variant="ghost" size="icon-sm" title={grid ? "列表视图" : "网格视图"} onClick={() => setGrid((value) => !value)}>{grid ? <List /> : <Grid2x2 />}</Button>
        <Button variant="outline" size="sm" onClick={() => void mutate(() => bridge!.importAssets(projectId))}><Import />导入</Button>
        <Button variant="outline" size="sm" onClick={() => {
          const name = window.prompt("新文件夹名称（可输入 设计/终稿 这样的层级）");
          if (name) void mutate(() => bridge!.createAssetFolder(projectId, name));
        }}><FolderPlus />新建文件夹</Button>
        {source === "trash" && visible.length > 0 && (
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => {
            if (window.confirm("永久清空当前项目回收站？此操作不可恢复。")) void mutate(() => bridge!.emptyAssetTrash(projectId));
          }}><Trash2 />清空</Button>
        )}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-3", grid ? "grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2" : "flex flex-col gap-1")}>
        {visible.map((asset) => (
          <div
            key={asset.id}
            className={cn("group border bg-card hover:border-primary/40", grid ? "rounded-xl p-3" : "flex items-center gap-3 rounded-lg px-3 py-2")}
            onDoubleClick={() => void openAsset(projectId, asset)}
          >
            <button className={cn("text-primary [&_svg]:size-6", grid ? "mb-3 flex size-12 items-center justify-center rounded-lg bg-primary/8" : "")} onClick={() => void openAsset(projectId, asset)}>
              <AssetThumbnail projectId={projectId} asset={asset} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{asset.name}</p>
              <p className="truncate text-[10px] text-muted-foreground" title={asset.relativePath}>{asset.relativePath}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[9px]">{sourceLabel[asset.source]}</Badge>
                {asset.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="text-[9px]">{tag}</Badge>)}
              </div>
            </div>
            <div className={cn("flex gap-0.5", grid && "mt-2 justify-end")}>
              {!asset.trashed ? (
                <>
                  <Button variant="ghost" size="icon-sm" title="收藏" onClick={() => void mutate(() => bridge!.updateAsset(projectId, asset.id, { favorite: !asset.favorite }))}>
                    <Heart className={asset.favorite ? "fill-primary text-primary" : ""} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="标签" onClick={() => setTagging(asset)}><Tags /></Button>
                  <select
                    aria-label={`移动 ${asset.name}`}
                    title="移动到文件夹"
                    className="h-7 max-w-24 rounded border bg-background px-1 text-[10px]"
                    value={asset.relativePath.replace(/[/\\][^/\\]+$/, "") === asset.relativePath ? "" : asset.relativePath.replace(/[/\\][^/\\]+$/, "")}
                    onChange={(event) => void mutate(() => bridge!.moveAsset(projectId, asset.id, event.target.value))}
                  >
                    {folders.map((item) => <option key={item || "root"} value={item}>{item || "根目录"}</option>)}
                  </select>
                  <Button variant="ghost" size="icon-sm" title="重命名" onClick={() => {
                    const name = window.prompt("新文件名", asset.name);
                    if (name && name !== asset.name) void mutate(() => bridge!.updateAsset(projectId, asset.id, { name }));
                  }}><FileText /></Button>
                  <Button variant="ghost" size="icon-sm" title="在目录中显示" onClick={() => void bridge?.revealAsset(projectId, asset.id)}><FolderOpen /></Button>
                  <Button variant="ghost" size="icon-sm" title="移入回收站" className="text-destructive" onClick={() => void mutate(() => bridge!.trashAsset(projectId, asset.id))}><Trash2 /></Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void mutate(() => bridge!.restoreAsset(projectId, asset.id))}><ArchiveRestore />恢复</Button>
              )}
            </div>
          </div>
        ))}
        {!loading && visible.length === 0 && (
          <div className="col-span-full flex min-h-48 items-center justify-center text-sm text-muted-foreground">没有匹配的项目资产</div>
        )}
      </div>
      {tagging && (
        <TagDialog
          asset={tagging}
          allTags={allTags}
          onClose={() => setTagging(null)}
          onSave={(tags) => void mutate(() => bridge!.updateAsset(projectId, tagging.id, { tags })).then(() => setTagging(null))}
        />
      )}
    </div>
  );
}
