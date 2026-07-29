import {
  BaseWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from "electron";

export type PopupWindowOptions = BrowserWindowConstructorOptions & {
  /** Electron 在 createWindow 回调中传入，必须复用以保留 window.opener。 */
  webContents?: WebContents;
};

export interface BrowserAuthPopup {
  webContents: WebContents;
  close(): void;
  onClosed(listener: () => void): void;
}

const ORIGIN_BAR_HEIGHT = 34;

function describeOrigin(rawUrl: string): { label: string; insecure: boolean } {
  try {
    const url = new URL(rawUrl);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    return {
      label: url.origin === "null" ? url.protocol : url.origin,
      insecure: url.protocol === "http:" && !loopback,
    };
  } catch {
    return { label: "未知来源", insecure: true };
  }
}

const ORIGIN_BAR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;height:100vh;padding:0 12px;
display:flex;align-items:center;gap:8px;overflow:hidden;border-bottom:1px solid rgba(127,127,127,.25);
font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#fff;color:#171717}
#warn{display:none;color:#c62828;font-weight:600}body.insecure #warn{display:inline}
#clip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl}
#origin{direction:ltr;unicode-bidi:isolate}@media(prefers-color-scheme:dark){
body{background:#111;color:#eee}#warn{color:#ff7777}}</style></head>
<body><span id="warn">不安全</span><span id="clip"><bdi id="origin"></bdi></span></body></html>`;

/**
 * 把 Chromium 预创建的 popup WebContents 嵌入带可信来源栏的原生窗口。
 * 复用 WebContents 是 OAuth/CAS 的关键：新建 contents 会丢失 opener、postMessage 和认证上下文。
 */
export function openBrowserAuthPopup(
  options: PopupWindowOptions,
  initialUrl: string
): BrowserAuthPopup {
  const width = Math.max(420, options.width ?? 860);
  const height = Math.max(320, options.height ?? 680);
  const initialOrigin = describeOrigin(initialUrl);
  const popup = new BaseWindow({
    width,
    height: height + ORIGIN_BAR_HEIGHT,
    useContentSize: true,
    minWidth: 420,
    minHeight: 320 + ORIGIN_BAR_HEIGHT,
    title: initialOrigin.label,
    ...(typeof options.x === "number" && typeof options.y === "number"
      ? { x: options.x, y: options.y }
      : {}),
  });

  const originView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contentView = new WebContentsView({
    ...(options.webContents ? { webContents: options.webContents } : {}),
    webPreferences: options.webPreferences,
  });
  popup.contentView.addChildView(contentView);
  popup.contentView.addChildView(originView);

  const layout = () => {
    const bounds = popup.getContentBounds();
    originView.setBounds({ x: 0, y: 0, width: bounds.width, height: ORIGIN_BAR_HEIGHT });
    contentView.setBounds({
      x: 0,
      y: ORIGIN_BAR_HEIGHT,
      width: bounds.width,
      height: Math.max(0, bounds.height - ORIGIN_BAR_HEIGHT),
    });
  };
  popup.on("resize", layout);
  popup.on("enter-full-screen", layout);
  popup.on("leave-full-screen", layout);
  layout();

  const contents = contentView.webContents;
  let currentUrl = initialUrl;
  const renderOrigin = () => {
    const info = describeOrigin(currentUrl);
    if (!popup.isDestroyed()) popup.setTitle(info.label);
    void originView.webContents
      .executeJavaScript(
        `document.body.classList.toggle("insecure",${JSON.stringify(info.insecure)});` +
          `document.getElementById("origin").textContent=${JSON.stringify(info.label)};`
      )
      .catch(() => undefined);
  };
  void originView.webContents.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(ORIGIN_BAR_HTML)}`
  );
  originView.webContents.once("did-finish-load", renderOrigin);

  const onNavigate = (_event: Electron.Event, url: string) => {
    currentUrl = url;
    renderOrigin();
  };
  contents.on("did-navigate", onNavigate);
  contents.on("did-navigate-in-page", onNavigate);
  contents.on("did-finish-load", renderOrigin);

  if (!options.webContents) {
    void contents.loadURL(initialUrl).catch(() => undefined);
  }

  const closedListeners: Array<() => void> = [];
  const closeWithContents = () => {
    if (!popup.isDestroyed()) popup.close();
  };
  contents.once("destroyed", closeWithContents);
  popup.once("closed", () => {
    if (!contents.isDestroyed()) {
      contents.off("destroyed", closeWithContents);
      contents.off("did-navigate", onNavigate);
      contents.off("did-navigate-in-page", onNavigate);
      contents.off("did-finish-load", renderOrigin);
      contents.close();
    }
    if (!originView.webContents.isDestroyed()) originView.webContents.close();
    for (const listener of closedListeners) listener();
  });

  return {
    webContents: contents,
    close: () => {
      if (!popup.isDestroyed()) popup.close();
    },
    onClosed: (listener) => closedListeners.push(listener),
  };
}
