/**
 * 小枢结构化输出的轻量图表组件（纯 CSS / SVG，零 recharts 依赖）。
 * 固定高度、无异步布局——根治此前 recharts ResponsiveContainer 导致的滚动条脱节问题。
 * 数据在进入组件前已由 sanitizeUiSpec / catalog 校验收敛。
 */

export interface ChartDatum {
  label: string;
  value: number;
}

export interface SeriesDatum {
  label: string;
  values: Record<string, number>;
}

export interface SeriesSpec {
  key: string;
  label: string;
}

export interface ScatterDatum {
  label: string;
  x: number;
  y: number;
}

const CAT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function colorAt(index: number): string {
  return CAT_COLORS[index % CAT_COLORS.length];
}

/* ---------- Bar：分类数值对比 ---------- */

export function BarChart({
  data,
  unit = "",
}: {
  data: ChartDatum[];
  unit?: string;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="flex flex-col gap-2">
      {data.map((item, index) => (
        <div key={item.label} className="flex items-center gap-2.5">
          <span className="w-16 shrink-0 truncate text-right text-xs text-muted-foreground">
            {item.label}
          </span>
          <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${Math.max(1, (item.value / max) * 100)}%`,
                background: colorAt(index),
              }}
            />
          </div>
          <span className="w-8 shrink-0 text-xs font-medium tabular-nums">
            {item.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Donut：整体构成（conic-gradient） ---------- */

export function Donut({
  data,
  unit = "",
}: {
  data: ChartDatum[];
  unit?: string;
}) {
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  let cursor = 0;
  const segments = data.map((item, index) => {
    const start = cursor;
    const portion = total > 0 ? Math.max(0, item.value) / total : 0;
    cursor += portion;
    return {
      ...item,
      color: colorAt(index),
      from: `${start * 360}deg`,
      to: `${(start + portion) * 360}deg`,
    };
  });
  const background =
    total <= 0
      ? "var(--muted)"
      : `conic-gradient(${segments
          .map((segment) => `${segment.color} ${segment.from} ${segment.to}`)
          .join(", ")})`;
  return (
    <div className="flex items-center gap-3">
      <div
        className="size-24 shrink-0 rounded-full"
        style={{ background }}
        aria-label="构成图"
      />
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {data.slice(0, 8).map((item, index) => (
          <li key={item.label} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: colorAt(index) }}
            />
            <span className="truncate text-muted-foreground">{item.label}</span>
            <span className="ml-auto font-medium tabular-nums">
              {item.value}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Trend：折线/面积趋势（轻量 SVG） ---------- */

function trendPoints(
  data: ChartDatum[],
  width: number,
  height: number
): string {
  const max = Math.max(1, ...data.map((item) => item.value));
  const min = Math.min(0, ...data.map((item) => item.value));
  const range = Math.max(1, max - min);
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  return data
    .map((item, index) => {
      const x = index * stepX;
      const y = height - ((item.value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Trend({
  data,
  unit = "",
  filled = false,
}: {
  data: ChartDatum[];
  unit?: string;
  filled?: boolean;
}) {
  const width = 260;
  const height = 96;
  const points = trendPoints(data, width, height);
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const maxIndex = data.reduce(
    (best, item, index) => (item.value > data[best].value ? index : best),
    0
  );
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-24 w-full"
        role="img"
        aria-label="趋势图"
      >
        {filled && (
          <polygon
            points={areaPoints}
            fill="var(--chart-1)"
            fillOpacity={0.15}
          />
        )}
        <polyline
          points={points}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={maxIndex * (data.length > 1 ? width / (data.length - 1) : 0)}
          cy={
            height -
            ((data[maxIndex].value - Math.min(0, ...data.map((d) => d.value))) /
              Math.max(1, Math.max(...data.map((d) => d.value)) - Math.min(0, ...data.map((d) => d.value)))) *
              height
          }
          r={3.5}
          fill="var(--chart-1)"
          stroke="var(--card)"
          strokeWidth={1.5}
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">{data[0]?.label ?? ""}</span>
        <span className="tabular-nums">
          {data[maxIndex]?.value}
          {unit}
        </span>
        <span className="truncate">{data[data.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
}

/* ---------- Gauge：单一目标完成度（conic-gradient 圆弧） ---------- */

export function Gauge({
  value,
  label = "",
  unit = "",
  max = 100,
}: {
  value: number;
  label?: string;
  unit?: string;
  max?: number;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative size-32">
        <div
          className="size-32 rounded-full"
          style={{
            background: `conic-gradient(var(--chart-1) ${percent}%, var(--muted) ${percent}%)`,
          }}
        />
        <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-card">
          <span className="text-2xl font-semibold tabular-nums">
            {value}
            {unit}
          </span>
          <span className="max-w-24 truncate text-xs text-muted-foreground">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- StackedBar：分组构成（flex 分段条） ---------- */

export function StackedBar({
  data,
  series,
  unit = "",
}: {
  data: SeriesDatum[];
  series: SeriesSpec[];
  unit?: string;
}) {
  const totals = data.map((item) =>
    series.reduce((sum, s) => sum + Math.max(0, item.values[s.key] ?? 0), 0)
  );
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((item, rowIndex) => {
        const total = Math.max(1, totals[rowIndex] ?? 1);
        let cursor = 0;
        return (
          <div key={item.label} className="flex items-center gap-2.5">
            <span className="w-14 shrink-0 truncate text-right text-xs text-muted-foreground">
              {item.label}
            </span>
            <div className="flex h-4 flex-1 overflow-hidden rounded-full bg-muted">
              {series.map((s, index) => {
                const value = Math.max(0, item.values[s.key] ?? 0);
                cursor += value / total;
                if (value <= 0) return null;
                return (
                  <div
                    key={s.key}
                    className="h-full transition-[width] duration-300"
                    style={{
                      width: `${(value / total) * 100}%`,
                      background: colorAt(index),
                      marginLeft: index === 0 ? 0 : 1,
                    }}
                    title={`${s.label}: ${value}`}
                  />
                );
              })}
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">
              {totals[rowIndex] ?? 0}
              {unit}
            </span>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2.5 pt-0.5">
        {series.map((s, index) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              className="size-2 rounded-[2px]"
              style={{ background: colorAt(index) }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Scatter：两维关系（轻量 SVG 点阵） ---------- */

export function Scatter({
  data,
  xLabel = "X",
  yLabel = "Y",
  unit = "",
}: {
  data: ScatterDatum[];
  xLabel?: string;
  yLabel?: string;
  unit?: string;
}) {
  const width = 260;
  const height = 120;
  const xMax = Math.max(1, ...data.map((item) => item.x));
  const yMax = Math.max(1, ...data.map((item) => item.y));
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full" role="img" aria-label="散点图">
        {/* 网格线 */}
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction}>
            <line
              x1={0}
              x2={width}
              y1={height * fraction}
              y2={height * fraction}
              stroke="var(--border)"
              strokeDasharray="3 4"
            />
            <line
              x1={width * fraction}
              x2={width * fraction}
              y1={0}
              y2={height}
              stroke="var(--border)"
              strokeDasharray="3 4"
            />
          </g>
        ))}
        {data.map((item, index) => {
          const cx = (item.x / xMax) * width;
          const cy = height - (item.y / yMax) * height;
          return (
            <g key={item.label}>
              <circle
                cx={cx}
                cy={cy}
                r={5}
                fill={colorAt(index)}
                stroke="var(--card)"
                strokeWidth={1}
              >
                <title>{`${item.label}: ${item.x} / ${item.y}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{yLabel}</span>
        <span>{unit}</span>
        <span>{xLabel}</span>
      </div>
    </div>
  );
}
