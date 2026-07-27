import { Component, type ReactNode } from "react";
import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { defineRegistry, Renderer, schema } from "@json-render/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

/**
 * 小枢的结构化输出目录（json-render）。
 * AI 以扁平 spec（{root, elements}）描述界面，这里映射为脉络风格的组件。
 */
export const uiCatalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({ title: z.string().optional() }),
      description: "分组卡片，可含标题，children 为内容",
    },
    Row: {
      props: z.object({}).optional(),
      description: "横向布局容器，children 均分排列",
    },
    Stat: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        hint: z.string().optional(),
      }),
      description: "指标数字（label 小字 + value 大字 + 可选 hint）",
    },
    Text: {
      props: z.object({
        text: z.string(),
        muted: z.boolean().optional(),
        bold: z.boolean().optional(),
      }),
      description: "一段文本",
    },
    Badge: {
      props: z.object({
        text: z.string(),
        tone: z.enum(["default", "success", "warning", "danger"]).optional(),
      }),
      description: "小徽章标签",
    },
    List: {
      props: z.object({
        items: z.array(
          z.object({
            text: z.string(),
            status: z.enum(["done", "doing", "todo", "blocked"]).optional(),
            note: z.string().optional(),
          })
        ),
      }),
      description: "任务/条目清单，item 可带状态圆点与备注",
    },
    Table: {
      props: z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
      description: "数据表格",
    },
    Progress: {
      props: z.object({
        label: z.string(),
        percent: z.number().min(0).max(100),
      }),
      description: "带标签的进度条（percent 0-100）",
    },
    Callout: {
      props: z.object({
        tone: z.enum(["info", "success", "warning", "danger"]).optional(),
        text: z.string(),
      }),
      description: "强调提示块",
    },
    Divider: {
      props: z.object({}).optional(),
      description: "分隔线",
    },
  },
  actions: {},
});

const STATUS_DOT: Record<string, string> = {
  done: "var(--viz-done)",
  doing: "var(--viz-doing)",
  todo: "var(--viz-ready)",
  blocked: "var(--viz-blocked)",
};

const CALLOUT_TONE: Record<string, string> = {
  info: "border-border bg-muted/40 text-foreground",
  success: "border-[var(--viz-done)]/40 bg-[var(--viz-done)]/8 text-foreground",
  warning: "border-[var(--viz-doing)]/40 bg-[var(--viz-doing)]/8 text-foreground",
  danger: "border-primary/40 bg-primary/5 text-primary",
};

const { registry } = defineRegistry(uiCatalog, {
  components: {
    Card: ({ props, children }) => (
      <div className="rounded-lg border bg-card p-3">
        {props?.title && (
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {props.title}
          </p>
        )}
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    ),
    Row: ({ children }) => (
      <div className="flex flex-wrap items-stretch gap-2 *:min-w-0 *:flex-1">
        {children}
      </div>
    ),
    Stat: ({ props }) => (
      <div className="rounded-md border bg-card px-3 py-2">
        <p className="text-xs text-muted-foreground">{props.label}</p>
        <p className="text-lg font-semibold tabular-nums">{props.value}</p>
        {props.hint && (
          <p className="text-[10px] text-muted-foreground">{props.hint}</p>
        )}
      </div>
    ),
    Text: ({ props }) => (
      <p
        className={cn(
          "text-sm whitespace-pre-wrap",
          props.muted && "text-muted-foreground",
          props.bold && "font-semibold"
        )}
      >
        {props.text}
      </p>
    ),
    Badge: ({ props }) => (
      <Badge
        variant={props.tone === "danger" ? "default" : "secondary"}
        className={cn(
          "w-fit",
          props.tone === "success" && "bg-[var(--viz-done)]/15 text-[var(--viz-done)]",
          props.tone === "warning" && "bg-[var(--viz-doing)]/15 text-[var(--viz-doing)]"
        )}
      >
        {props.text}
      </Badge>
    ),
    List: ({ props }) => (
      <ul className="flex flex-col gap-1">
        {props.items.slice(0, 30).map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{
                background: item.status
                  ? STATUS_DOT[item.status]
                  : "var(--muted-foreground)",
              }}
            />
            <span className="min-w-0">
              {item.text}
              {item.note && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {item.note}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    ),
    Table: ({ props }) => (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {props.headers.map((h, i) => (
                <th key={i} className="px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.slice(0, 30).map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-2.5 py-1.5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    Progress: ({ props }) => (
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{props.label}</span>
          <span className="font-medium tabular-nums">
            {Math.round(props.percent)}%
          </span>
        </div>
        <Progress value={props.percent} className="h-1.5" />
      </div>
    ),
    Callout: ({ props }) => (
      <div
        className={cn(
          "rounded-md border px-3 py-2 text-sm",
          CALLOUT_TONE[props.tone ?? "info"]
        )}
      >
        {props.text}
      </div>
    ),
    Divider: () => <Separator />,
  },
});

/** 供系统提示词使用的组件目录说明 */
export const UI_CATALOG_PROMPT = uiCatalog.prompt();

export interface UiSpec {
  root: string;
  elements: Record<string, unknown>;
}

export function sanitizeUiSpec(raw: unknown): UiSpec | null {
  if (raw === null || typeof raw !== "object") return null;
  const spec = raw as Partial<UiSpec>;
  if (typeof spec.root !== "string") return null;
  if (spec.elements === null || typeof spec.elements !== "object") return null;
  if (!(spec.root in spec.elements)) return null;
  return spec as UiSpec;
}

class UiErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="text-xs text-muted-foreground">
          （此结构化内容渲染失败，已略过）
        </p>
      );
    }
    return this.props.children;
  }
}

/** 渲染小枢输出的 json-render 结构化界面 */
export function UiBlock({ spec }: { spec: UiSpec }) {
  return (
    <div className="w-full rounded-xl border bg-card/60 p-3">
      <UiErrorBoundary>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Renderer spec={spec as any} registry={registry} />
      </UiErrorBoundary>
    </div>
  );
}
