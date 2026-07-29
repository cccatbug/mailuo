import { createElement, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ExternalLink,
  Globe2,
  LoaderCircle,
  MoreVertical,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Md } from "@/features/ai/Markdown";
import { assistantSend } from "@/lib/ai";
import { bridge } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MailuoWebview extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): Promise<void>;
  executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
}

function normalizeAddress(value: string): string {
  const input = value.trim();
  if (!input) return "https://www.google.com";
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return input;
  if (/^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/|$)/i.test(input)) {
    return `https://${input}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

const EXTRACT_SCRIPT = `(() => {
  const root = document.querySelector('article, main, [role="main"]') || document.body;
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,nav,footer,header,svg').forEach((node) => node.remove());
  return {
    title: document.title,
    url: location.href,
    text: (clone.innerText || clone.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 30000)
  };
})()`;

export function BrowserPanel({ initialUrl }: { initialUrl?: string }) {
  const webviewRef = useRef<MailuoWebview | null>(null);
  const [url, setUrl] = useState(normalizeAddress(initialUrl ?? "https://www.google.com"));
  const [address, setAddress] = useState(url);
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return;
    const sync = (event?: Event) => {
      const detailUrl = (event as CustomEvent<{ url?: string }>)?.detail?.url;
      const next = detailUrl || view.getURL?.() || url;
      setAddress(next);
      setUrl(next);
      setCanBack(view.canGoBack?.() ?? false);
      setCanForward(view.canGoForward?.() ?? false);
    };
    const start = () => {
      setLoading(true);
      setLoadError(null);
    };
    const stop = (event: Event) => {
      setLoading(false);
      sync(event);
    };
    const failed = (event: Event) => {
      const failure = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      };
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      setLoading(false);
      setLoadError(failure.errorDescription || "页面加载失败");
    };
    view.addEventListener("did-start-loading", start);
    view.addEventListener("did-stop-loading", stop);
    view.addEventListener("did-navigate", sync);
    view.addEventListener("did-navigate-in-page", sync);
    view.addEventListener("did-fail-load", failed);
    return () => {
      view.removeEventListener("did-start-loading", start);
      view.removeEventListener("did-stop-loading", stop);
      view.removeEventListener("did-navigate", sync);
      view.removeEventListener("did-navigate-in-page", sync);
      view.removeEventListener("did-fail-load", failed);
    };
  }, [url]);

  const navigate = () => {
    const next = normalizeAddress(address);
    setUrl(next);
    setAddress(next);
    void webviewRef.current?.loadURL(next);
  };

  const askShu = async (preset?: string) => {
    const view = webviewRef.current;
    if (!view || asking) return;
    setAsking(true);
    setAnswer("");
    try {
      const page = await view.executeJavaScript<{
        title: string;
        url: string;
        text: string;
      }>(EXTRACT_SCRIPT);
      if (!page.text) throw new Error("当前页面没有可提取的正文");
      const request =
        preset ||
        question.trim() ||
        "请提炼这篇网页最重要的信息，并列出关键事实和可执行结论。";
      await assistantSend(
        `你是网页阅读助手“小枢”。请严格依据下方网页内容回答，不确定的信息要明确说明。\n\n任务：${request}\n\n标题：${page.title}\n网址：${page.url}\n\n网页正文：\n${page.text}`,
        "browser",
        [],
        {},
        null,
        (event) => {
          if (event.type === "delta") setAnswer((text) => text + event.text);
        }
      );
      setQuestion("");
    } catch (error) {
      toast.error("小枢读取网页失败", { description: String(error) });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2">
        <Button variant="ghost" size="icon-sm" disabled={!canBack} onClick={() => webviewRef.current?.goBack()}>
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!canForward} onClick={() => webviewRef.current?.goForward()}>
          <ArrowRight />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => webviewRef.current?.reload()}>
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        </Button>
        <form
          className="relative min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate();
          }}
        >
          <Globe2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={address}
            className="h-7 rounded-full bg-muted/50 pr-8 pl-8 text-xs"
            aria-label="网址或搜索"
            onChange={(event) => setAddress(event.target.value)}
          />
          <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </form>
        <Button variant="ghost" size="icon-sm" title="在系统浏览器打开" onClick={() => bridge?.openExternal(url)}>
          <ExternalLink />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="浏览器工具"><MoreVertical /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => webviewRef.current?.openDevTools()}>
              打开开发者工具
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const view = webviewRef.current;
              if (!view) return;
              if (view.isDevToolsOpened()) view.closeDevTools();
              else view.openDevTools();
            }}>
              切换网页控制台
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (!window.confirm("清除内置浏览器的 Cookie、缓存、登录态和认证信息？")) return;
                void bridge?.clearBrowserData().then(() => {
                  toast.success("浏览器会话数据已清除");
                  webviewRef.current?.reload();
                });
              }}
            >
              清除 Cookie 与缓存…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant={assistantOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-7"
          onClick={() => setAssistantOpen((open) => !open)}
        >
          <Sparkles className="text-primary" />
          小枢
        </Button>
      </div>
      {createElement("webview", {
        ref: (node: MailuoWebview | null) => {
          webviewRef.current = node;
        },
        src: url,
        partition: "persist:mailuo-browser",
        allowpopups: "true",
        className: "min-h-0 flex-1 bg-white",
      })}
      {loadError && (
        <div className="pointer-events-none absolute inset-x-3 top-13 z-10 rounded-lg border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {loadError}。如果这是扫码登录回跳，请确认对应客户端已安装；HTTP(S) 登录弹窗会保留在脉络浏览会话中。
        </div>
      )}
      {assistantOpen && (
        <aside className="absolute top-11 right-2 bottom-2 z-20 flex w-[min(380px,calc(100%-16px))] flex-col overflow-hidden rounded-xl border bg-background/96 shadow-2xl backdrop-blur">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
            <Bot className="size-4 text-primary" />
            <span className="text-sm font-medium">小枢 · 网页助手</span>
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setAssistantOpen(false)}>
              <X />
            </Button>
          </div>
          <div className="flex gap-1 border-b p-2">
            {[
              ["总结", "用 5 个要点总结当前网页，并给出一句话结论。"],
              ["提取", "提取人物、组织、日期、数字、链接及关键事实，分类列出。"],
              ["行动项", "从网页中提取可执行行动项，按优先级排列。"],
            ].map(([label, prompt]) => (
              <Button key={label} variant="outline" size="sm" disabled={asking} onClick={() => void askShu(prompt)}>
                {label}
              </Button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
            {answer ? <Md text={answer} /> : (
              <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
                小枢可以总结、提取或回答当前网页的问题
              </div>
            )}
          </div>
          <form
            className="flex gap-2 border-t p-2"
            onSubmit={(event) => {
              event.preventDefault();
              void askShu();
            }}
          >
            <Input value={question} placeholder="问问当前网页…" disabled={asking} onChange={(event) => setQuestion(event.target.value)} />
            <Button type="submit" size="sm" disabled={asking || !question.trim()}>
              {asking ? <LoaderCircle className="animate-spin" /> : "发送"}
            </Button>
          </form>
        </aside>
      )}
    </div>
  );
}
