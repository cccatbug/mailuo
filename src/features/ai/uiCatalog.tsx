import { Component, useMemo, type ReactNode } from "react";
import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  VisibilityProvider,
  defineRegistry,
  schema,
} from "@json-render/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BarChart,
  Donut,
  Gauge,
  Scatter,
  StackedBar,
  Trend,
} from "./ChartComponents";
import { createUiActionHandlers, uiActions } from "./uiActions";

/**
 * 小枢的结构化输出目录（json-render）。
 * AI 以扁平 spec（{root, elements}）描述界面，这里映射为脉络风格组件。
 * 相比旧版：新增图表类轻组件（纯 CSS/SVG）、交互组件（按钮/输入/开关）、
 * 以及可触发的 actions（任务创建/修改/删除等，经审批）。
 */

/* ---------- 组件目录 ---------- */

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

    /* ---------- 图表（纯 CSS/SVG，固定高度） ---------- */
    BarChart: {
      props: z.object({
        data: z.array(
          z.object({ label: z.string(), value: z.number().finite() })
        ),
        unit: z.string().optional(),
      }),
      description: "分类数值对比条形图（状态/优先级/标签分布等）",
    },
    Donut: {
      props: z.object({
        data: z.array(
          z.object({ label: z.string(), value: z.number().finite() })
        ),
        unit: z.string().optional(),
      }),
      description: "构成环图，适合 2-6 个类别的整体占比",
    },
    Trend: {
      props: z.object({
        data: z.array(
          z.object({ label: z.string(), value: z.number().finite() })
        ),
        unit: z.string().optional(),
        filled: z.boolean().optional(),
      }),
      description: "折线/面积趋势，适合随时间变化的数据",
    },
    Gauge: {
      props: z.object({
        value: z.number().finite(),
        label: z.string().optional(),
        unit: z.string().optional(),
        max: z.number().positive().optional(),
      }),
      description: "单个目标的完成度仪表（max 默认 100）",
    },
    StackedBar: {
      props: z.object({
        data: z.array(
          z.object({
            label: z.string(),
            values: z.record(z.string(), z.number().finite()),
          })
        ),
        series: z.array(
          z.object({ key: z.string(), label: z.string() })
        ),
        unit: z.string().optional(),
      }),
      description: "多分组构成对比的堆叠条",
    },
    Scatter: {
      props: z.object({
        data: z.array(
          z.object({ label: z.string(), x: z.number().finite(), y: z.number().finite() })
        ),
        xLabel: z.string().optional(),
        yLabel: z.string().optional(),
        unit: z.string().optional(),
      }),
      description: "两个数值维度关系的散点图",
    },

    /* ---------- 交互组件 ---------- */
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.enum(["default", "outline", "ghost", "destructive"]).optional(),
      }),
      description: "按钮；通过 on.press 绑定动作",
    },
    TextInput: {
      props: z.object({
        label: z.string().optional(),
        placeholder: z.string().optional(),
        value: z.union([z.string(), z.object({}).passthrough()]).optional(),
      }),
      description: "单行文本输入；value 可用 $bindState 双向绑定",
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        checked: z.union([z.boolean(), z.object({}).passthrough()]).optional(),
      }),
      description: "复选框；checked 可用 $bindState 绑定",
    },
    Switch: {
      props: z.object({
        label: z.string(),
        checked: z.union([z.boolean(), z.object({}).passthrough()]).optional(),
      }),
      description: "开关；checked 可用 $bindState 绑定",
    },
    Tag: {
      props: z.object({
        text: z.string(),
        active: z.boolean().optional(),
      }),
      description: "可点击标签（如筛选项）",
    },
    Empty: {
      props: z.object({ text: z.string() }),
      description: "空状态占位",
    },
  },
  actions: {
    create_task: {
      params: z.object({
        title: z.string(),
        priority: z.enum(["high", "normal", "low"]).optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        projectId: z.string().optional(),
      }),
      description: "创建任务",
    },
    update_task: {
      params: z.object({
        task: z.string(),
        patch: z
          .object({
            title: z.string().optional(),
            status: z.enum(["todo", "doing", "done"]).optional(),
            priority: z.enum(["high", "normal", "low"]).optional(),
            notes: z.string().optional(),
            addTags: z.array(z.string()).optional(),
            removeTags: z.array(z.string()).optional(),
          })
          .passthrough(),
      }),
      description: "修改任务的字段（patch 语义）",
    },
    delete_task: {
      params: z.object({ task: z.string() }),
      description: "删除任务（会请求用户确认）",
    },
    set_task_status: {
      params: z.object({
        task: z.string(),
        status: z.enum(["todo", "doing", "done"]),
      }),
      description: "切换任务状态",
    },
    apply_ops: {
      params: z.object({ ops: z.array(z.unknown()) }),
      description: "应用一组操作（创建/修改/删除任务等）",
    },
    select_task: {
      params: z.object({ task: z.string() }),
      description: "在右侧打开任务详情",
    },
    select_project: {
      params: z.object({ projectId: z.string() }),
      description: "切换到指定项目",
    },
  },
});

