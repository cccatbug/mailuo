import {
  app,
  clipboard,
  dialog,
  Menu,
  session,
  shell,
  type BrowserWindow,
  type MessageBoxOptions,
  type Session,
  type WebContents,
} from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { openBrowserAuthPopup, type PopupWindowOptions } from "./browser-popup";

export const BROWSER_PARTITION = "persist:mailuo-browser";

const NAVIGATION_PROTOCOLS = new Set(["http:", "https:", "about:", "data:", "blob:"]);
const AUTOMATIC_PERMISSIONS = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
  "pointerLock",
]);
const PROMPT_PERMISSIONS = new Set([
  "media",
  "geolocation",
  "notifications",
  "clipboard-read",
  "storage-access",
]);
const FIDO_HID_USAGE_PAGE = 0xf1d0;

function isSecureOrigin(rawOrigin: string | undefined): boolean {
  if (!rawOrigin) return false;
  try {
    const url = new URL(rawOrigin);
    return (
      url.protocol === "https:" ||
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isFidoDevice(device: Electron.HIDDevice | unknown): device is Electron.HIDDevice {
  if (!device || typeof device !== "object") return false;
  const collections = (device as { collections?: unknown }).collections;
  return (
    Array.isArray(collections) &&
    collections.some(
      (collection) =>
        collection &&
        typeof collection === "object" &&
        (collection as { usagePage?: unknown }).usagePage === FIDO_HID_USAGE_PAGE
    )
  );
}

export interface BrowserSessionSnapshot {
  persistent: boolean;
  storagePath: string | null;
  cookieCount: number;
  cacheSize: number;
  userAgent: string;
}

export interface BrowserCookieImportResult {
  imported: number;
  skipped: number;
}

export function cleanElectronUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s+Electron\/\S+/i, "")
    .replace(/(\)\s+)\S+\s+(Chrome\/)/i, "$1$2");
}

export function isExternalBrowserProtocol(rawUrl: string): boolean {
  try {
    return !NAVIGATION_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return true;
  }
}

function isAuthenticationPopup(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return /(?:^|[./_-])(oauth|authorize|auth|login|signin|sso|saml|payment|checkout)(?:[./?&=_-]|$)/i.test(
      `${url.hostname}${url.pathname}`
    );
  } catch {
    return false;
  }
}

