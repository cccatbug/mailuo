import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  ChevronRight,
  Clock3,
  Copy,
  File,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2x2,
  Heart,
  Import,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { isSubmitKey, isTextEditingTarget } from "@/lib/keyboard";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { bridge } from "@/lib/bridge";
import { useAppStore } from "@/store/useAppStore";
import type { AssetRecord, AssetTagRecord } from "@/shared/assets";
import { openFilePanel } from "@/components/DockLayout";

const TAG_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];
const SOURCE_LABEL = { all: "全部来源", ai: "AI 产物", attachment: "附件", import: "导入" } as const;

type Scope = "all" | "recent" | "favorites" | "trash";
type EntryAction =
  | { type: "new-file" | "new-folder"; folder: string }
  | { type: "rename-file"; asset: AssetRecord }
  | { type: "rename-folder"; folder: string }
  | null;

function parentFolder(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function baseName(relativePath: string) {
  return relativePath.replace(/\\/g, "/").split("/").pop() ?? relativePath;
}

function directChild(folder: string, candidate: string) {
  const parent = parentFolder(candidate);
  return parent === folder;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

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
    void bridge
      ?.resolveAsset(projectId, asset.id)
      .then(({ absolutePath }) => bridge!.readImageDataUrl(absolutePath, asset.mimeType))
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(""));
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.mimeType, projectId]);
  if (!src) return <>{assetIcon(asset)}</>;
  return <img src={src} alt="" className="size-full object-cover" />;
}

