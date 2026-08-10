import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Vite 把 worker 文件作为 URL 资源输出，避免在打包时把 worker inline 进主 bundle。
import PdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronRight,
  Loader2,
  Minus,
  PanelLeft,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;

/** PDF 大纲（目录）节点 */
interface OutlineNode {
  title: string;
  dest: string | any[] | null;
  items: OutlineNode[];
  /** 解析后的目标页码（1-based，未解析时为 undefined） */
  pageNumber?: number;
  /** 唯一 key，用于 React 渲染 */
  key: string;
}

interface PdfViewerProps {
  /** 本地文件路径，仅用于显示与日志 */
  path: string;
  /** 文件的 data URL（与 FileEditor 既有读取方式保持一致） */
  src: string;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 1.2;

export function PdfViewer({ path, src }: PdfViewerProps) {
  const fileName = useMemo(() => path.split(/[/\\]/).pop() ?? "PDF", [path]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  /** 已渲染的页 canvas 元素，按页码索引 */
  const pageCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  /** 当前正在进行的渲染任务，切换缩放时取消，避免同 canvas 重叠渲染竞争 */
  const currentRenderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [scale, setScale] = useState(1.2);
  const [fitWidth, setFitWidth] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeOutlineKey, setActiveOutlineKey] = useState<string | null>(null);
  /** 容器实际可用宽度，用于 fitWidth 时重新计算缩放 */
  const [containerWidth, setContainerWidth] = useState(0);

  // ---------- 加载文档 ----------
  useEffect(() => {
    let cancelled = false;
    let pdf: pdfjsLib.PDFDocumentProxy | null = null;
    setLoading(true);
    setError(null);
    setOutline([]);
    setNumPages(0);
    pageCanvasesRef.current.clear();

    (async () => {
      try {
        const data = await fetch(src).then((r) => r.arrayBuffer());
        if (cancelled) return;
        const task = pdfjsLib.getDocument({ data });
        pdf = await task.promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);

        // 解析大纲并预解析目标页码
        const rawOutline = await pdf.getOutline();
        if (cancelled) return;
        const resolved = await resolveOutline(rawOutline, pdf, "");
        if (cancelled) return;
        setOutline(resolved);
      } catch (e) {
        if (!cancelled) setError(String((e as Error)?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      pdf?.destroy();
      pdfRef.current = null;
    };
  }, [src]);

  // ---------- 渲染页面 ----------
  const renderPage = useCallback(
    async (canvas: HTMLCanvasElement, pageNum: number, pdf: pdfjsLib.PDFDocumentProxy, renderScale: number) => {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });
      const outputScale = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
      const renderTask = page.render({ canvas, viewport, transform });
      currentRenderTaskRef.current = renderTask;
      try {
        await renderTask.promise;
      } catch {
        // 被取消或竞态，忽略
      } finally {
        if (currentRenderTaskRef.current === renderTask) currentRenderTaskRef.current = null;
      }
    },
    [],
  );

  // ---------- 实际渲染（由 scale / fitWidth / 容器宽度 触发） ----------
  useEffect(() => {
    const pdf = pdfRef.current;
    const pages = pagesRef.current;
    const scroll = scrollRef.current;
    if (!pdf || !pages || !scroll || loading) return;

    let cancelled = false;
    (async () => {
      let renderScale = scale;
      if (fitWidth) {
        // 以第一页宽度为基准，适配容器宽度
        try {
          const firstPage = await pdf.getPage(1);
          const baseViewport = firstPage.getViewport({ scale: 1 });
          const available = scroll.clientWidth - 48; // 左右内边距
          if (baseViewport.width > 0 && available > 0) {
            renderScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, available / baseViewport.width));
          }
          if (!cancelled) {
            setScale((s) => (Math.abs(s - renderScale) > 0.001 ? renderScale : s));
          }
        } catch {
          /* ignore */
        }
      }

      // 顺序渲染每一页，避免并发导致 canvas 竞争
      for (let i = 1; i <= pdf.numPages; i++) {
        if (cancelled) return;
        let canvas = pageCanvasesRef.current.get(i);
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvas.className = "pdf-page-canvas";
          canvas.dataset.pageNumber = String(i);
          pageCanvasesRef.current.set(i, canvas);
          pages.appendChild(canvas);
        }
        try {
          await renderPage(canvas, i, pdf, renderScale);
        } catch (e) {
          if (!cancelled) console.error("渲染页面失败", i, e);
        }
      }
    })();

    return () => {
      cancelled = true;
      currentRenderTaskRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, fitWidth, scale, containerWidth, renderPage]);

