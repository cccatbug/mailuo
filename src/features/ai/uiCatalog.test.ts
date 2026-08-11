import { describe, expect, it, vi } from "vitest";
import { sanitizeUiSpec, UI_CATALOG_PROMPT } from "./uiCatalog";
import { parseAssistantReply } from "./actions";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: { getState: () => ({ tasks: [], projects: [], selectedProjectId: "p1" }) },
}));

describe("UI_CATALOG_PROMPT（系统提示词）", () => {
  it("生成包含图表组件、交互组件与动作的说明", () => {
    expect(UI_CATALOG_PROMPT.length).toBeGreaterThan(500);
    expect(UI_CATALOG_PROMPT).toContain("BarChart");
    expect(UI_CATALOG_PROMPT).toContain("Donut");
    expect(UI_CATALOG_PROMPT).toContain("Gauge");
    expect(UI_CATALOG_PROMPT).toContain("create_task");
    expect(UI_CATALOG_PROMPT).toContain("delete_task");
    expect(UI_CATALOG_PROMPT).toContain("Button");
  });
});

describe("sanitizeUiSpec", () => {
  it("接受合法 spec（root 在 elements 中）", () => {
    const spec = sanitizeUiSpec({
      root: "c1",
      elements: {
        c1: { type: "Card", props: { title: "进度" }, children: ["p1"] },
        p1: { type: "Progress", props: { label: "完成率", percent: 40 }, children: [] },
      },
    });
    expect(spec).not.toBeNull();
    expect(spec?.root).toBe("c1");
  });

  it("root 不在 elements 中时拒绝", () => {
    expect(
      sanitizeUiSpec({ root: "missing", elements: { c1: { type: "Card" } } })
    ).toBeNull();
  });

  it("未知组件类型被移除；若 root 被移除则整体拒绝", () => {
    const spec = sanitizeUiSpec({
      root: "evil",
      elements: {
        evil: { type: "HackerComponent", props: {}, children: [] },
      },
    });
    expect(spec).toBeNull();
  });

  it("未知 action 的事件绑定被移除（防止模型调用未注册动作）", () => {
    const spec = sanitizeUiSpec({
      root: "c1",
      elements: {
        c1: {
          type: "Button",
          props: { label: "危险" },
          on: { press: { action: "drop_database", params: {} } },
          children: [],
        },
      },
    });
    expect(spec).not.toBeNull();
    // 绑定被移除 → on 字段消失
    const element = spec?.elements["c1"] as Record<string, unknown> | undefined;
    expect(element?.on).toBeUndefined();
  });

  it("合法动作的事件绑定保留", () => {
    const spec = sanitizeUiSpec({
      root: "c1",
      elements: {
        c1: {
          type: "Button",
          props: { label: "新建任务" },
          on: {
            press: {
              action: "create_task",
              params: { title: "写周报" },
            },
          },
          children: [],
        },
      },
    });
    expect(spec).not.toBeNull();
    const element = spec?.elements["c1"] as Record<string, unknown> | undefined;
    const on = element?.on as Record<string, unknown> | undefined;
    expect(on?.press).toBeTruthy();
  });

  it("旧 mailuo-chart 结构不匹配组件目录 → 拒绝", () => {
    expect(
      sanitizeUiSpec({
        root: "c1",
        elements: {
          c1: { type: "chart", props: { type: "bar" }, children: [] },
        },
      })
    ).toBeNull();
  });
});

describe("parseAssistantReply（json-render 混排）", () => {
  it("提取 mailuo-ui 块并从正文移除", () => {
    const text = `本周完成 3 个任务。
\`\`\`mailuo-ui
{"root":"c1","elements":{"c1":{"type":"Card","props":{"title":"进展"},"children":[]}}}
\`\`\`
继续加油。`;
    const parsed = parseAssistantReply(text);
    expect(parsed.uiSpecs).toHaveLength(1);
    expect(parsed.uiSpecs[0]?.root).toBe("c1");
    expect(parsed.content).not.toContain("mailuo-ui");
    expect(parsed.content).toContain("本周完成");
    expect(parsed.content).toContain("继续加油");
  });

  it("多个 UI 块全部提取，最多 3 个", () => {
    const text = `\`\`\`mailuo-ui
{"root":"a","elements":{"a":{"type":"Card","children":[]}}}
\`\`\`
\`\`\`mailuo-ui
{"root":"b","elements":{"b":{"type":"Card","children":[]}}}
\`\`\`
\`\`\`mailuo-ui
{"root":"c","elements":{"c":{"type":"Card","children":[]}}}
\`\`\`
\`\`\`mailuo-ui
{"root":"d","elements":{"d":{"type":"Card","children":[]}}}
\`\`\``;
    const parsed = parseAssistantReply(text);
    expect(parsed.uiSpecs).toHaveLength(3);
    expect(parsed.uiSpecs.map((s) => s.root)).toEqual(["a", "b", "c"]);
  });

  it("坏 JSON 的 UI 块被忽略", () => {
    const text = `\`\`\`mailuo-ui
{not valid json}
\`\`\`
正文`;
    const parsed = parseAssistantReply(text);
    expect(parsed.uiSpecs).toHaveLength(0);
    expect(parsed.content).toContain("正文");
  });

  it("不再解析 mailuo-chart（旧协议）", () => {
    const text = `\`\`\`mailuo-chart
{"type":"bar","title":"x","data":[{"label":"a","value":1}]}
\`\`\`
正文`;
    const parsed = parseAssistantReply(text);
    expect(parsed.uiSpecs).toHaveLength(0);
    // 旧围栏不再被剥离，会作为正文残留（兼容旧消息）
    expect(parsed.content).toContain("mailuo-chart");
  });
});