function TextActionDialog({
  action,
  onClose,
  onSubmit,
}: {
  action: Exclude<EntryAction, null>;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const initial =
    action.type === "rename-file"
      ? action.asset.name
      : action.type === "rename-folder"
        ? baseName(action.folder)
        : action.type === "new-file"
          ? "未命名.md"
          : "未命名文件夹";
  const [value, setValue] = useState(initial);
  const title =
    action.type === "new-file"
      ? "新建文件"
      : action.type === "new-folder"
        ? "新建文件夹"
        : action.type === "rename-file"
          ? "重命名文件"
          : "重命名文件夹";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (isSubmitKey(event, { allowShift: true }) && value.trim())
              onSubmit(value.trim());
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  count,
  folders,
  onClose,
  onMove,
}: {
  count: number;
  folders: string[];
  onClose: () => void;
  onMove: (folder: string) => void;
}) {
  const [folder, setFolder] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>移动 {count} 个项目</DialogTitle></DialogHeader>
        <select
          autoFocus
          value={folder}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          onChange={(event) => setFolder(event.target.value)}
        >
          {folders.map((item) => <option key={item || "root"} value={item}>{item || "项目根目录"}</option>)}
        </select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => onMove(folder)}>移动</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignTagsDialog({
  assets,
  tags,
  onClose,
  onSave,
}: {
  assets: AssetRecord[];
  tags: AssetTagRecord[];
  onClose: () => void;
  onSave: (names: string[]) => void;
}) {
  const common = tags.filter((tag) => assets.every((asset) => asset.tags.includes(tag.name)));
  const [selected, setSelected] = useState(() => new Set(common.map((tag) => tag.name)));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>为 {assets.length} 个文件设置标签</DialogTitle></DialogHeader>
        <div className="grid max-h-72 grid-cols-2 gap-1 overflow-y-auto">
          {tags.map((tag) => (
            <label key={tag.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
              <Checkbox
                checked={selected.has(tag.name)}
                onCheckedChange={(checked) => setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(tag.name);
                  else next.delete(tag.name);
                  return next;
                })}
              />
              <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="truncate text-sm">{tag.name}</span>
            </label>
          ))}
          {tags.length === 0 && <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">请先在侧栏创建标签</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => onSave([...selected])}>应用</Button>
        </DialogFooter>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [folders, setFolders] = useState<string[]>([""]);
  const [tags, setTags] = useState<AssetTagRecord[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [folder, setFolder] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "gallery">(
    () => (localStorage.getItem("mailuo-assets-view") as "list" | "gallery") || "list"
  );
  const [sort, setSort] = useState<"modified" | "name" | "size">("modified");
  const [source, setSource] = useState<"all" | AssetRecord["source"]>("all");
  const [type, setType] = useState<"all" | "image" | "document" | "media" | "other">("all");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entryAction, setEntryAction] = useState<EntryAction>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "files"; ids: string[] } | { kind: "folder"; path: string } | null>(null);
  const [tagDraft, setTagDraft] = useState<{ tag?: AssetTagRecord; name: string; color: string } | null>(null);
  const lastSelected = useRef<string | null>(null);
  const clipboardRef = useRef<{ ids: string[]; cut: boolean } | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId || !bridge) return;
    setLoading(true);
    try {
      const library = await bridge.listAssetLibrary(projectId);
      setAssets(library.assets);
      setFolders(library.folders);
      setTags(library.tags);
      setSelected((current) => new Set([...current].filter((id) => library.assets.some((asset) => asset.id === id))));
    } catch (error) {
      toast.error("读取项目文件失败", { description: String(error) });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      await refresh();
      if (success) toast.success(success);
    } catch (error) {
      toast.error("文件操作失败", { description: String(error) });
    }
  }, [refresh]);

  const tagMap = useMemo(() => new Map(tags.map((item) => [item.name, item])), [tags]);
  const selectedAssets = useMemo(() => assets.filter((asset) => selected.has(asset.id)), [assets, selected]);
  const currentFolder = folder ?? "";

  const visibleAssets = useMemo(() => {
    const now = Date.now();
    return assets
      .filter((asset) => {
        if (scope === "trash") return asset.trashed;
        if (asset.trashed) return false;
        if (scope === "favorites" && !asset.favorite) return false;
        if (scope === "recent" && now - asset.modifiedAt > 1000 * 60 * 60 * 24 * 14) return false;
        if (folder !== null && !directChild(folder, asset.relativePath)) return false;
        if (tag && !asset.tags.includes(tag)) return false;
        if (source !== "all" && asset.source !== source) return false;
        const assetType = asset.mimeType.startsWith("image/")
          ? "image"
          : asset.mimeType.startsWith("audio/") || asset.mimeType.startsWith("video/")
            ? "media"
            : asset.mimeType.startsWith("text/") || asset.mimeType.includes("pdf") || asset.mimeType.includes("json")
              ? "document"
              : "other";
        if (type !== "all" && type !== assetType) return false;
        const haystack = `${asset.name} ${asset.relativePath} ${asset.tags.join(" ")}`.toLocaleLowerCase();
        return haystack.includes(query.toLocaleLowerCase());
      })
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name, "zh-CN")
          : sort === "size"
            ? b.size - a.size
            : b.modifiedAt - a.modifiedAt
      );
  }, [assets, folder, query, scope, sort, source, tag, type]);

  const visibleFolders = useMemo(() => {
    if (scope === "trash" || folder === null || query || tag) return [];
    return folders
      .filter((item) => item && directChild(folder, item))
      .sort((a, b) => baseName(a).localeCompare(baseName(b), "zh-CN"));
  }, [folder, folders, query, scope, tag]);

  const selectAsset = (asset: AssetRecord, event: React.MouseEvent) => {
    const ordered = visibleAssets.map((item) => item.id);
    setSelected((current) => {
      if (event.shiftKey && lastSelected.current) {
        const from = ordered.indexOf(lastSelected.current);
        const to = ordered.indexOf(asset.id);
        if (from >= 0 && to >= 0) {
          const next = new Set(event.metaKey || event.ctrlKey ? current : []);
          ordered.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((id) => next.add(id));
          return next;
        }
      }
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(current);
        if (next.has(asset.id)) next.delete(asset.id);
        else next.add(asset.id);
        lastSelected.current = asset.id;
        return next;
      }
      lastSelected.current = asset.id;
      return new Set([asset.id]);
    });
  };

  const moveSelected = (destination: string) => {
    if (!projectId) return;
    const items = selectedAssets;
    setMoveOpen(false);
    void mutate(async () => {
      for (const asset of items) await bridge!.moveAsset(projectId, asset.id, destination);
    }, `已移动 ${items.length} 个文件`);
  };

  const trashSelected = (ids = [...selected]) => {
    if (!projectId) return;
    void mutate(async () => {
      for (const id of ids) {
        if (scope === "trash") await bridge!.permanentlyDeleteAsset(projectId, id);
        else await bridge!.trashAsset(projectId, id);
      }
      setSelected(new Set());
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      if (!rootRef.current?.contains(document.activeElement)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLocaleLowerCase();
      if (mod && key === "a") {
        event.preventDefault();
        setSelected(new Set(visibleAssets.map((asset) => asset.id)));
      } else if (mod && (key === "c" || key === "x") && selected.size && scope !== "trash") {
        event.preventDefault();
        clipboardRef.current = { ids: [...selected], cut: key === "x" };
        toast.success(key === "x" ? "已剪切所选文件" : "已复制所选文件");
      } else if (mod && key === "v" && clipboardRef.current && scope !== "trash") {
        event.preventDefault();
        const clipboard = clipboardRef.current;
        void mutate(async () => {
          for (const id of clipboard.ids) {
            if (clipboard.cut) await bridge!.moveAsset(projectId!, id, currentFolder);
            else await bridge!.copyAsset(projectId!, id, currentFolder);
          }
          if (clipboard.cut) clipboardRef.current = null;
        }, `已粘贴 ${clipboard.ids.length} 个文件`);
      } else if ((event.key === "Delete" || (event.metaKey && event.key === "Backspace")) && selected.size) {
        event.preventDefault();
        setDeleteTarget({ kind: "files", ids: [...selected] });
      } else if (isSubmitKey(event, { allowShift: true }) && selectedAssets.length === 1 && projectId) {
        void openAsset(projectId, selectedAssets[0]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFolder, mutate, projectId, scope, selected, selectedAssets, visibleAssets]);

  if (!projectId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先选择项目</div>;
  }

  const openFolder = (next: string) => {
    setFolder(next);
    setScope("all");
    setTag(null);
    setSelected(new Set());
  };

  const submitEntryAction = (value: string) => {
    if (!entryAction) return;
    const action = entryAction;
    setEntryAction(null);
    if (action.type === "new-file") {
      void mutate(() => bridge!.createAssetFile(projectId, action.folder, value), "文件已创建");
    } else if (action.type === "new-folder") {
      const target = action.folder ? `${action.folder}/${value}` : value;
      void mutate(() => bridge!.createAssetFolder(projectId, target), "文件夹已创建");
    } else if (action.type === "rename-file") {
      void mutate(() => bridge!.updateAsset(projectId, action.asset.id, { name: value }), "文件已重命名");
    } else {
      void mutate(() => bridge!.renameAssetFolder(projectId, action.folder, value), "文件夹已重命名");
    }
  };

  const fileMenu = (asset: AssetRecord) => (
    <ContextMenuContent className="w-48">
      {asset.trashed ? (
        <>
          <ContextMenuItem onClick={() => void mutate(() => bridge!.restoreAsset(projectId, asset.id), "文件已恢复")}>
            <ArchiveRestore />恢复
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: "files", ids: [asset.id] })}>
            <Trash2 />永久删除
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onClick={() => void openAsset(projectId, asset)}><FolderOpen />打开</ContextMenuItem>
          <ContextMenuItem onClick={() => setEntryAction({ type: "rename-file", asset })}><Pencil />重命名</ContextMenuItem>
          <ContextMenuItem onClick={() => void mutate(() => bridge!.duplicateAsset(projectId, asset.id), "已创建副本")}><Copy />创建副本</ContextMenuItem>
          <ContextMenuItem onClick={() => {
            clipboardRef.current = { ids: [asset.id], cut: false };
            toast.success("已复制文件");
          }}><Copy />复制</ContextMenuItem>
          <ContextMenuItem onClick={() => {
            clipboardRef.current = { ids: [asset.id], cut: true };
            toast.success("已剪切文件");
          }}><File />剪切</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => {
            setSelected(new Set([asset.id]));
            setMoveOpen(true);
          }}><Folder />移动到…</ContextMenuItem>
          <ContextMenuItem onClick={() => {
            setSelected(new Set([asset.id]));
            setTagOpen(true);
          }}><Tags />设置标签…</ContextMenuItem>
          <ContextMenuItem onClick={() => void mutate(() => bridge!.updateAsset(projectId, asset.id, { favorite: !asset.favorite }))}>
            <Heart />{asset.favorite ? "取消收藏" : "收藏"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void bridge?.revealAsset(projectId, asset.id)}><FolderOpen />在目录中显示</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: "files", ids: [asset.id] })}>
            <Trash2 />移到回收站
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={rootRef}
          tabIndex={-1}
          className="asset-manager flex h-full min-w-0 overflow-hidden bg-background outline-none"
          onPointerDownCapture={(event) => {
            if (!isTextEditingTarget(event.target)) {
              rootRef.current?.focus({ preventScroll: true });
            }
          }}
        >
          <aside className="asset-sidebar flex w-48 shrink-0 flex-col overflow-hidden border-r bg-sidebar/65">
            <div className="px-2 pt-2">
              {([
                ["all", "全部文件", FolderOpen],
                ["recent", "最近使用", Clock3],
                ["favorites", "收藏", Heart],
                ["trash", "回收站", Trash2],
              ] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs",
                    scope === key && folder === null && !tag ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                  onClick={() => {
                    setScope(key);
                    setFolder(null);
                    setTag(null);
                    setSelected(new Set());
                  }}
                >
                  <Icon className="size-3.5" />{label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex min-h-0 flex-1 flex-col">
              <div className="flex h-7 items-center px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                文件夹
                <Button variant="ghost" size="icon-sm" className="ml-auto size-5" title="新建文件夹" onClick={() => setEntryAction({ type: "new-folder", folder: currentFolder })}>
                  <FolderPlus />
                </Button>
              </div>
              <div className="min-h-0 overflow-y-auto px-1">
                <button
                  className={cn("flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs", folder === "" ? "bg-accent font-medium" : "hover:bg-accent/60")}
                  onClick={() => openFolder("")}
                >
                  <Folder className="size-3.5 text-primary" />项目根目录
                </button>
                {folders.filter(Boolean).map((item) => (
                  <button
                    key={item}
                    className={cn("flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-xs", folder === item ? "bg-accent font-medium" : "hover:bg-accent/60")}
                    style={{ paddingLeft: 12 + (item.replace(/\\/g, "/").split("/").length - 1) * 12 }}
                    onClick={() => openFolder(item)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const ids = event.dataTransfer.getData("application/x-mailuo-assets").split(",").filter(Boolean);
                      if (ids.length) {
                        setSelected(new Set(ids));
                        void mutate(async () => {
                          for (const id of ids) await bridge!.moveAsset(projectId, id, item);
                        }, `已移动 ${ids.length} 个文件`);
                      }
                    }}
                  >
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    <Folder className="size-3.5 shrink-0 text-primary" />
                    <span className="truncate">{baseName(item)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t px-1 py-2">
              <div className="flex h-7 items-center px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                标签
                <Button variant="ghost" size="icon-sm" className="ml-auto size-5" title="新建标签" onClick={() => setTagDraft({ name: "", color: TAG_COLORS[tags.length % TAG_COLORS.length] })}>
                  <Tags />
                </Button>
              </div>
              <div className="max-h-36 overflow-y-auto">
                {tags.map((item) => (
                  <ContextMenu key={item.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        className={cn("flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-xs", tag === item.name ? "bg-accent font-medium" : "hover:bg-accent/60")}
                        onClick={() => {
                          setTag(item.name);
                          setFolder(null);
                          setScope("all");
                        }}
                      >
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="truncate">{item.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{assets.filter((asset) => !asset.trashed && asset.tags.includes(item.name)).length}</span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => setTagDraft({ tag: item, name: item.name, color: item.color })}><Pencil />编辑标签</ContextMenuItem>
                      <ContextMenuItem variant="destructive" onClick={() => void mutate(() => bridge!.deleteAssetTag(projectId, item.id))}><Trash2 />删除标签</ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2">
              <div className="relative min-w-28 flex-1">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} className="h-7 rounded-full bg-muted/45 pr-3 pl-8 text-xs" placeholder="搜索文件、路径或标签" onChange={(event) => setQuery(event.target.value)} />
              </div>
              <Button variant="ghost" size="icon-sm" title="刷新" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
              <Button variant="ghost" size="icon-sm" title={view === "list" ? "画廊视图" : "列表视图"} onClick={() => {
                const next = view === "list" ? "gallery" : "list";
                setView(next);
                localStorage.setItem("mailuo-assets-view", next);
              }}>{view === "list" ? <Grid2x2 /> : <List />}</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => void mutate(() => bridge!.importAssets(projectId))}><Import />导入文件…</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEntryAction({ type: "new-file", folder: currentFolder })}><FilePlus2 />新建文件</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEntryAction({ type: "new-folder", folder: currentFolder })}><FolderPlus />新建文件夹</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1">
                    <select value={source} className="h-7 w-full rounded border bg-background px-1 text-xs" onChange={(event) => setSource(event.target.value as typeof source)}>
                      {Object.entries(SOURCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                  <div className="px-2 py-1">
                    <select value={sort} className="h-7 w-full rounded border bg-background px-1 text-xs" onChange={(event) => setSort(event.target.value as typeof sort)}>
                      <option value="modified">最近修改</option><option value="name">按名称</option><option value="size">按大小</option>
                    </select>
                  </div>
                  <div className="px-2 py-1">
                    <select value={type} className="h-7 w-full rounded border bg-background px-1 text-xs" onChange={(event) => setType(event.target.value as typeof type)}>
                      <option value="all">全部类型</option><option value="image">图片</option><option value="document">文档</option><option value="media">音视频</option><option value="other">其他</option>
                    </select>
                  </div>
                  {scope === "trash" && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: "files", ids: visibleAssets.map((asset) => asset.id) })}><Trash2 />清空回收站</DropdownMenuItem></>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex h-8 shrink-0 items-center gap-1 border-b px-3 text-xs text-muted-foreground">
              <button onClick={() => {
                setFolder(null);
                setTag(null);
                setScope("all");
              }}>项目文件</button>
              {folder !== null && folder.split(/[/\\]/).filter(Boolean).map((part, index, parts) => {
                const next = parts.slice(0, index + 1).join("/");
                return <span key={next} className="flex items-center gap-1"><ChevronRight className="size-3" /><button className="max-w-28 truncate hover:text-foreground" onClick={() => openFolder(next)}>{part}</button></span>;
              })}
              {tag && <><ChevronRight className="size-3" /><span>{tag}</span></>}
              <span className="ml-auto">{visibleFolders.length + visibleAssets.length} 项</span>
            </div>

            {selected.size > 0 && (
              <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-accent/40 px-3 text-xs">
                <span className="mr-2 font-medium">已选择 {selected.size} 项</span>
                {scope !== "trash" && <>
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => setMoveOpen(true)}><Folder />移动</Button>
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => setTagOpen(true)}><Tags />标签</Button>
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => void mutate(async () => {
                    for (const asset of selectedAssets) await bridge!.updateAsset(projectId, asset.id, { favorite: true });
                  }, "已收藏所选文件")}><Heart />收藏</Button>
                </>}
                <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => setDeleteTarget({ kind: "files", ids: [...selected] })}><Trash2 />{scope === "trash" ? "永久删除" : "删除"}</Button>
                <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setSelected(new Set())}>取消选择</Button>
              </div>
            )}

            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto",
                view === "list" ? "p-1.5" : "grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-2 p-3"
              )}
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelected(new Set());
              }}
            >
              {view === "list" && (visibleFolders.length > 0 || visibleAssets.length > 0) && (
                <div className="asset-columns grid h-7 grid-cols-[minmax(150px,1fr)_minmax(90px,180px)_100px_78px] items-center px-2 text-[10px] text-muted-foreground">
                  <span>名称</span><span>标签</span><span>修改时间</span><span className="text-right">大小</span>
                </div>
              )}
              {visibleFolders.map((item) => (
                <ContextMenu key={item}>
                  <ContextMenuTrigger asChild>
                    <div
                      className={cn("group border border-transparent hover:bg-accent/55", view === "list" ? "asset-row grid h-9 grid-cols-[minmax(150px,1fr)_minmax(90px,180px)_100px_78px] items-center rounded-md px-2" : "rounded-xl border-border bg-card p-3")}
                      onDoubleClick={() => openFolder(item)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Folder className="size-4 shrink-0 fill-primary/15 text-primary" />
                        <span className="truncate text-sm">{baseName(item)}</span>
                      </div>
                      {view === "list" && <><span /><span /><span /></>}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => openFolder(item)}><FolderOpen />打开</ContextMenuItem>
                    <ContextMenuItem onClick={() => setEntryAction({ type: "rename-folder", folder: item })}><Pencil />重命名</ContextMenuItem>
                    <ContextMenuItem onClick={() => void mutate(() => bridge!.duplicateAssetFolder(projectId, item), "已创建文件夹副本")}><Copy />创建副本</ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger><Folder />移动到</ContextMenuSubTrigger>
                      <ContextMenuSubContent className="max-h-64 overflow-y-auto">
                        {folders.filter((target) => target !== item && !target.startsWith(`${item}/`)).map((target) => (
                          <ContextMenuItem key={target || "root"} onClick={() => void mutate(() => bridge!.moveAssetFolder(projectId, item, target), "文件夹已移动")}>{target || "项目根目录"}</ContextMenuItem>
                        ))}
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: "folder", path: item })}><Trash2 />移到回收站</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
              {visibleAssets.map((asset) => {
                const active = selected.has(asset.id);
                return (
                  <ContextMenu key={asset.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        draggable={!asset.trashed}
                        className={cn(
                          "group border transition-colors",
                          active ? "border-primary/35 bg-primary/8" : "border-transparent hover:bg-accent/55",
                          view === "list"
                            ? "asset-row grid min-h-10 grid-cols-[minmax(150px,1fr)_minmax(90px,180px)_100px_78px] items-center rounded-md px-2"
                            : "overflow-hidden rounded-xl border-border bg-card"
                        )}
                        onClick={(event) => selectAsset(asset, event)}
                        onDoubleClick={() => void openAsset(projectId, asset)}
                        onDragStart={(event) => {
                          const ids = selected.has(asset.id) ? [...selected] : [asset.id];
                          event.dataTransfer.setData("application/x-mailuo-assets", ids.join(","));
                        }}
                      >
                        {view === "gallery" && (
                          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted text-primary [&_svg]:size-10">
                            <AssetThumbnail projectId={projectId} asset={asset} />
                          </div>
                        )}
                        <div className={cn("min-w-0", view === "list" ? "flex items-center gap-2" : "p-2.5")}>
                          {view === "list" && <span className="flex size-5 shrink-0 items-center justify-center text-primary [&_svg]:size-4"><AssetThumbnail projectId={projectId} asset={asset} /></span>}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{asset.name}</p>
                            {view === "gallery" && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{asset.relativePath}</p>}
                          </div>
                          {asset.favorite && <Heart className="ml-auto size-3 shrink-0 fill-primary text-primary" />}
                        </div>
                        <div className={cn("flex min-w-0 items-center gap-1", view === "gallery" && "px-2.5 pb-2.5")}>
                          {asset.tags.slice(0, view === "list" ? 2 : 3).map((name) => (
                            <Badge key={name} variant="outline" className="min-w-0 gap-1 px-1.5 text-[9px]">
                              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tagMap.get(name)?.color ?? "#94a3b8" }} />
                              <span className="truncate">{name}</span>
                            </Badge>
                          ))}
                          {asset.tags.length > (view === "list" ? 2 : 3) && <span className="text-[9px] text-muted-foreground">+{asset.tags.length - (view === "list" ? 2 : 3)}</span>}
                        </div>
                        {view === "list" && <>
                          <span className="truncate text-[10px] text-muted-foreground">{formatDate(asset.modifiedAt)}</span>
                          <span className="text-right text-[10px] text-muted-foreground">{formatSize(asset.size)}</span>
                        </>}
                      </div>
                    </ContextMenuTrigger>
                    {fileMenu(asset)}
                  </ContextMenu>
                );
              })}
              {!loading && visibleFolders.length === 0 && visibleAssets.length === 0 && (
                <div className="col-span-full flex min-h-56 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <FolderOpen className="size-8 opacity-40" />
                  没有匹配的项目文件
                </div>
              )}
            </div>
          </main>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => setEntryAction({ type: "new-file", folder: currentFolder })}><FilePlus2 />新建文件</ContextMenuItem>
        <ContextMenuItem onClick={() => setEntryAction({ type: "new-folder", folder: currentFolder })}><FolderPlus />新建文件夹</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void mutate(() => bridge!.importAssets(projectId))}><Import />导入文件…</ContextMenuItem>
        <ContextMenuItem
          disabled={!clipboardRef.current || scope === "trash"}
          onClick={() => {
            const clipboard = clipboardRef.current;
            if (!clipboard) return;
            void mutate(async () => {
              for (const id of clipboard.ids) {
                if (clipboard.cut) await bridge!.moveAsset(projectId, id, currentFolder);
                else await bridge!.copyAsset(projectId, id, currentFolder);
              }
              if (clipboard.cut) clipboardRef.current = null;
            }, `已粘贴 ${clipboard.ids.length} 个文件`);
          }}
        ><Copy />粘贴</ContextMenuItem>
        <ContextMenuItem onClick={() => void refresh()}><RefreshCw />刷新</ContextMenuItem>
      </ContextMenuContent>

      {entryAction && <TextActionDialog key={`${entryAction.type}-${"folder" in entryAction ? entryAction.folder : entryAction.type === "rename-file" ? entryAction.asset.id : ""}`} action={entryAction} onClose={() => setEntryAction(null)} onSubmit={submitEntryAction} />}
      {moveOpen && <MoveDialog count={selectedAssets.length} folders={folders} onClose={() => setMoveOpen(false)} onMove={moveSelected} />}
      {tagOpen && <AssignTagsDialog assets={selectedAssets} tags={tags} onClose={() => setTagOpen(false)} onSave={(names) => {
        setTagOpen(false);
        void mutate(() => bridge!.assignAssetTags(projectId, selectedAssets.map((asset) => asset.id), names, "set"), "标签已更新");
      }} />}
      {tagDraft && (
        <Dialog open onOpenChange={(open) => !open && setTagDraft(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{tagDraft.tag ? "编辑标签" : "新建标签"}</DialogTitle></DialogHeader>
            <Input autoFocus value={tagDraft.name} placeholder="标签名称" onChange={(event) => setTagDraft({ ...tagDraft, name: event.target.value })} />
            <div className="flex gap-2">
              {TAG_COLORS.map((color) => <button key={color} aria-label={color} className={cn("size-7 rounded-full border-2", tagDraft.color === color ? "border-foreground" : "border-transparent")} style={{ backgroundColor: color }} onClick={() => setTagDraft({ ...tagDraft, color })} />)}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTagDraft(null)}>取消</Button>
              <Button disabled={!tagDraft.name.trim()} onClick={() => {
                const draft = tagDraft;
                setTagDraft(null);
                void mutate(() => draft.tag
                  ? bridge!.updateAssetTag(projectId, draft.tag.id, { name: draft.name, color: draft.color })
                  : bridge!.createAssetTag(projectId, draft.name, draft.color), "标签已保存");
              }}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{scope === "trash" ? "永久删除所选文件？" : "移到回收站？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {scope === "trash" ? "永久删除后无法恢复。" : deleteTarget?.kind === "folder" ? "文件夹及其中的文件将移到回收站。" : "可稍后从项目回收站恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => {
              const target = deleteTarget;
              setDeleteTarget(null);
              if (!target) return;
              if (target.kind === "folder") void mutate(() => bridge!.trashAssetFolder(projectId, target.path), "文件夹已移到回收站");
              else trashSelected(target.ids);
            }}>{scope === "trash" ? "永久删除" : "移到回收站"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ContextMenu>
  );
}
