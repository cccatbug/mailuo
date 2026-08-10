import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
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
  /** http(s) 流式 URL（本地文件服务，支持 Range）或 data: URL（web 回退） */
  src: string;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 1.2;
/** 渲染窗口：中心页前后各渲染若干页（跟随滚动） */
const RENDER_BEFORE = 2;
const RENDER_AFTER = 5;
/** 清理窗口：超出该范围（相对中心页）的页面会被移除，控制大 PDF 的 DOM/显存占用 */
const EVICT_BEFORE = 6;
const EVICT_AFTER = 10;
/** 单个 canvas 的像素上限，避免超大页面在 HiDPI 下超过 GPU 纹理上限 */
const MAX_CANVAS_PIXEL = 16384;

export function PdfViewer({ path, src }: PdfViewerProps) {
  const fileName = useMemo(() => path.split(/[/\\]/).pop() ?? "PDF", [path]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  /** 已渲染的页包装元素（含 canvas 与文本层），按页码索引 */
  const pageWrapsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  /** 每页渲染时所用的缩放，用于判断是否需要重绘 */
  const renderedScaleRef = useRef<Map<number, number>>(new Map());
  /** 每页的文本层实例（可取消） */
  const textLayersRef = useRef<Map<number, TextLayer>>(new Map());
  /** 当前正在进行的 canvas 渲染任务，切换缩放/清理时取消 */
  const currentRenderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  /** 渲染窗口的中心页，由滚动/跳页驱动 */
  const centerRef = useRef(1);
  /** 唤醒渲染主循环 */
  const wakeRef = useRef<(() => void) | null>(null);
  /** 已测得的页宽（scale=1 归一化），用于占位尺寸 */
  const baseWidthsRef = useRef<Map<number, number>>(new Map());
  /** 已测得的页高（scale=1 归一化），用于占位尺寸 */
  const baseHeightsRef = useRef<Map<number, number>>(new Map());
  /** 未渲染页的估算占位尺寸（scale=1），随已渲染页逐步修正 */
  const estBaseRef = useRef({ w: 595, h: 842 });
  /** 占位尺寸当前对应的渲染缩放 */
  const scaleAppliedRef = useRef(0);
  /** 占位估算更新的 rAF 句柄 */
  const estRafRef = useRef(0);
  const numPagesRef = useRef(0);
  const scrollRafRef = useRef(0);
  const busyTimerRef = useRef<number | null>(null);
  const currentPageRef = useRef(1);
  /** 渲染代际：缩放/换文档时递增，用于区分“被新循环取消”与“真实渲染失败” */
  const renderEpochRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [scale, setScale] = useState(1.2);
  const [fitWidth, setFitWidth] = useState(true);
  const [currentPage, setCurrentPageState] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeOutlineKey, setActiveOutlineKey] = useState<string | null>(null);
  /** 容器实际可用宽度，用于 fitWidth 时重新计算缩放 */
  const [containerWidth, setContainerWidth] = useState(0);
  /** 渲染忙（延迟显示，避免闪烁） */
  const [busy, setBusy] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const pageInputFocusedRef = useRef(false);

  const setCurrentPage = useCallback((n: number) => {
    currentPageRef.current = n;
    setCurrentPageState(n);
  }, []);

  // ---------- 加载文档 ----------
  useEffect(() => {
    let cancelled = false;
    let pdf: pdfjsLib.PDFDocumentProxy | null = null;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);
    setOutline([]);
    setNumPages(0);
    numPagesRef.current = 0;
    setCurrentPage(1);
    centerRef.current = 1;
    baseWidthsRef.current.clear();
    baseHeightsRef.current.clear();
    estBaseRef.current = { w: 595, h: 842 };
    scaleAppliedRef.current = 0;
    if (estRafRef.current) {
      cancelAnimationFrame(estRafRef.current);
      estRafRef.current = 0;
    }
    // 清理上一个文档的渲染现场（旧 canvas/文本层可能残留到新文档里）
    renderEpochRef.current++;
    currentRenderTaskRef.current?.cancel();
    currentRenderTaskRef.current = null;
    textLayersRef.current.forEach((t) => t.cancel());
    textLayersRef.current.clear();
    pageWrapsRef.current.forEach((w) => w.remove());
    pageWrapsRef.current.clear();
    renderedScaleRef.current.clear();
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    (async () => {
      try {
        if (src.startsWith("data:")) {
          // web 回退：整文件读入内存
          const data = await fetch(src).then((r) => r.arrayBuffer());
          if (cancelled) return;
          loadingTask = pdfjsLib.getDocument({ data });
        } else {
          // 流式加载：pdf.js 通过 Range 按需拉取，大文件也能打开
          loadingTask = pdfjsLib.getDocument({ url: src });
        }
        pdf = await loadingTask.promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        numPagesRef.current = pdf.numPages;

        // 取首页真实尺寸作为占位估算基准，让虚拟滚动条总高度尽量接近真实文档
        try {
          const firstViewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
          if (!cancelled) {
            estBaseRef.current = { w: firstViewport.width, h: firstViewport.height };
          }
        } catch {
          /* 保持默认 A4 尺寸 */
        }

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
      pdfRef.current = null;
      loadingTask?.destroy();
      pdf?.destroy();
    };
  }, [src, setCurrentPage]);

  // ---------- 占位尺寸：为全部页按当前缩放定宽高，滚动总高度由总页数决定 ----------
  const applySizes = useCallback((renderScale: number) => {
    const n = numPagesRef.current;
    if (!n) return;
    scaleAppliedRef.current = renderScale;
    const { w: ew, h: eh } = estBaseRef.current;
    for (let i = 1; i <= n; i++) {
      const wrap = pageWrapsRef.current.get(i);
      if (!wrap) continue;
      const bh = baseHeightsRef.current.get(i) ?? eh;
      const bw = baseWidthsRef.current.get(i) ?? ew;
      wrap.style.width = `${Math.floor(bw * renderScale)}px`;
      wrap.style.height = `${Math.floor(bh * renderScale)}px`;
    }
  }, []);

  /** 有新页测得真实尺寸后，rAF 去抖地修正估算值并刷新未渲染页占位 */
  const scheduleEstimateUpdate = useCallback(() => {
    if (estRafRef.current) return;
    estRafRef.current = requestAnimationFrame(() => {
      estRafRef.current = 0;
      const hs = baseHeightsRef.current;
      const ws = baseWidthsRef.current;
      if (!hs.size) return;
      let sh = 0;
      let sw = 0;
      hs.forEach((v) => (sh += v));
      ws.forEach((v) => (sw += v));
      estBaseRef.current = { h: sh / hs.size, w: sw / ws.size };
      const s = scaleAppliedRef.current;
      if (!s) return;
      const { w: ew, h: eh } = estBaseRef.current;
      for (let i = 1; i <= numPagesRef.current; i++) {
        if (hs.has(i)) continue;
        const wrap = pageWrapsRef.current.get(i);
        if (!wrap) continue;
        wrap.style.width = `${Math.floor(ew * s)}px`;
        wrap.style.height = `${Math.floor(eh * s)}px`;
      }
    });
  }, []);

  // ---------- 单页渲染（canvas + 文本层） ----------
  const renderPage = useCallback(async (pageNum: number, renderScale: number) => {
    const pdf = pdfRef.current;
    const pages = pagesRef.current;
    if (!pdf || !pages) return;
    const epoch = renderEpochRef.current;

    const page = await pdf.getPage(pageNum);
    if (!pdfRef.current || epoch !== renderEpochRef.current) return;
    const viewport = page.getViewport({ scale: renderScale });
    const outputScale =
      window.devicePixelRatio || 1;
    const safeDpr =
      viewport.width * outputScale > MAX_CANVAS_PIXEL ||
      viewport.height * outputScale > MAX_CANVAS_PIXEL
        ? Math.max(1, Math.floor(Math.min(MAX_CANVAS_PIXEL / viewport.width, MAX_CANVAS_PIXEL / viewport.height)))
        : outputScale;

    // 占位 wrapper 在加载后已全部创建，这里按需补上 canvas/文本层（回收时被移除，占位保留）
    const wrap = pageWrapsRef.current.get(pageNum);
    if (!wrap) return;
    let canvas = wrap.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      wrap.append(canvas);
    }
    let textDiv = wrap.querySelector<HTMLDivElement>(".textLayer");
    if (!textDiv) {
      textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      wrap.append(textDiv);
    }
    // 文本层按 --scale-factor 布局，必须先于 TextLayer 构造设置
    wrap.style.setProperty("--scale-factor", String(renderScale));
    // 占位尺寸与渲染结果完全一致，渲染完成时不会发生布局跳变
    wrap.style.width = `${Math.floor(viewport.width)}px`;
    wrap.style.height = `${Math.floor(viewport.height)}px`;

    canvas.width = Math.floor(viewport.width * safeDpr);
    canvas.height = Math.floor(viewport.height * safeDpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const transform = safeDpr !== 1 ? [safeDpr, 0, 0, safeDpr, 0, 0] : undefined;
    const renderTask = page.render({ canvas, viewport, transform });
    currentRenderTaskRef.current = renderTask;
    let renderFailed = false;
    try {
      await renderTask.promise;
    } catch {
      renderFailed = true;
    }
    if (currentRenderTaskRef.current === renderTask) currentRenderTaskRef.current = null;
    if (!pdfRef.current || pageWrapsRef.current.get(pageNum) !== wrap) return;
    if (renderFailed) {
      if (epoch !== renderEpochRef.current) return; // 被新渲染循环取消：交给新循环重试
      // 真实渲染失败：标记为已尝试，避免无限重试；缩放变化时会自然重试
      renderedScaleRef.current.set(pageNum, renderScale);
      return;
    }

    // 文本层：透明文本覆盖在 canvas 上，支持选中复制
    textLayersRef.current.get(pageNum)?.cancel();
    textDiv = wrap.querySelector<HTMLDivElement>(".textLayer")!;
    textDiv.replaceChildren();
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textDiv,
      viewport,
    });
    textLayersRef.current.set(pageNum, textLayer);
    try {
      await textLayer.render();
    } catch {
      /* 文本层失败不影响画布展示 */
    }
    renderedScaleRef.current.set(pageNum, renderScale);

    // 记录该页真实尺寸（归一化到 scale=1），用于修正未渲染页的占位尺寸
    if (!baseHeightsRef.current.has(pageNum)) {
      baseHeightsRef.current.set(pageNum, viewport.height / renderScale);
      baseWidthsRef.current.set(pageNum, viewport.width / renderScale);
      scheduleEstimateUpdate();
    }
  }, [scheduleEstimateUpdate]);

  const removePage = useCallback((pageNum: number) => {
    textLayersRef.current.get(pageNum)?.cancel();
    textLayersRef.current.delete(pageNum);
    renderedScaleRef.current.delete(pageNum);
    const wrap = pageWrapsRef.current.get(pageNum);
    if (!wrap) return;
    // 保留占位 wrapper：明确的宽高让滚动总高度不变，滚动条不抖动
    wrap.replaceChildren();
    const s = scaleAppliedRef.current || 1;
    const bh = baseHeightsRef.current.get(pageNum) ?? estBaseRef.current.h;
    const bw = baseWidthsRef.current.get(pageNum) ?? estBaseRef.current.w;
    wrap.style.width = `${Math.floor(bw * s)}px`;
    wrap.style.height = `${Math.floor(bh * s)}px`;
  }, []);

  // ---------- 跳转到指定页 ----------
  const scrollToPageElement = useCallback((pageNum: number, smooth: boolean) => {
    const wrap = pageWrapsRef.current.get(pageNum);
    const scroll = scrollRef.current;
    if (!wrap || !scroll) return;
    const top =
      wrap.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    scroll.scrollTo({ top: top - 12, behavior: smooth ? "smooth" : "auto" });
    setCurrentPage(pageNum);
  }, [setCurrentPage]);

  const scrollToPage = useCallback(
    (pageNum: number, smooth = true) => {
      const n = Math.max(1, Math.min(numPagesRef.current || 1, pageNum));
      // 占位恒存在，可直接跳转；渲染窗口随后由滚动位置驱动
      scrollToPageElement(n, smooth);
      centerRef.current = n;
      wakeRef.current?.();
      setCurrentPage(n);
    },
    [scrollToPageElement, setCurrentPage],
  );

  // ---------- 窗口渲染：渲染中心页附近的缺页，清理远处页面 ----------
  const renderWindow = useCallback(
    async (renderScale: number, isCancelled: () => boolean) => {
      const pages = pagesRef.current;
      if (!pages) return;
      const numPages = numPagesRef.current;
      let anyPending = true;

      // 跟随滚动中心渲染窗口；中心漂移超过 1 页则按新中心重新取窗
      while (anyPending) {
        if (isCancelled()) return;
        const center = centerRef.current;
        const start = Math.max(1, center - RENDER_BEFORE);
        const end = Math.min(numPages, center + RENDER_AFTER);
        anyPending = false;
        for (let i = start; i <= end; i++) {
          if (isCancelled()) return;
          if (Math.abs(centerRef.current - center) > 1) {
            anyPending = true;
            break;
          }
          if (pageWrapsRef.current.has(i) && renderedScaleRef.current.get(i) === renderScale) {
            continue;
          }
          if (!anyPending) {
            anyPending = true;
            if (busyTimerRef.current == null) {
              busyTimerRef.current = window.setTimeout(() => setBusy(true), 150);
            }
          }
          try {
            await renderPage(i, renderScale);
          } catch {
            /* 单页失败不阻塞其余页面 */
          }
        }
      }

      if (isCancelled()) return;
      const center = centerRef.current;
      for (const pageNum of Array.from(pageWrapsRef.current.keys())) {
        // 仅回收已渲染的页；占位 wrapper 保留以维持滚动条稳定
        if (
          renderedScaleRef.current.has(pageNum) &&
          (pageNum < center - EVICT_BEFORE || pageNum > center + EVICT_AFTER)
        ) {
          removePage(pageNum);
        }
      }

      if (busyTimerRef.current != null) {
        clearTimeout(busyTimerRef.current);
        busyTimerRef.current = null;
        setBusy(false);
      }

    },
    [removePage, renderPage],
  );

  // ---------- 渲染主循环（由 loading / scale / fitWidth / 容器宽度 触发） ----------
  useEffect(() => {
    const pdf = pdfRef.current;
    const pages = pagesRef.current;
    const scroll = scrollRef.current;
    if (!pdf || !pages || !scroll || loading) return;

    let cancelled = false;
    let renderScale = scale;

    (async () => {
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
      if (cancelled) return;

      // 虚拟滚动条基础：为全部页创建占位 wrapper 并按当前缩放定尺寸，
      // 滚动总高度从此由总页数决定，与已渲染页无关
      if (pageWrapsRef.current.size === 0) {
        const frag = document.createDocumentFragment();
        for (let i = 1; i <= numPagesRef.current; i++) {
          const wrap = document.createElement("div");
          wrap.className = "pdf-page-wrap";
          wrap.dataset.pageNumber = String(i);
          frag.append(wrap);
          pageWrapsRef.current.set(i, wrap);
        }
        pages.append(frag);
      }
      const scaleChanged = Math.abs(scaleAppliedRef.current - renderScale) > 1e-6;
      if (scaleAppliedRef.current === 0 || scaleChanged) {
        const anchorWrap = pageWrapsRef.current.get(centerRef.current);
        const rel = anchorWrap ? scroll.scrollTop - anchorWrap.offsetTop : 0;
        const prevScale = scaleAppliedRef.current;
        applySizes(renderScale);
        // 缩放变化时以中心页为锚点换算滚动位置，避免滚动条跳变
        if (anchorWrap && prevScale > 0 && scaleChanged) {
          scroll.scrollTop = anchorWrap.offsetTop + (rel * renderScale) / prevScale;
        }
      }

      while (!cancelled) {
        await renderWindow(renderScale, () => cancelled);
        if (cancelled) return;
        // 空闲：等待滚动/跳页唤醒
        await new Promise<void>((resolve) => {
          wakeRef.current = resolve;
        });
      }
    })();

    return () => {
      cancelled = true;
      renderEpochRef.current++;
      currentRenderTaskRef.current?.cancel();
      wakeRef.current?.();
      wakeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, fitWidth, scale, containerWidth, src, renderWindow, applySizes]);

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

  // ---------- 滚动：同步页码 + 驱动渲染窗口 ----------
  const handleScroll = useCallback(() => {
    cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      const pages = pagesRef.current;
      if (!scroll || !pages) return;
      const line = scroll.scrollTop + scroll.clientHeight * 0.35;
      const scrollTop = scroll.getBoundingClientRect().top;
      const wraps = Array.from(pages.querySelectorAll<HTMLDivElement>(".pdf-page-wrap"));

      let center = 1;
      let found = false;
      let lastNum = 1;
      let lastBottom = 0;
      for (const wrap of wraps) {
        const pageNum = Number(wrap.dataset.pageNumber);
        const top = wrap.getBoundingClientRect().top - scrollTop + scroll.scrollTop;
        const bottom = top + wrap.offsetHeight;
        if (top <= line && line < bottom) {
          center = pageNum;
          found = true;
          break;
        }
        if (bottom > lastBottom) {
          lastBottom = bottom;
          lastNum = pageNum;
        }
      }
      if (!found) {
        // 已滚过最后一页：定位到末页（占位恒存在，正常情况总能命中）
        center = lastNum;
      }

      centerRef.current = center;
      setCurrentPage(center);
      wakeRef.current?.();
    });
  }, [setCurrentPage]);

  // ---------- 键盘导航 ----------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, input, a, [contenteditable]")) return;
      const total = numPagesRef.current || 1;
      switch (e.key) {
        case "PageDown":
        case " ":
          e.preventDefault();
          scrollToPage(currentPageRef.current + 1, false);
          break;
        case "PageUp":
          e.preventDefault();
          scrollToPage(currentPageRef.current - 1, false);
          break;
        case "Home":
          e.preventDefault();
          scrollToPage(1, false);
          break;
        case "End":
          e.preventDefault();
          scrollToPage(total, false);
          break;
        case "ArrowDown":
          e.preventDefault();
          scrollRef.current?.scrollBy({ top: 80, behavior: "smooth" });
          break;
        case "ArrowUp":
          e.preventDefault();
          scrollRef.current?.scrollBy({ top: -80, behavior: "smooth" });
          break;
      }
    },
    [scrollToPage],
  );

  const zoom = (updater: (s: number) => number) => {
    setFitWidth(false);
    setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, updater(s))));
  };

  const reset = () => {
    setFitWidth(true);
    setScale(1.2);
  };

  const applyPageInput = () => {
    const n = Number(pageInput);
    const total = numPagesRef.current || 1;
    if (Number.isInteger(n) && n >= 1 && n <= total) {
      scrollToPage(n);
    } else {
      setPageInput(String(currentPageRef.current));
    }
  };

  // 页码输入框与当前页同步（输入中除外）
  useEffect(() => {
    if (!pageInputFocusedRef.current) setPageInput(String(currentPage));
  }, [currentPage]);

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
            value={pageInput}
            onFocus={() => {
              pageInputFocusedRef.current = true;
            }}
            onBlur={() => {
              pageInputFocusedRef.current = false;
              applyPageInput();
            }}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="h-6 w-12 rounded-md border bg-transparent px-1 text-center tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="跳转到页码"
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
              onKeyDown={handleKeyDown}
              tabIndex={0}
              className="h-full overflow-y-auto bg-muted/40 outline-none"
              role="region"
              aria-label="PDF 文档区域（支持键盘翻页）"
            >
              <div
                ref={pagesRef}
                className="flex min-h-full flex-col items-center gap-3 py-4"
              />
            </div>
          )}
          {busy && !loading && !error && (
            <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border bg-background/85 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
              <Loader2 className="size-3 animate-spin" />
              渲染中…
            </div>
          )}
        </div>
      </div>

      <style>{`
        .pdf-page-wrap {
          --user-unit: 1;
          --scale-round-x: 1px;
          --scale-round-y: 1px;
          --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
          position: relative;
          border-radius: 6px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05);
          background: #fff;
        }
        .pdf-page-canvas {
          border-radius: 6px;
          display: block;
        }
        .pdf-page-wrap .textLayer {
          position: absolute;
          inset: 0;
          overflow: clip;
          opacity: 1;
          line-height: 1;
          -webkit-text-size-adjust: none;
          text-size-adjust: none;
          forced-color-adjust: none;
          transform-origin: 0 0;
          caret-color: CanvasText;
          z-index: 0;
        }
        .pdf-page-wrap .textLayer :is(span, br) {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
        }
        .pdf-page-wrap .textLayer ::selection {
          background: rgba(0 0 255 / 0.25);
          background: color-mix(in srgb, AccentColor, transparent 75%);
        }
        .pdf-page-wrap .textLayer br::selection {
          background: transparent;
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