/* ---------- 组件实现 ---------- */

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

    /* ---------- 图表 ---------- */
    BarChart: ({ props }) => <BarChart data={props.data} unit={props.unit} />,
    Donut: ({ props }) => <Donut data={props.data} unit={props.unit} />,
    Trend: ({ props }) => (
      <Trend data={props.data} unit={props.unit} filled={props.filled} />
    ),
    Gauge: ({ props }) => (
      <Gauge value={props.value} label={props.label} unit={props.unit} max={props.max} />
    ),
    StackedBar: ({ props }) => (
      <StackedBar data={props.data} series={props.series} unit={props.unit} />
    ),
    Scatter: ({ props }) => (
      <Scatter data={props.data} xLabel={props.xLabel} yLabel={props.yLabel} unit={props.unit} />
    ),

    /* ---------- 交互 ---------- */
    Button: ({ props, emit }) => (
      <Button
        size="sm"
        variant={props.variant === "destructive" ? "destructive" : props.variant === "outline" ? "outline" : props.variant === "ghost" ? "ghost" : "default"}
        onClick={() => emit("press")}
      >
        {props.label}
      </Button>
    ),
    TextInput: ({ props }) => (
      <label className="block text-xs">
        {props.label && (
          <span className="mb-1 block text-muted-foreground">{props.label}</span>
        )}
        <Input
          className="h-8 text-xs"
          placeholder={props.placeholder}
          defaultValue={
            typeof props.value === "string" ? props.value : undefined
          }
        />
      </label>
    ),
    Checkbox: ({ props, emit }) => (
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          defaultChecked={props.checked === true}
          onChange={() => emit("change")}
          className="size-3.5 accent-primary"
        />
        {props.label}
      </label>
    ),
    Switch: ({ props, emit }) => (
      <label className="flex cursor-pointer items-center justify-between gap-2 text-sm">
        <span>{props.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={props.checked === true}
          onClick={() => emit("change")}
          className={cn(
            "relative h-4 w-7 rounded-full transition-colors",
            props.checked === true ? "bg-primary" : "bg-muted-foreground/25"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-3 rounded-full bg-background shadow-sm transition-transform",
              props.checked === true && "translate-x-3"
            )}
          />
        </button>
      </label>
    ),
    Tag: ({ props, emit }) => (
      <button
        type="button"
        onClick={() => emit("press")}
        className={cn(
          "rounded-full border px-2 py-0.5 text-xs transition-colors",
          props.active
            ? "border-primary bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        {props.text}
      </button>
    ),
    Empty: ({ props }) => (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {props.text}
      </p>
    ),
  },
  actions: {
    create_task: async (params) => (await uiActions.create_task(params as never)) as never,
    update_task: async (params) => (await uiActions.update_task(params as never)) as never,
    delete_task: async (params) => (await uiActions.delete_task(params as never)) as never,
    set_task_status: async (params) => (await uiActions.set_task_status(params as never)) as never,
    apply_ops: async (params) => (await uiActions.apply_ops(params as never)) as never,
    select_task: async (params) => (await uiActions.select_task(params as never)) as never,
    select_project: async (params) => (await uiActions.select_project(params as never)) as never,
  },
});

