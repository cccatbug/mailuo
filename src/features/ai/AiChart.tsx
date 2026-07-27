import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CategoryBars } from "@/features/stats/StatsPanel";

type ValueChartType =
  | "bar"
  | "line"
  | "area"
  | "donut"
  | "radar"
  | "gauge";

interface ChartBase {
  title?: string;
  unit?: string;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSeries {
  key: string;
  label: string;
}

export interface StackedChartPoint {
  label: string;
  values: Record<string, number>;
}

export interface ScatterChartPoint {
  label: string;
  x: number;
  y: number;
}

export type ChartSpec =
  | (ChartBase & {
      type: ValueChartType;
      data: ChartPoint[];
      /** gauge 的满量程，默认 100 */
      max?: number;
    })
  | (ChartBase & {
      type: "stacked-bar";
      data: StackedChartPoint[];
      series: ChartSeries[];
    })
  | (ChartBase & {
      type: "scatter";
      data: ScatterChartPoint[];
      xLabel?: string;
      yLabel?: string;
    });

/** 固定顺序的分类色（主题 token，勿循环生成） */
const CAT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const VALUE_TYPES: ValueChartType[] = [
  "bar",
  "line",
  "area",
  "donut",
  "radar",
  "gauge",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function shortText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function sanitizeValueData(
  raw: unknown[],
  type: ValueChartType
): ChartPoint[] {
  const limit = type === "gauge" ? 1 : 20;
  return raw
    .filter(
      (item): item is { label: string; value: number } =>
        isRecord(item) &&
        typeof item.label === "string" &&
        typeof item.value === "number" &&
        Number.isFinite(item.value) &&
        (type !== "donut" || item.value > 0) &&
        (type !== "gauge" || item.value >= 0)
    )
    .slice(0, limit)
    .map((item) => ({
      label: (item.label as string).slice(0, 24),
      value: item.value as number,
    }));
}

function sanitizeSeries(raw: unknown): ChartSeries[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter(
      (item): item is { key: string; label: string } =>
        isRecord(item) &&
        typeof item.key === "string" &&
        Boolean(item.key.trim()) &&
        typeof item.label === "string" &&
        Boolean(item.label.trim())
    )
    .map((item) => ({
      key: (item.key as string).trim().slice(0, 24),
      label: (item.label as string).trim().slice(0, 24),
    }))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .slice(0, 5);
}

export function sanitizeChartSpec(raw: unknown): ChartSpec | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  if (!Array.isArray(raw.data)) return null;

  const title = shortText(raw.title, 60);
  const unit = shortText(raw.unit, 8);

  if (VALUE_TYPES.includes(raw.type as ValueChartType)) {
    const type = raw.type as ValueChartType;
    const data = sanitizeValueData(raw.data, type);
    if (data.length === 0) return null;
    const max =
      type === "gauge" &&
      typeof raw.max === "number" &&
      Number.isFinite(raw.max) &&
      raw.max > 0
        ? raw.max
        : type === "gauge"
          ? 100
          : undefined;
    return { type, title, unit, data, max };
  }

  if (raw.type === "stacked-bar") {
    const series = sanitizeSeries(raw.series);
    if (series.length < 2) return null;
    const data = raw.data
      .filter(
        (
          item
        ): item is { label: string; values: Record<string, unknown> } =>
          isRecord(item) &&
          typeof item.label === "string" &&
          isRecord(item.values) &&
          series.some(
            (s) =>
              typeof (item.values as Record<string, unknown>)[s.key] ===
                "number" &&
              Number.isFinite(
                (item.values as Record<string, unknown>)[s.key] as number
              )
          )
      )
      .slice(0, 20)
      .map((item) => {
        const source = item.values as Record<string, unknown>;
        return {
          label: (item.label as string).slice(0, 24),
          values: Object.fromEntries(
            series.map((s) => [
              s.key,
              typeof source[s.key] === "number" &&
              Number.isFinite(source[s.key] as number)
                ? (source[s.key] as number)
                : 0,
            ])
          ),
        };
      });
    if (data.length === 0) return null;
    return { type: "stacked-bar", title, unit, series, data };
  }

  if (raw.type === "scatter") {
    const data = raw.data
      .filter(
        (item): item is { label: string; x: number; y: number } =>
          isRecord(item) &&
          typeof item.label === "string" &&
          typeof item.x === "number" &&
          Number.isFinite(item.x) &&
          typeof item.y === "number" &&
          Number.isFinite(item.y)
      )
      .slice(0, 40)
      .map((item) => ({
        label: (item.label as string).slice(0, 24),
        x: item.x as number,
        y: item.y as number,
      }));
    if (data.length === 0) return null;
    return {
      type: "scatter",
      title,
      unit,
      data,
      xLabel: shortText(raw.xLabel, 20),
      yLabel: shortText(raw.yLabel, 20),
    };
  }

  return null;
}

interface TooltipItem {
  name?: string;
  value?: number | string;
  color?: string;
  fill?: string;
  payload?: { label?: string };
}

function SpecTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  const heading = payload[0].payload?.label ?? label;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      {heading && <p className="mb-0.5 text-muted-foreground">{heading}</p>}
      <div className="flex flex-col gap-0.5">
        {payload.map((item, index) => (
          <p key={`${item.name ?? "value"}-${index}`} className="flex gap-2">
            {payload.length > 1 && (
              <span className="text-muted-foreground">
                {item.name ?? "数值"}
              </span>
            )}
            <span className="ml-auto font-medium tabular-nums">
              {item.value}
              {unit ?? ""}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function ScatterTooltip({
  active,
  payload,
  xLabel,
  yLabel,
  unit,
}: {
  active?: boolean;
  payload?: { payload?: ScatterChartPoint }[];
  xLabel?: string;
  yLabel?: string;
  unit?: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="mb-0.5 text-muted-foreground">{point.label}</p>
      <p>
        {xLabel ?? "X"}：<span className="font-medium">{point.x}</span>
      </p>
      <p>
        {yLabel ?? "Y"}：<span className="font-medium">{point.y}</span>
        {unit ?? ""}
      </p>
    </div>
  );
}

const cartesianGrid = (
  <CartesianGrid
    vertical={false}
    stroke="var(--border)"
    strokeDasharray="3 4"
  />
);

const categoryAxis = (
  <XAxis
    dataKey="label"
    tickLine={false}
    axisLine={false}
    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
  />
);

const valueAxis = (
  <YAxis
    tickLine={false}
    axisLine={false}
    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
    width={40}
  />
);

/** 助手生成的任务数据图表，协议经 sanitizeChartSpec 收敛后再进入此组件。 */
export function AiChart({ spec }: { spec: ChartSpec }) {
  return (
    <div className="w-full rounded-xl border bg-card p-3">
      {spec.title && (
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {spec.title}
        </p>
      )}

      {spec.type === "bar" && <CategoryBars items={spec.data} />}

      {spec.type === "line" && (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              accessibilityLayer
              data={spec.data}
              margin={{ top: 6, right: 8, left: -22, bottom: 0 }}
            >
              {cartesianGrid}
              {categoryAxis}
              {valueAxis}
              <Tooltip
                content={<SpecTooltip unit={spec.unit} />}
                cursor={{ stroke: "var(--border)" }}
              />
              <Line
                type="monotone"
                dataKey="value"
                name="数值"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {spec.type === "area" && (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              accessibilityLayer
              data={spec.data}
              margin={{ top: 6, right: 8, left: -22, bottom: 0 }}
            >
              {cartesianGrid}
              {categoryAxis}
              {valueAxis}
              <Tooltip
                content={<SpecTooltip unit={spec.unit} />}
                cursor={{ stroke: "var(--border)" }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name="数值"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="var(--chart-1)"
                fillOpacity={0.18}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {spec.type === "donut" && (
        <div className="flex items-center gap-3">
          <div className="h-36 w-36 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer>
                <Tooltip content={<SpecTooltip unit={spec.unit} />} />
                <Pie
                  data={spec.data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="55%"
                  outerRadius="92%"
                  paddingAngle={2}
                  stroke="var(--card)"
                  strokeWidth={2}
                >
                  {spec.data.map((_, i) => (
                    <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-1">
            {spec.data.slice(0, 8).map((d, i) => (
              <li key={d.label} className="flex items-center gap-1.5 text-xs">
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: CAT_COLORS[i % CAT_COLORS.length] }}
                />
                <span className="truncate text-muted-foreground">{d.label}</span>
                <span className="ml-auto font-medium tabular-nums">
                  {d.value}
                  {spec.unit ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {spec.type === "radar" && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart
              accessibilityLayer
              data={spec.data}
              margin={{ top: 8, right: 24, bottom: 8, left: 24 }}
            >
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              />
              <PolarRadiusAxis tick={false} axisLine={false} />
              <Tooltip content={<SpecTooltip unit={spec.unit} />} />
              <Radar
                dataKey="value"
                name="数值"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fill="var(--chart-2)"
                fillOpacity={0.2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {spec.type === "gauge" && (
        <div className="relative mx-auto h-40 max-w-52">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              accessibilityLayer
              data={spec.data}
              innerRadius="72%"
              outerRadius="94%"
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis
                type="number"
                domain={[0, spec.max ?? 100]}
                tick={false}
              />
              <RadialBar
                dataKey="value"
                background={{ fill: "var(--muted)" }}
                fill="var(--chart-1)"
                cornerRadius={999}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums">
              {spec.data[0].value}
              <span className="ml-0.5 text-sm text-muted-foreground">
                {spec.unit ?? ""}
              </span>
            </span>
            <span className="max-w-28 truncate text-xs text-muted-foreground">
              {spec.data[0].label}
            </span>
          </div>
        </div>
      )}

      {spec.type === "stacked-bar" && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              accessibilityLayer
              data={spec.data.map((point) => ({
                label: point.label,
                ...point.values,
              }))}
              margin={{ top: 6, right: 8, left: -22, bottom: 0 }}
            >
              {cartesianGrid}
              {categoryAxis}
              {valueAxis}
              <Tooltip content={<SpecTooltip unit={spec.unit} />} />
              <Legend
                iconType="square"
                iconSize={8}
                wrapperStyle={{ fontSize: 10 }}
              />
              {spec.series.map((series, index) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.label}
                  stackId="total"
                  fill={CAT_COLORS[index % CAT_COLORS.length]}
                  radius={
                    index === spec.series.length - 1 ? [3, 3, 0, 0] : undefined
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {spec.type === "scatter" && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart
              accessibilityLayer
              margin={{ top: 8, right: 12, left: -8, bottom: 8 }}
            >
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" />
              <XAxis
                type="number"
                dataKey="x"
                name={spec.xLabel ?? "X"}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name={spec.yLabel ?? "Y"}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                width={42}
              />
              <Tooltip
                cursor={{ stroke: "var(--border)", strokeDasharray: "3 4" }}
                content={
                  <ScatterTooltip
                    xLabel={spec.xLabel}
                    yLabel={spec.yLabel}
                    unit={spec.unit}
                  />
                }
              />
              <Scatter data={spec.data} fill="var(--chart-3)" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