  // 监听滚动容器宽度变化（侧边栏开关 / 窗口缩放）以重新适配宽度
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(scroll.clientWidth);
    });
    ro.observe(scroll);
    return () => ro.disconnect();
  }, [loading]);

  // ---------- 滚动时同步当前页码 ----------
  const handleScroll = useCallback(() => {
    const scroll = scrollRef.current;
    const pages = pagesRef.current;
    if (!scroll || !pages) return;
    const canvases = Array.from(
      pages.querySelectorAll<HTMLCanvasElement>(".pdf-page-canvas"),
    );
    const containerTop = scroll.scrollTop + scroll.clientHeight * 0.35;
    for (const canvas of canvases) {
      const top = canvas.offsetTop;
      const bottom = top + canvas.offsetHeight;
      if (top <= containerTop && bottom > containerTop) {
        const pageNum = Number(canvas.dataset.pageNumber);
        if (pageNum) setCurrentPage(pageNum);
        return;
      }
    }
  }, []);

  // ---------- 跳转到指定页 ----------
  const scrollToPage = useCallback((pageNum: number) => {
    const canvas = pageCanvasesRef.current.get(pageNum);
    const scroll = scrollRef.current;
    if (canvas && scroll) {
      scroll.scrollTo({ top: canvas.offsetTop - 12, behavior: "smooth" });
      setCurrentPage(pageNum);
    }
  }, []);

  const zoom = (updater: (s: number) => number) => {
    setFitWidth(false);
    setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, updater(s))));
  };

  const reset = () => {
    setFitWidth(true);
    setScale(1.2);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
      {/* 工具栏 */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background/80 px-2 backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={sidebarOpen ? "收起目录" : "展开目录"}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <PanelLeft className="size-4" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" aria-label="缩小" onClick={() => zoom((s) => s / SCALE_STEP)}>
          <Minus className="size-4" />
        </Button>
        <button
          className="min-w-14 rounded-md px-2 py-0.5 text-xs tabular-nums hover:bg-accent"
          onClick={reset}
          title="重置缩放"
        >
          {fitWidth ? "适应" : `${Math.round(scale * 100)}%`}
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="放大" onClick={() => zoom((s) => s * SCALE_STEP)}>
          <Plus className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="重置" onClick={reset}>
          <RotateCcw className="size-4" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={currentPage}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= numPages) scrollToPage(n);
            }}
            className="h-6 w-12 rounded-md border bg-transparent px-1 text-center tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span>/ {numPages || "-"}</span>
        </div>
        <span className="ml-auto truncate pr-2 text-xs text-muted-foreground" title={fileName}>
          {fileName}
        </span>
      </div>

      {/* 主体：左侧目录 + 右侧文档 */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <>
            <aside className="flex w-64 shrink-0 flex-col border-r bg-background">
              <div className="flex h-8 shrink-0 items-center px-3 text-xs font-medium text-muted-foreground">
                目录
              </div>
              <ScrollArea className="min-h-0 flex-1">
                {outline.length > 0 ? (
                  <OutlineTree
                    nodes={outline}
                    activeKey={activeOutlineKey}
                    onSelect={(node) => {
                      setActiveOutlineKey(node.key);
                      if (node.pageNumber) scrollToPage(node.pageNumber);
                    }}
                  />
                ) : (
                  <div className="px-3 py-4 text-xs text-muted-foreground">
                    {loading ? "正在读取目录…" : "此 PDF 无目录"}
                  </div>
                )}
              </ScrollArea>
            </aside>
          </>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm">加载中…</span>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>无法加载 PDF</span>
              <span className="text-xs">{error}</span>
            </div>
          ) : (
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto bg-muted/40"
            >
              <div
                ref={pagesRef}
                className="flex min-h-full flex-col items-center gap-3 py-4"
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        .pdf-page-canvas {
          border-radius: 6px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05);
          background: #fff;
          display: block;
        }
      `}</style>
    </div>
  );
}

// ---------- 大纲解析 ----------

async function resolveOutline(
  raw: any[],
  pdf: pdfjsLib.PDFDocumentProxy,
  keyPrefix: string,
): Promise<OutlineNode[]> {
  const result: OutlineNode[] = [];
  for (let i = 0; i < raw.length; i++) {
    const node = raw[i];
    const key = `${keyPrefix}${i}`;
    const pageNumber = await resolveOutlinePageNumber(node.dest, pdf);
    const children = node.items?.length
      ? await resolveOutline(node.items, pdf, `${key}-`)
      : [];
    result.push({
      title: node.title,
      dest: node.dest,
      items: children,
      pageNumber,
      key,
    });
  }
  return result;
}

async function resolveOutlinePageNumber(
  dest: string | any[] | null,
  pdf: pdfjsLib.PDFDocumentProxy,
): Promise<number | undefined> {
  if (!dest) return undefined;
  try {
    let resolved: any[];
    if (typeof dest === "string") {
      resolved = (await pdf.getDestination(dest)) ?? [];
    } else if (Array.isArray(dest)) {
      resolved = dest;
    } else {
      return undefined;
    }
    const ref = resolved[0];
    if (!ref) return undefined;
    const pageIndex = await pdf.getPageIndex(ref);
    return pageIndex + 1;
  } catch {
    return undefined;
  }
}

// ---------- 大纲树组件 ----------

function OutlineTree({
  nodes,
  activeKey,
  onSelect,
  level = 0,
}: {
  nodes: OutlineNode[];
  activeKey: string | null;
  onSelect: (node: OutlineNode) => void;
  level?: number;
}) {
  return (
    <ul className={cn("py-0.5", level === 0 ? "" : "ml-3 border-l")}>
      {nodes.map((node) => (
        <OutlineItem
          key={node.key}
          node={node}
          activeKey={activeKey}
          onSelect={onSelect}
          level={level}
        />
      ))}
    </ul>
  );
}

function OutlineItem({
  node,
  activeKey,
  onSelect,
  level,
}: {
  node: OutlineNode;
  activeKey: string | null;
  onSelect: (node: OutlineNode) => void;
  level: number;
}) {
  const [expanded, setExpanded] = useState(level < 1);
  const hasChildren = node.items.length > 0;
  const active = activeKey === node.key;
  return (
    <li>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded-sm py-1 pr-2 text-xs leading-tight hover:bg-accent",
          active && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: level === 0 ? 8 : 6 }}
        onClick={() => onSelect(node)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent-foreground/10"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "折叠" : "展开"}
          >
            <ChevronRight
              className={cn("size-3 transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span
          className="min-w-0 flex-1 truncate"
          title={node.title}
        >
          {node.title}
          {node.pageNumber ? (
            <span className="ml-1 text-muted-foreground/70 tabular-nums">
              {node.pageNumber}
            </span>
          ) : null}
        </span>
      </div>
      {hasChildren && expanded && (
        <OutlineTree
          nodes={node.items}
          activeKey={activeKey}
          onSelect={onSelect}
          level={level + 1}
        />
      )}
    </li>
  );
}