/** 供系统提示词使用的组件目录说明（含动作与事件绑定语法） */
export const UI_CATALOG_PROMPT = uiCatalog.prompt({
  mode: "inline",
  customRules: [
    "结构化界面用于比纯文字更清晰的信息展示（指标、清单、对比、进度）。",
    "图表数据必须来自项目/任务快照的真实数据，不得编造。",
    "需要用户确认或触发真实操作（创建/修改/删除任务、切换项目）时，在 Button 元素上用 on.press 绑定动作：{\"on\":{\"press\":{\"action\":\"create_task\",\"params\":{\"title\":\"任务标题\"}}}}。",
    "写入类动作会请求用户批准；没有把握的动作不要输出。",
    "每轮最多输出 3 个界面块；简单回答用纯文字。",
  ],
});

export interface UiSpec {
  root: string;
  elements: Record<string, unknown>;
}

/** 白名单动作名（卡片 on 绑定里允许出现的 action） */
const ALLOWED_ACTIONS = new Set([
  "create_task",
  "update_task",
  "delete_task",
  "set_task_status",
  "apply_ops",
  "select_task",
  "select_project",
  "setState",
  "pushState",
  "removeState",
  "validateForm",
]);

/**
 * 收敛并过滤 AI 输出的界面 spec：
 * - 结构校验（root / elements 存在且 root 在 elements 中）
 * - 动作白名单：未知 action 名的绑定直接移除，防止模型调用未注册动作
 * - 组件白名单：未知组件类型移除
 */
export function sanitizeUiSpec(raw: unknown): UiSpec | null {
  if (raw === null || typeof raw !== "object") return null;
  const spec = raw as UiSpec & { elements?: Record<string, unknown> };
  if (typeof spec.root !== "string") return null;
  if (spec.elements === null || typeof spec.elements !== "object") return null;
  if (!(spec.root in spec.elements)) return null;

  // 已知组件集合（从 catalog 数据推导）
  const knownComponents = new Set<string>(
    uiCatalog.componentNames as unknown as string[]
  );

  const elements: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec.elements)) {
    if (!value || typeof value !== "object") continue;
    const element = value as Record<string, unknown>;
    const type = String(element.type ?? "");
    if (!knownComponents.has(type)) continue;

    // 过滤 on 事件绑定里的未知动作
    if (element.on && typeof element.on === "object") {
      const on: Record<string, unknown> = {};
      for (const [event, binding] of Object.entries(element.on as Record<string, unknown>)) {
        const cleaned = sanitizeActionBinding(binding);
        if (cleaned) on[event] = cleaned;
      }
      if (Object.keys(on).length > 0) {
        elements[key] = { ...element, on };
      } else {
        const { on: _removed, ...rest } = element;
        elements[key] = rest;
      }
    } else {
      elements[key] = element;
    }
  }
  if (!(spec.root in elements)) return null;
  return { root: spec.root, elements };
}

/** 过滤单个 on 绑定（对象或数组形式），未知 action 丢弃 */
function sanitizeActionBinding(binding: unknown): unknown {
  if (Array.isArray(binding)) {
    const cleaned = binding.map(sanitizeActionBinding).filter(Boolean);
    return cleaned.length ? cleaned : null;
  }
  if (!binding || typeof binding !== "object") return null;
  const b = binding as Record<string, unknown>;
  const action = String(b.action ?? "");
  if (!ALLOWED_ACTIONS.has(action)) return null;
  return {
    ...b,
    action,
    ...(b.params === undefined ? {} : { params: b.params }),
    ...(b.confirm === undefined ? {} : { confirm: b.confirm }),
    ...(b.onSuccess === undefined ? {} : { onSuccess: b.onSuccess }),
    ...(b.onError === undefined ? {} : { onError: b.onError }),
  };
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

/**
 * 渲染小枢输出的 json-render 结构化界面。
 * 接线 StateProvider / VisibilityProvider / ActionProvider，卡片可交互。
 */
export function UiBlock({ spec }: { spec: UiSpec }) {
  // 每个卡片独立 action handlers（含权限与 toast），stable 引用避免重复创建
  const handlers = useMemo(() => createUiActionHandlers(), []);
  return (
    <div className="w-full rounded-xl border bg-card/60 p-3">
      <UiErrorBoundary>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <StateProvider initialState={{}}>
          <VisibilityProvider>
            <ActionProvider handlers={handlers}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Renderer spec={spec as any} registry={registry} />
            </ActionProvider>
          </VisibilityProvider>
        </StateProvider>
      </UiErrorBoundary>
    </div>
  );
}
