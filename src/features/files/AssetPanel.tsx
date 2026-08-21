import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
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
  Info,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  SquareArrowOutUpRight,
  Tags,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { QuickLook } from "./QuickLook";

const TAG_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];
const SOURCE_LABEL = { all: "全部来源", ai: "AI 产物", attachment: "附件", import: "导入" } as const;
const ASSET_DRAG_TYPE = "application/x-mailuo-assets";

type Scope = "all" | "recent" | "favorites" | "trash";
type SortKey = "name" | "modified" | "size";
type EntryAction = { type: "new-file" | "new-folder"; folder: string } | null;
type RenameTarget = { type: "asset"; asset: AssetRecord } | { type: "folder"; path: string };

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

function formatFullDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
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

/** 行内重命名输入框：自动聚焦、只选中主文件名（不含扩展名）、Enter 提交 / Esc 取消。 */
function InlineRenameInput({
  defaultValue,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = defaultValue.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : defaultValue.length);
  }, [defaultValue]);
  return (
    <Input
      ref={inputRef}
      value={value}
      className="h-6.5 px-1.5 text-xs"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          if (value.trim()) onCommit(value.trim());
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (value.trim()) onCommit(value.trim());
        else onCancel();
      }}
    />
  );
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
  const initial = action.type === "new-file" ? "未命名.md" : "未命名文件夹";
  const [value, setValue] = useState(initial);
  const title = action.type === "new-file" ? "新建文件" : "新建文件夹";
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
        <Select value={folder} onValueChange={setFolder}>
          <SelectTrigger className="w-full" aria-label="目标文件夹">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {folders.map((item) => (
              <SelectItem key={item || "root"} value={item}>{item || "项目根目录"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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

/** 列表视图的排序列头：点击切换排序键与升降序。 */
function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  className,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: 1 | -1;
  className?: string;
  onSort: (key: SortKey) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 text-[10px] transition-colors hover:text-foreground",
        className
      )}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {activeKey === sortKey ? (
        direction === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

export async function openAsset(projectId: string, asset: AssetRecord) {
  if (asset.trashed) return;
  const resolved = await bridge?.resolveAsset(projectId, asset.id);
  if (resolved) openFilePanel(resolved.absolutePath, asset.mimeType, asset.name);
}

/** 用系统默认应用打开（绕开内嵌预览）。 */
async function openWithSystemApp(projectId: string, asset: AssetRecord) {
  const resolved = await bridge?.resolveAsset(projectId, asset.id);
  if (!resolved) return;
  await bridge?.openPath(resolved.absolutePath).catch((error) =>
    toast.error("打开失败", { description: String(error) })
  );
}

/* ---------- 侧栏文件夹树 ---------- */

interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
}

function buildFolderTree(folders: string[]): FolderNode[] {
  const root: FolderNode = { path: "", name: "", children: [] };
  const sorted = folders
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  for (const folder of sorted) {
    const parts = folder.replace(/\\/g, "/").split("/");
    let node = root;
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      let child = node.children.find((item) => item.path === current);
      if (!child) {
        child = { path: current, name: part, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  return root.children;
}

export function AssetPanel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const stored = localStorage.getItem("mailuo-assets-sort");
    try {
      const parsed = stored ? (JSON.parse(stored) as { key?: SortKey }) : null;
      return parsed?.key === "name" || parsed?.key === "size" ? parsed.key : "modified";
    } catch {
      return "modified";
    }
  });
  const [sortDir, setSortDir] = useState<1 | -1>(() => {
    const stored = localStorage.getItem("mailuo-assets-sort");
    try {
      const parsed = stored ? (JSON.parse(stored) as { dir?: number }) : null;
      return parsed?.dir === 1 ? 1 : -1;
    } catch {
      return -1;
    }
  });
  const [source, setSource] = useState<"all" | AssetRecord["source"]>("all");
  const [type, setType] = useState<"all" | "image" | "document" | "media" | "other">("all");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entryAction, setEntryAction] = useState<EntryAction>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [infoAsset, setInfoAsset] = useState<AssetRecord | null>(null);
  const [quickLook, setQuickLook] = useState<{ index: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "files"; ids: string[] } | { kind: "folder"; path: string } | null>(null);
  const [tagDraft, setTagDraft] = useState<{ tag?: AssetTagRecord; name: string; color: string } | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [dragImport, setDragImport] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => {
      try {
        const raw = localStorage.getItem("mailuo-assets-collapsed");
        return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
      } catch {
        return new Set();
      }
    }
  );
  const lastSelected = useRef<string | null>(null);
  const clipboardRef = useRef<{ ids: string[]; cut: boolean } | null>(null);
  const typeAheadRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({
    text: "",
    timer: null,
  });
  // 导航历史（后退 / 前进 / 上一级）
  const historyRef = useRef<{ folder: string | null; scope: Scope; tag: string | null }[]>([]);
  const historyPosRef = useRef(-1);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  // 橡皮筋框选
  const marqueeStartRef = useRef<{ x: number; y: number; meta: boolean } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

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
    const direction = sortDir;
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
      .sort((a, b) => {
        if (sortKey === "name") return direction * a.name.localeCompare(b.name, "zh-CN");
        if (sortKey === "size") return direction * (a.size - b.size);
        return direction * (a.modifiedAt - b.modifiedAt);
      });
  }, [assets, folder, query, scope, sortDir, sortKey, source, tag, type]);

  const visibleFolders = useMemo(() => {
    if (scope === "trash" || folder === null || query || tag) return [];
    return folders
      .filter((item) => item && directChild(folder, item))
      .sort((a, b) => baseName(a).localeCompare(baseName(b), "zh-CN"));
  }, [folder, folders, query, scope, tag]);

  /* ---------- 导航：后退 / 前进 / 上一级 ---------- */

  const navigate = useCallback((entry: { folder: string | null; scope: Scope; tag: string | null }) => {
    setFolder(entry.folder);
    setScope(entry.scope);
    setTag(entry.tag);
    setSelected(new Set());
  }, []);

  const pushNav = useCallback((entry: { folder: string | null; scope: Scope; tag: string | null }) => {
    const history = historyRef.current.slice(0, historyPosRef.current + 1);
    history.push(entry);
    if (history.length > 60) history.shift();
    historyRef.current = history;
    historyPosRef.current = history.length - 1;
    setCanBack(historyPosRef.current > 0);
    setCanForward(false);
  }, []);

  const openFolder = useCallback((next: string | null) => {
    pushNav({ folder: next, scope: "all", tag: null });
    navigate({ folder: next, scope: "all", tag: null });
  }, [navigate, pushNav]);

  const openScope = useCallback((next: Scope) => {
    pushNav({ folder: null, scope: next, tag: null });
    navigate({ folder: null, scope: next, tag: null });
  }, [navigate, pushNav]);

  const openTag = useCallback((name: string) => {
    pushNav({ folder: null, scope: "all", tag: name });
    navigate({ folder: null, scope: "all", tag: name });
  }, [navigate, pushNav]);

  const goBack = useCallback(() => {
    if (historyPosRef.current <= 0) return;
    historyPosRef.current -= 1;
    navigate(historyRef.current[historyPosRef.current]);
    setCanForward(true);
    setCanBack(historyPosRef.current > 0);
  }, [navigate]);

  const goForward = useCallback(() => {
    if (historyPosRef.current >= historyRef.current.length - 1) return;
    historyPosRef.current += 1;
    navigate(historyRef.current[historyPosRef.current]);
    setCanBack(true);
    setCanForward(historyPosRef.current < historyRef.current.length - 1);
  }, [navigate]);

  const goUp = useCallback(() => {
    if (folder === null) return;
    openFolder(parentFolder(folder) || null);
  }, [folder, openFolder]);

  const setSort = useCallback((key: SortKey) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDir((currentDir) => (currentDir === 1 ? -1 : 1));
        return currentKey;
      }
      setSortDir(key === "name" ? 1 : -1);
      return key;
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("mailuo-assets-sort", JSON.stringify({ key: sortKey, dir: sortDir }));
  }, [sortKey, sortDir]);

  const toggleCollapsed = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      localStorage.setItem("mailuo-assets-collapsed", JSON.stringify([...next]));
      return next;
    });
  };

  /* ---------- 选择 ---------- */

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

  const scrollAssetIntoView = (id: string) => {
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-asset-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  /* ---------- 橡皮筋框选（拖拽空白处多选） ---------- */

  const onContainerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    marqueeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      meta: event.metaKey || event.ctrlKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onContainerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = marqueeStartRef.current;
    if (!start) return;
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    const width = Math.abs(event.clientX - start.x);
    const height = Math.abs(event.clientY - start.y);
    if (width < 4 && height < 4) {
      setMarqueeRect(null);
      return;
    }
    setMarqueeRect({ left, top, width, height });
  };

  const onContainerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = marqueeStartRef.current;
    marqueeStartRef.current = null;
    setMarqueeRect(null);
    if (!start) return;
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    const width = Math.abs(event.clientX - start.x);
    const height = Math.abs(event.clientY - start.y);
    if (width < 4 && height < 4) {
      // 空白处单击：清空选择（按住 ⌘/Ctrl 则保留）
      if (!start.meta) setSelected(new Set());
      return;
    }
    const rect = { left, top, right: left + width, bottom: top + height };
    const next = new Set(start.meta ? selected : []);
    containerRef.current?.querySelectorAll<HTMLElement>("[data-asset-id]").forEach((node) => {
      const el = node.getBoundingClientRect();
      if (
        rect.left < el.right &&
        rect.right > el.left &&
        rect.top < el.bottom &&
        rect.bottom > el.top
      ) {
        const id = node.dataset.assetId;
        if (id) next.add(id);
      }
    });
    setSelected(next);
    setSelected((current) => {
      const ids = [...current];
      lastSelected.current = ids.length ? ids[ids.length - 1]! : null;
      return current;
    });
  };

  /* ---------- 批量操作 ---------- */

  const moveSelected = (destination: string) => {
    if (!projectId) return;
    const items = selectedAssets;
    setMoveOpen(false);
    void mutate(async () => {
      await bridge!.batchAssets(projectId, "move", items.map((item) => item.id), destination);
    }, `已移动 ${items.length} 个文件`);
  };

  const trashSelected = (ids = [...selected]) => {
    if (!projectId) return;
    void mutate(async () => {
      if (scope === "trash") await bridge!.batchAssets(projectId, "delete", ids);
      else await bridge!.batchAssets(projectId, "trash", ids);
      setSelected(new Set());
    });
  };

  const duplicateSelected = useCallback(() => {
    if (!projectId || selectedAssets.length === 0) return;
    void mutate(async () => {
      await Promise.all(
        selectedAssets.map((asset) => bridge!.duplicateAsset(projectId, asset.id))
      );
    }, `已创建 ${selectedAssets.length} 个副本`);
  }, [mutate, projectId, selectedAssets]);

  const commitRename = (value: string) => {
    const target = renaming;
    setRenaming(null);
    if (!target || !value.trim() || !projectId) return;
    if (target.type === "asset") {
      void mutate(() => bridge!.updateAsset(projectId, target.asset.id, { name: value.trim() }), "已重命名");
    } else {
      void mutate(() => bridge!.renameAssetFolder(projectId, target.path, value.trim()), "文件夹已重命名");
    }
  };

  /* ---------- 键盘操作（系统文件管理器风格） ---------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      if (quickLook) return;
      if (!rootRef.current?.contains(document.activeElement)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLocaleLowerCase();
      if (mod && key === "a") {
        event.preventDefault();
        setSelected(new Set(visibleAssets.map((asset) => asset.id)));
      } else if (mod && key === "[" ) {
        event.preventDefault();
        goBack();
      } else if (mod && key === "]") {
        event.preventDefault();
        goForward();
      } else if (mod && key === "arrowup") {
        event.preventDefault();
        goUp();
      } else if (mod && key === "o" && selectedAssets.length) {
        event.preventDefault();
        void openAsset(projectId!, selectedAssets[0]);
      } else if (mod && key === "d" && selectedAssets.length) {
        event.preventDefault();
        duplicateSelected();
      } else if (mod && key === "i" && selectedAssets.length === 1) {
        event.preventDefault();
        setInfoAsset(selectedAssets[0]);
      } else if (mod && event.shiftKey && key === "n") {
        event.preventDefault();
        setEntryAction({ type: "new-folder", folder: currentFolder });
      } else if (mod && (key === "c" || key === "x") && selected.size && scope !== "trash") {
        event.preventDefault();
        clipboardRef.current = { ids: [...selected], cut: key === "x" };
        toast.success(key === "x" ? "已剪切所选文件" : "已复制所选文件");
      } else if (mod && key === "v" && clipboardRef.current && scope !== "trash") {
        event.preventDefault();
        const clipboard = clipboardRef.current;
        void mutate(async () => {
          await bridge!.batchAssets(
            projectId!,
            clipboard.cut ? "move" : "copy",
            clipboard.ids,
            currentFolder
          );
          if (clipboard.cut) clipboardRef.current = null;
        }, `已粘贴 ${clipboard.ids.length} 个文件`);
      } else if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) {
        if (selected.size) {
          event.preventDefault();
          setDeleteTarget({ kind: "files", ids: [...selected] });
        }
      } else if (event.key === "F2" && selectedAssets.length === 1 && scope !== "trash") {
        event.preventDefault();
        setRenaming({ type: "asset", asset: selectedAssets[0] });
      } else if (event.key === " ") {
        event.preventDefault();
        const target = selectedAssets[selectedAssets.length - 1] ?? visibleAssets[0];
        if (target) {
          setQuickLook({ index: Math.max(visibleAssets.indexOf(target), 0) });
        }
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const ordered = visibleAssets;
        if (ordered.length === 0) return;
        const currentIndex = selectedAssets.length
          ? ordered.findIndex((asset) => asset.id === selectedAssets[selectedAssets.length - 1]!.id)
          : -1;
        const nextIndex =
          event.key === "ArrowDown"
            ? currentIndex < 0 ? 0 : Math.min(currentIndex + 1, ordered.length - 1)
            : currentIndex < 0 ? ordered.length - 1 : Math.max(currentIndex - 1, 0);
        const next = ordered[nextIndex];
        lastSelected.current = next.id;
        setSelected(new Set([next.id]));
        scrollAssetIntoView(next.id);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (folder !== null) goUp();
      } else if (event.key === "ArrowRight" && selectedAssets.length) {
        event.preventDefault();
        void openAsset(projectId!, selectedAssets[selectedAssets.length - 1]!);
      } else if (isSubmitKey(event, { allowShift: true }) && selectedAssets.length === 1 && projectId) {
        void openAsset(projectId, selectedAssets[0]);
      } else if (event.key.length === 1 && !event.altKey && !mod) {
        // 打字跳选：连续输入快速定位以该串开头的文件
        const typeAhead = typeAheadRef.current;
        if (typeAhead.timer) clearTimeout(typeAhead.timer);
        typeAhead.text = `${typeAhead.text}${event.key}`.toLocaleLowerCase();
        typeAhead.timer = setTimeout(() => {
          typeAhead.text = "";
        }, 800);
        const match = visibleAssets.find((asset) =>
          asset.name.toLocaleLowerCase().startsWith(typeAhead.text)
        );
        if (match) {
          lastSelected.current = match.id;
          setSelected(new Set([match.id]));
          scrollAssetIntoView(match.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    currentFolder, duplicateSelected, folder, goBack, goForward, goUp, mutate,
    projectId, quickLook, scope, selected, selectedAssets, visibleAssets,
  ]);

  if (!projectId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">请先选择项目</div>;
  }

  const submitEntryAction = (value: string) => {
    if (!entryAction) return;
    const action = entryAction;
    setEntryAction(null);
    if (action.type === "new-file") {
      void mutate(() => bridge!.createAssetFile(projectId, action.folder, value), "文件已创建");
    } else {
      const target = action.folder ? `${action.folder}/${value}` : value;
      void mutate(() => bridge!.createAssetFolder(projectId, target), "文件夹已创建");
    }
  };

  const dropAssetIds = (event: React.DragEvent) => {
    const ids = event.dataTransfer.getData(ASSET_DRAG_TYPE).split(",").filter(Boolean);
    return ids;
  };

  const moveDragged = (event: React.DragEvent, destination: string) => {
    event.preventDefault();
    setDragTarget(null);
    const ids = dropAssetIds(event);
    if (!ids.length) return;
    void mutate(() => bridge!.batchAssets(projectId, "move", ids, destination), `已移动 ${ids.length} 个文件`);
  };

  const fileMenu = (asset: AssetRecord) => (
    <ContextMenuContent className="w-52">
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
          <ContextMenuItem onClick={() => setQuickLook({ index: Math.max(visibleAssets.indexOf(asset), 0) })}><Eye />快速预览（空格）</ContextMenuItem>
          <ContextMenuItem onClick={() => void openWithSystemApp(projectId, asset)}><SquareArrowOutUpRight />用系统应用打开</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setRenaming({ type: "asset", asset })}><Pencil />重命名</ContextMenuItem>
          <ContextMenuItem onClick={() => void mutate(() => bridge!.duplicateAsset(projectId, asset.id), "已创建副本")}><Copy />创建副本（⌘D）</ContextMenuItem>
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
          <ContextMenuItem onClick={() => setInfoAsset(asset)}><Info />显示简介（⌘I）</ContextMenuItem>
          <ContextMenuItem onClick={() => void bridge?.revealAsset(projectId, asset.id)}><FolderOpen />在目录中显示</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: "files", ids: [asset.id] })}>
            <Trash2 />移到回收站
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );

  const renderFolderTree = (nodes: FolderNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const collapsed = collapsedPaths.has(node.path);
      return (
        <div key={node.path}>
          <div
            className={cn(
              "group flex h-7 w-full min-w-0 items-center gap-1 rounded-md pr-2 text-left text-xs",
              folder === node.path ? "bg-accent font-medium" : "hover:bg-accent/60",
              dragTarget === node.path && "ring-2 ring-primary/60 bg-primary/10"
            )}
            style={{ paddingLeft: 4 + depth * 12 }}
            onClick={() => openFolder(node.path)}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
              event.preventDefault();
              setDragTarget(node.path);
            }}
            onDragLeave={() => setDragTarget((current) => (current === node.path ? null : current))}
            onDrop={(event) => moveDragged(event, node.path)}
          >
            {hasChildren ? (
              <button
                type="button"
                className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(node.path);
                }}
              >
                {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <Folder className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{node.name}</span>
          </div>
          {hasChildren && !collapsed && (
            <div>{renderFolderTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });

  const marqueeOverlay =
    marqueeRect && containerRef.current
      ? (() => {
          const containerRect = containerRef.current.getBoundingClientRect();
          return {
            left: marqueeRect.left - containerRect.left + containerRef.current.scrollLeft,
            top: marqueeRect.top - containerRect.top + containerRef.current.scrollTop,
            width: marqueeRect.width,
            height: marqueeRect.height,
          };
        })()
      : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={rootRef}
          tabIndex={-1}
          className="asset-manager relative flex h-full min-w-0 overflow-hidden bg-background outline-none"
          onPointerDownCapture={(event) => {
            if (!isTextEditingTarget(event.target)) {
              rootRef.current?.focus({ preventScroll: true });
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragImport(true);
            }
          }}
          onDragLeave={() => setDragImport(false)}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragImport(false);
            const paths = Array.from(event.dataTransfer.files)
              .map((file) => bridge?.getPathForFile(file))
              .filter((item): item is string => Boolean(item));
            if (paths.length === 0) {
              toast.error("无法读取拖入的文件路径（仅桌面应用支持从系统拖入）");
              return;
            }
            void mutate(
              () => bridge!.importAssetPaths(projectId, paths),
              `已导入 ${paths.length} 个文件`
            );
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
                  onClick={() => openScope(key)}
                >
                  <Icon className="size-3.5" />{label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex min-h-0 flex-1 flex-col">
              <div className="flex h-7 items-center px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                文件夹
                <Button variant="ghost" size="icon-sm" className="ml-auto size-5" title="新建文件夹（⇧⌘N）" onClick={() => setEntryAction({ type: "new-folder", folder: currentFolder })}>
                  <FolderPlus />
                </Button>
              </div>
              <div className="min-h-0 overflow-y-auto px-1">
                <div
                  className={cn(
                    "flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs",
                    folder === "" ? "bg-accent font-medium" : "hover:bg-accent/60",
                    dragTarget === "" && "ring-2 ring-primary/60 bg-primary/10"
                  )}
                  onClick={() => openFolder("")}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
                    event.preventDefault();
                    setDragTarget("");
                  }}
                  onDragLeave={() => setDragTarget((current) => (current === "" ? null : current))}
                  onDrop={(event) => moveDragged(event, "")}
                >
                  <Folder className="size-3.5 text-primary" />项目根目录
                </div>
                {renderFolderTree(buildFolderTree(folders))}
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
                        onClick={() => openTag(item.name)}
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
            <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
              <Button variant="ghost" size="icon-sm" disabled={!canBack} title="后退（⌘[）" onClick={goBack}><ArrowLeft /></Button>
              <Button variant="ghost" size="icon-sm" disabled={!canForward} title="前进（⌘]）" onClick={goForward}><ArrowRight /></Button>
              <Button variant="ghost" size="icon-sm" disabled={folder === null} title="上一级（⌘↑）" onClick={goUp}><ArrowUp /></Button>
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
                  <DropdownMenuItem onClick={() => setEntryAction({ type: "new-folder", folder: currentFolder })}><FolderPlus />新建文件夹（⇧⌘N）</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1">
                    <Select value={source} onValueChange={(value) => setSource(value as typeof source)}>
                      <SelectTrigger size="sm" className="w-full" aria-label="来源筛选">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(SOURCE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="px-2 py-1">
                    <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                      <SelectTrigger size="sm" className="w-full" aria-label="类型筛选">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem><SelectItem value="image">图片</SelectItem><SelectItem value="document">文档</SelectItem><SelectItem value="media">音视频</SelectItem><SelectItem value="other">其他</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scope === "trash" && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: "files", ids: visibleAssets.map((asset) => asset.id) })}><Trash2 />清空回收站</DropdownMenuItem></>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex h-8 shrink-0 items-center gap-1 border-b px-3 text-xs text-muted-foreground">
              <button onClick={() => openFolder(null)}>项目文件</button>
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
                    await Promise.all(selectedAssets.map((asset) => bridge!.updateAsset(projectId, asset.id, { favorite: true })));
                  }, "已收藏所选文件")}><Heart />收藏</Button>
                  <Button variant="ghost" size="sm" className="h-7" onClick={duplicateSelected}><Copy />副本</Button>
                </>}
                <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => setDeleteTarget({ kind: "files", ids: [...selected] })}><Trash2 />{scope === "trash" ? "永久删除" : "删除"}</Button>
                <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setSelected(new Set())}>取消选择</Button>
              </div>
            )}

            <div
              ref={containerRef}
              className={cn(
                "relative min-h-0 flex-1 overflow-y-auto",
                view === "list" ? "p-1.5" : "grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-2 p-3"
              )}
              onPointerDown={onContainerPointerDown}
              onPointerMove={onContainerPointerMove}
              onPointerUp={onContainerPointerUp}
            >
              {view === "list" && (visibleFolders.length > 0 || visibleAssets.length > 0) && (
                <div className="asset-columns grid h-7 grid-cols-[minmax(150px,1fr)_minmax(90px,180px)_100px_78px] items-center gap-1 px-2 text-[10px] text-muted-foreground">
                  <SortHeader label="名称" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={setSort} />
                  <span>标签</span>
                  <SortHeader label="修改时间" sortKey="modified" activeKey={sortKey} direction={sortDir} onSort={setSort} />
                  <SortHeader label="大小" sortKey="size" activeKey={sortKey} direction={sortDir} onSort={setSort} className="justify-self-end" />
                </div>
              )}
              {visibleFolders.map((item) => (
                <ContextMenu key={item}>
                  <ContextMenuTrigger asChild>
                    <div
                      className={cn(
                        "group border transition-colors",
                        dragTarget === item && "ring-2 ring-primary/60 bg-primary/10",
                        view === "list"
                          ? "asset-row grid h-9 grid-cols-[minmax(150px,1fr)_minmax(90px,180px)_100px_78px] items-center rounded-md px-2 hover:bg-accent/55"
                          : "rounded-xl border-border bg-card p-3 hover:bg-accent/55"
                      )}
                      onDoubleClick={() => openFolder(item)}
                      onDragOver={(event) => {
                        if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
                        event.preventDefault();
                        setDragTarget(item);
                      }}
                      onDragLeave={() => setDragTarget((current) => (current === item ? null : current))}
                      onDrop={(event) => moveDragged(event, item)}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Folder className="size-4 shrink-0 fill-primary/15 text-primary" />
                        {renaming?.type === "folder" && renaming.path === item ? (
                          <InlineRenameInput
                            defaultValue={baseName(item)}
                            onCommit={(value) => commitRename(value)}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span className="truncate text-sm">{baseName(item)}</span>
                        )}
                      </div>
                      {view === "list" && <><span /><span /><span /></>}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => openFolder(item)}><FolderOpen />打开</ContextMenuItem>
                    <ContextMenuItem onClick={() => setRenaming({ type: "folder", path: item })}><Pencil />重命名</ContextMenuItem>
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
                const renamingThis = renaming?.type === "asset" && renaming.asset.id === asset.id;
                return (
                  <ContextMenu key={asset.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        data-asset-id={asset.id}
                        draggable={!asset.trashed && !renamingThis}
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
                          event.dataTransfer.setData(ASSET_DRAG_TYPE, ids.join(","));
                        }}
                      >
                        {view === "gallery" && (
                          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted text-primary [&_svg]:size-10">
                            <AssetThumbnail projectId={projectId} asset={asset} />
                          </div>
                        )}
                        <div className={cn("min-w-0", view === "list" ? "flex items-center gap-2" : "p-2.5")}>
                          {view === "list" && <span className="flex size-5 shrink-0 items-center justify-center text-primary [&_svg]:size-4"><AssetThumbnail projectId={projectId} asset={asset} /></span>}
                          <div className="min-w-0 flex-1">
                            {renamingThis ? (
                              <InlineRenameInput
                                defaultValue={asset.name}
                                onCommit={(value) => commitRename(value)}
                                onCancel={() => setRenaming(null)}
                              />
                            ) : (
                              <p className="truncate text-sm font-medium">{asset.name}</p>
                            )}
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
              {marqueeOverlay && (
                <div
                  className="pointer-events-none absolute z-20 rounded-sm border border-primary/70 bg-primary/10"
                  style={{
                    left: marqueeOverlay.left,
                    top: marqueeOverlay.top,
                    width: marqueeOverlay.width,
                    height: marqueeOverlay.height,
                  }}
                />
              )}
            </div>
          </main>

          {dragImport && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-primary/5">
              <div className="flex items-center gap-2 rounded-full bg-background px-4 py-2 text-sm font-medium shadow-lg">
                <Import className="size-4 text-primary" />
                松开以导入文件（导入到 imports/ 目录）
              </div>
            </div>
          )}
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
              await bridge!.batchAssets(projectId, clipboard.cut ? "move" : "copy", clipboard.ids, currentFolder);
              if (clipboard.cut) clipboardRef.current = null;
            }, `已粘贴 ${clipboard.ids.length} 个文件`);
          }}
        ><Copy />粘贴</ContextMenuItem>
        <ContextMenuItem onClick={() => void refresh()}><RefreshCw />刷新</ContextMenuItem>
      </ContextMenuContent>

      {entryAction && <TextActionDialog key={`${entryAction.type}-${entryAction.folder}`} action={entryAction} onClose={() => setEntryAction(null)} onSubmit={submitEntryAction} />}
      {moveOpen && <MoveDialog count={selectedAssets.length} folders={folders} onClose={() => setMoveOpen(false)} onMove={moveSelected} />}
      {tagOpen && <AssignTagsDialog assets={selectedAssets} tags={tags} onClose={() => setTagOpen(false)} onSave={(names) => {
        setTagOpen(false);
        void mutate(() => bridge!.assignAssetTags(projectId, selectedAssets.map((asset) => asset.id), names, "set"), "标签已更新");
      }} />}
      {infoAsset && (
        <Dialog open onOpenChange={(open) => !open && setInfoAsset(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>显示简介</DialogTitle></DialogHeader>
            <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
              <dt className="text-muted-foreground">名称</dt><dd className="min-w-0 truncate">{infoAsset.name}</dd>
              <dt className="text-muted-foreground">类型</dt><dd className="break-all font-mono text-xs">{infoAsset.mimeType}</dd>
              <dt className="text-muted-foreground">大小</dt><dd>{formatSize(infoAsset.size)}</dd>
              <dt className="text-muted-foreground">创建</dt><dd>{formatFullDate(infoAsset.createdAt)}</dd>
              <dt className="text-muted-foreground">修改</dt><dd>{formatFullDate(infoAsset.modifiedAt)}</dd>
              <dt className="text-muted-foreground">位置</dt><dd className="break-all font-mono text-xs">{infoAsset.relativePath}</dd>
              <dt className="text-muted-foreground">来源</dt><dd>{SOURCE_LABEL[infoAsset.source]}</dd>
              <dt className="text-muted-foreground">标签</dt>
              <dd className="flex flex-wrap gap-1">
                {infoAsset.tags.length
                  ? infoAsset.tags.map((name) => (
                      <Badge key={name} variant="outline" className="gap-1 px-1.5 text-[10px]">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: tagMap.get(name)?.color ?? "#94a3b8" }} />
                        {name}
                      </Badge>
                    ))
                  : "无"}
              </dd>
              <dt className="text-muted-foreground">收藏</dt><dd>{infoAsset.favorite ? "是" : "否"}</dd>
            </dl>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                const asset = infoAsset;
                setInfoAsset(null);
                setRenaming({ type: "asset", asset });
              }}><Pencil />重命名</Button>
              <Button variant="outline" size="sm" onClick={() => void bridge?.revealAsset(projectId, infoAsset.id)}><FolderOpen />在目录中显示</Button>
              <Button size="sm" onClick={() => void openAsset(projectId, infoAsset)}><FolderOpen />打开</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
      {quickLook && (
        <QuickLook
          projectId={projectId}
          items={visibleAssets}
          initialIndex={quickLook.index}
          onClose={() => setQuickLook(null)}
        />
      )}
    </ContextMenu>
  );
}
