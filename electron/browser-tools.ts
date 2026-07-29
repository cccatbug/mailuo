import { promises as fs } from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { BROWSER_CONTROL } from "./browser-runtime";
import type {
  BrowserActRequest,
  BrowserCaptureRequest,
  BrowserPageSnapshot,
} from "../src/shared/browser";

function textResult(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text:
          text.length > 60_000
            ? `${text.slice(0, 60_000)}\n…（浏览器工具输出已截断）`
            : text,
      },
    ],
    details: undefined,
  };
}

function formatSnapshot(snapshot: BrowserPageSnapshot): string {
  const frames = snapshot.frames
    .map((frame) => {
      const elements = frame.elements
        .map((element) => {
          const state = [
            element.disabled ? "disabled" : "",
            element.checked === true
              ? "checked"
              : element.checked === false
                ? "unchecked"
                : "",
            element.value ? `value=${JSON.stringify(element.value)}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `${element.ref} ${element.role} ${JSON.stringify(element.name)}${state ? ` ${state}` : ""}`;
        })
        .join("\n");
      return [
        `## Frame ${frame.frameId} ${frame.url}`,
        frame.title ? `标题：${frame.title}` : "",
        frame.text ? `正文：\n${frame.text}` : "",
        elements ? `交互元素：\n${elements}` : "交互元素：无",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return [
    `标签页：${snapshot.tab.id}`,
    `标题：${snapshot.tab.title}`,
    `网址：${snapshot.tab.url}`,
    `快照代次：${snapshot.generation}`,
    frames,
  ].join("\n");
}

const tabAction = Type.Union([
  Type.Literal("list"),
  Type.Literal("open"),
  Type.Literal("focus"),
  Type.Literal("close"),
]);

const actAction = Type.Union(
  [
    "goto",
    "back",
    "forward",
    "reload",
    "stop",
    "click",
    "double_click",
    "hover",
    "focus",
    "fill",
    "type",
    "clear",
    "press",
    "select",
    "check",
    "uncheck",
    "scroll",
    "drag",
    "upload",
    "wait",
    "dialog",
    "evaluate",
  ].map((value) => Type.Literal(value))
);

const captureAction = Type.Union(
  [
    "screenshot",
    "full_screenshot",
    "pdf",
    "console",
    "network",
    "cookies",
    "get_storage",
    "set_storage",
    "clear_storage",
    "set_cookie",
    "clear_cookies",
    "set_device",
    "reset_device",
  ].map((value) => Type.Literal(value))
);

export function createBrowserTools(cwd: string): ToolDefinition[] {
  return [
    defineTool({
      name: "browser_tabs",
      label: "浏览器标签页",
      description:
        "列出、打开、聚焦或关闭脉络内置浏览器标签页。读取网页前先用 list 确认 tabId。",
      promptSnippet: "管理和列出用户当前可见的内置浏览器标签页。",
      parameters: Type.Object({
        action: tabAction,
        tabId: Type.Optional(Type.String()),
        url: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        return textResult(await BROWSER_CONTROL.manageTabs(params));
      },
    }),
    defineTool({
      name: "browser_snapshot",
      label: "读取浏览器页面",
      description:
        "读取一个标签页的正文、frame 和交互元素，返回仅对当前页面代次有效的 @e1 等引用。页面变化后必须重新读取。",
      promptSnippet: "读取浏览器页面并生成可操作元素引用。",
      parameters: Type.Object({
        tabId: Type.Optional(Type.String()),
        includeScreenshot: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        const snapshot = await BROWSER_CONTROL.snapshot(params);
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: formatSnapshot(snapshot) }];
        if (params.includeScreenshot) {
          const captured = await BROWSER_CONTROL.capture({
            tabId: params.tabId,
            action: "screenshot",
          });
          if (captured.kind === "image") {
            content.push({
              type: "image",
              data: captured.data,
              mimeType: captured.mimeType,
            });
          }
        }
        return { content, details: undefined };
      },
    }),
    defineTool({
      name: "browser_act",
      label: "操作浏览器页面",
      description:
        "在指定标签页导航、等待或操作 browser_snapshot 返回的元素引用。敏感操作会等待用户确认。",
      promptSnippet: "通过快照引用操作用户可见的网页。",
      executionMode: "sequential",
      parameters: Type.Object({
        tabId: Type.Optional(Type.String()),
        action: actAction,
        ref: Type.Optional(Type.String()),
        targetRef: Type.Optional(Type.String()),
        url: Type.Optional(Type.String()),
        value: Type.Optional(Type.String()),
        values: Type.Optional(Type.Array(Type.String())),
        key: Type.Optional(Type.String()),
        text: Type.Optional(Type.String()),
        selector: Type.Optional(Type.String()),
        timeoutMs: Type.Optional(Type.Number()),
        x: Type.Optional(Type.Number()),
        y: Type.Optional(Type.Number()),
        paths: Type.Optional(Type.Array(Type.String())),
        script: Type.Optional(Type.String()),
        accept: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        return textResult(
          await BROWSER_CONTROL.act(params as BrowserActRequest)
        );
      },
    }),
    defineTool({
      name: "browser_capture",
      label: "检查与捕获浏览器",
      description:
        "截图、导出 PDF、读取控制台/网络/Cookie/Storage，或设置设备模拟。Cookie 值和写操作需要显式参数并可能等待确认。",
      promptSnippet: "捕获页面视觉结果和浏览器诊断数据。",
      executionMode: "sequential",
      parameters: Type.Object({
        tabId: Type.Optional(Type.String()),
        action: captureAction,
        includeValues: Type.Optional(Type.Boolean()),
        storage: Type.Optional(
          Type.Union([Type.Literal("local"), Type.Literal("session")])
        ),
        key: Type.Optional(Type.String()),
        value: Type.Optional(Type.String()),
        cookie: Type.Optional(
          Type.Object({
            url: Type.String(),
            name: Type.String(),
            value: Type.String(),
            domain: Type.Optional(Type.String()),
            path: Type.Optional(Type.String()),
            secure: Type.Optional(Type.Boolean()),
            httpOnly: Type.Optional(Type.Boolean()),
          })
        ),
        width: Type.Optional(Type.Number()),
        height: Type.Optional(Type.Number()),
        deviceScaleFactor: Type.Optional(Type.Number()),
        mobile: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        const result = await BROWSER_CONTROL.capture(
          params as BrowserCaptureRequest
        );
        if (result.kind === "image") {
          return {
            content: [
              {
                type: "image" as const,
                data: result.data,
                mimeType: result.mimeType,
              },
            ],
            details: undefined,
          };
        }
        if (result.kind === "binary") {
          const file = path.join(
            cwd,
            `browser-page-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`
          );
          await fs.writeFile(file, result.data);
          return textResult({ path: file, mimeType: result.mimeType });
        }
        return textResult(result.data);
      },
    }),
  ];
}