function installClientHintsOverride(browserSession: Session, userAgent: string) {
  const chrome = userAgent.match(/Chrome\/([\d.]+)/i);
  if (!chrome) return;
  const full = chrome[1];
  const major = full.split(".")[0];
  const secChUa = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not/A)Brand";v="24"`;
  const secChUaFull = `"Google Chrome";v="${full}", "Chromium";v="${full}", "Not/A)Brand";v="24.0.0.0"`;
  browserSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*/*"] },
    (details, callback) => {
      const headers = details.requestHeaders;
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === "sec-ch-ua") headers[key] = secChUa;
        if (lower === "sec-ch-ua-full-version-list") headers[key] = secChUaFull;
      }
      callback({ requestHeaders: headers });
    }
  );
}

export class BrowserSessionManager {
  private browserSession: Session | null = null;
  private readonly configuredContents = new Set<number>();
  private getParentWindow: (() => BrowserWindow | null) | null = null;
  private openManagedTab:
    | ((
        source: WebContents,
        url: string,
        disposition: string,
        userGesture: boolean
      ) => void)
    | null = null;

  setManagedTabHandler(
    handler:
      | ((
          source: WebContents,
          url: string,
          disposition: string,
          userGesture: boolean
        ) => void)
      | null
  ) {
    this.openManagedTab = handler;
  }

  initialize(getParentWindow: () => BrowserWindow | null) {
    if (this.browserSession) return;
    this.getParentWindow = getParentWindow;
    const browserSession = session.fromPartition(BROWSER_PARTITION, { cache: true });
    this.browserSession = browserSession;

    const userAgent = cleanElectronUserAgent(browserSession.getUserAgent());
    browserSession.setUserAgent(userAgent);
    installClientHintsOverride(browserSession, userAgent);
    this.installPermissions(browserSession);
    this.installDownloads(browserSession);
  }

  private installDownloads(browserSession: Session) {
    browserSession.on("will-download", (_event, item) => {
      const original = path.basename(item.getFilename()).replace(/[\u0000-\u001f]/g, "_");
      const parsed = path.parse(original || "download");
      let target = path.join(app.getPath("downloads"), original || "download");
      for (let index = 1; existsSync(target); index += 1) {
        target = path.join(
          app.getPath("downloads"),
          `${parsed.name || "download"}-${index}${parsed.ext}`
        );
      }
      item.setSavePath(target);
      this.getParentWindow?.()?.webContents.send("browser:download", {
        state: "started",
        filename: path.basename(target),
        path: target,
      });
      item.once("done", (_doneEvent, state) => {
        this.getParentWindow?.()?.webContents.send("browser:download", {
          state,
          filename: path.basename(target),
          path: target,
        });
      });
    });
  }

  private get session(): Session {
    if (!this.browserSession) throw new Error("浏览器 Session 尚未初始化");
    return this.browserSession;
  }

  get electronSession(): Session {
    return this.session;
  }

  private installPermissions(browserSession: Session) {
    browserSession.setPermissionCheckHandler((_contents, permission, _origin, details) => {
      if (permission === "hid") return isSecureOrigin(details?.securityOrigin);
      return AUTOMATIC_PERMISSIONS.has(permission);
    });
    browserSession.setPermissionRequestHandler(
      (_contents, permission, callback, details) => {
        if (AUTOMATIC_PERMISSIONS.has(permission)) return callback(true);
        if ((permission as string) === "hid") {
          return callback(isSecureOrigin(details.requestingUrl));
        }
        if (!PROMPT_PERMISSIONS.has(permission)) return callback(false);
        let origin = details.requestingUrl;
        try {
          origin = new URL(details.requestingUrl).origin;
        } catch {
          // 保留原值用于提示
        }
        const labels: Record<string, string> = {
          media: "使用摄像头或麦克风",
          geolocation: "获取位置",
          notifications: "发送通知",
          "clipboard-read": "读取剪贴板",
          "storage-access": "访问跨站登录信息",
        };
        const options = {
          type: "question",
          buttons: ["允许", "拒绝"],
          defaultId: 1,
          cancelId: 1,
          title: "网页权限请求",
          message: `${origin} 请求${labels[permission] ?? permission}`,
          detail: "权限只授予当前请求；请仅允许你信任的网站。",
        } satisfies MessageBoxOptions;
        const parent = this.getParentWindow?.();
        const request = parent
          ? dialog.showMessageBox(parent, options)
          : dialog.showMessageBox(options);
        void request
          .then(({ response }) => callback(response === 0))
          .catch(() => callback(false));
      }
    );
    browserSession.setDevicePermissionHandler((details) => {
      return (
        details.deviceType === "hid" &&
        isSecureOrigin(details.origin) &&
        isFidoDevice(details.device)
      );
    });
    browserSession.on("select-hid-device", (event, details, callback) => {
      event.preventDefault();
      if (!isSecureOrigin(details.frame?.url)) return callback();
      callback(details.deviceList.find(isFidoDevice)?.deviceId);
    });
    browserSession.on("select-webauthn-account", (event, details, callback) => {
      event.preventDefault();
      callback(details.accounts.length === 1 ? details.accounts[0].credentialId : null);
    });
  }

  configureContents(contents: WebContents, inherited = false) {
    if (this.configuredContents.has(contents.id)) return;
    this.configuredContents.add(contents.id);
    contents.setBackgroundThrottling(false);
    let lastUserGestureAt = 0;
    contents.on("before-mouse-event", (_event, mouse) => {
      if (mouse.type === "mouseDown") lastUserGestureAt = Date.now();
    });
    contents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown") lastUserGestureAt = Date.now();
    });

    const onCreatedWindow = (child: BrowserWindow) => {
      this.configureContents(child.webContents, true);
    };
    contents.on("did-create-window", onCreatedWindow);
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (isExternalBrowserProtocol(url)) {
        void shell.openExternal(url);
        return { action: "deny" };
      }
      if (this.openManagedTab && !isAuthenticationPopup(url)) {
        this.openManagedTab(
          contents,
          url,
          disposition,
          Date.now() - lastUserGestureAt < 1_000
        );
        return { action: "deny" };
      }
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 860,
          height: 680,
          minWidth: 420,
          minHeight: 320,
          autoHideMenuBar: true,
          backgroundColor: "#ffffff",
          frame: true,
          webPreferences: {
            partition: BROWSER_PARTITION,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
          },
        },
        createWindow: (options) => {
          const popup = openBrowserAuthPopup(options as PopupWindowOptions, url);
          this.configureContents(popup.webContents, true);
          const closeWithOpener = () => popup.close();
          contents.once("destroyed", closeWithOpener);
          popup.onClosed(() => {
            if (!contents.isDestroyed()) contents.off("destroyed", closeWithOpener);
          });
          return popup.webContents;
        },
      };
    });

    const navigationGuard = (event: Electron.Event, url: string) => {
      if (!isExternalBrowserProtocol(url)) return;
      event.preventDefault();
      void shell.openExternal(url);
    };
    contents.on("will-navigate", navigationGuard);
    contents.on("will-redirect", navigationGuard);
    contents.on("context-menu", (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (params.linkURL) {
        template.push(
          {
            label: "在新浏览器标签打开",
            click: () =>
              this.getParentWindow?.()?.webContents.send(
                "browser:open-tab",
                params.linkURL
              ),
          },
          {
            label: "复制链接",
            click: () => clipboard.writeText(params.linkURL),
          },
          { type: "separator" }
        );
      }
      if (params.selectionText) {
        template.push({
          label: "复制",
          role: "copy",
        });
      }
      if (params.isEditable) {
        template.push(
          { label: "剪切", role: "cut" },
          { label: "复制", role: "copy" },
          { label: "粘贴", role: "paste" },
          { type: "separator" }
        );
      }
      template.push(
        {
          label: "后退",
          enabled: contents.navigationHistory.canGoBack(),
          click: () => contents.navigationHistory.goBack(),
        },
        { label: "重新加载", role: "reload" },
        { type: "separator" },
        {
          label: "检查元素",
          click: () => {
            contents.inspectElement(params.x, params.y);
            if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: "detach" });
          },
        }
      );
      Menu.buildFromTemplate(template).popup();
    });
    contents.once("destroyed", () => {
      this.configuredContents.delete(contents.id);
      if (!contents.isDestroyed()) {
        contents.off("did-create-window", onCreatedWindow);
        contents.off("will-navigate", navigationGuard);
        contents.off("will-redirect", navigationGuard);
      }
    });

    // 子窗口本身也是完整浏览器上下文；保留参数便于后续增加来源提示。
    void inherited;
  }

  async snapshot(): Promise<BrowserSessionSnapshot> {
    const [cookies, cacheSize] = await Promise.all([
      this.session.cookies.get({}),
      this.session.getCacheSize(),
    ]);
    return {
      persistent: this.session.isPersistent(),
      storagePath: this.session.storagePath ?? null,
      cookieCount: cookies.length,
      cacheSize,
      userAgent: this.session.getUserAgent(),
    };
  }

  async clear(scope: "cookies" | "all"): Promise<void> {
    if (scope === "cookies") {
      await this.session.clearStorageData({ storages: ["cookies"] });
      await this.session.clearAuthCache();
    } else {
      await Promise.all([
        this.session.clearCache(),
        this.session.clearStorageData(),
        this.session.clearAuthCache(),
      ]);
    }
  }

  async importCookies(raw: unknown): Promise<BrowserCookieImportResult> {
    const source =
      Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as { cookies?: unknown }).cookies)
          ? (raw as { cookies: unknown[] }).cookies
          : [];
    if (source.length === 0) throw new Error("文件中没有可导入的 Cookie");

    const parsed: Electron.CookiesSetDetails[] = [];
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      const cookie = item as Record<string, unknown>;
      const name = typeof cookie.name === "string" ? cookie.name : "";
      const value = typeof cookie.value === "string" ? cookie.value : "";
      const domain =
        typeof cookie.domain === "string"
          ? cookie.domain.replace(/^\./, "")
          : typeof cookie.host === "string"
            ? cookie.host.replace(/^\./, "")
            : "";
      if (!name || !domain || /[\s/\\]/.test(domain)) continue;
      const secure = cookie.secure === true;
      const pathValue =
        typeof cookie.path === "string" && cookie.path.startsWith("/")
          ? cookie.path
          : "/";
      const sameSiteRaw =
        typeof cookie.sameSite === "string" ? cookie.sameSite.toLowerCase() : "";
      const sameSite: Electron.CookiesSetDetails["sameSite"] =
        sameSiteRaw === "none" || sameSiteRaw === "no_restriction"
          ? "no_restriction"
          : sameSiteRaw === "strict"
            ? "strict"
            : sameSiteRaw === "lax"
              ? "lax"
              : "unspecified";
      const expires =
        typeof cookie.expirationDate === "number"
          ? cookie.expirationDate
          : typeof cookie.expires === "number"
            ? cookie.expires
            : undefined;
      parsed.push({
        url: `${secure ? "https" : "http"}://${domain}${pathValue}`,
        name,
        value,
        domain: typeof cookie.domain === "string" ? cookie.domain : undefined,
        path: pathValue,
        secure,
        httpOnly: cookie.httpOnly === true,
        sameSite,
        ...(expires && expires > Date.now() / 1000 ? { expirationDate: expires } : {}),
      });
    }
    if (parsed.length === 0) throw new Error("文件中没有格式有效的 Cookie");

    // 不混合两套登录态；全部解析成功后才清理旧 Cookie。
    await this.session.clearStorageData({ storages: ["cookies"] });
    let imported = 0;
    for (const cookie of parsed) {
      try {
        await this.session.cookies.set(cookie);
        imported += 1;
      } catch {
        // 单个站点 Cookie 不兼容时跳过，其他站点仍可导入。
      }
    }
    await this.flush();
    return { imported, skipped: source.length - imported };
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.session.cookies.flushStore(),
      this.session.flushStorageData(),
    ]);
  }

  get storageDirectory(): string {
    return (
      this.browserSession?.storagePath ??
      path.join(app.getPath("userData"), "Partitions", BROWSER_PARTITION.slice("persist:".length))
    );
  }
}

export const BROWSER_SESSION = new BrowserSessionManager();
