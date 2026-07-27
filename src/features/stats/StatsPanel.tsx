import { useMemo } from "react";
import { format, subDays } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Task } from "@/types";
import { PRIORITY_LABEL } from "@/types";
import { isBlocked } from "@/lib/deps";

const VIZ = {
  done: "var(--viz-done)",
  doing: "var(--viz-doing)",
  ready: "var(--viz-ready)",
  blocked: "var(--viz-blocked)",
} as const;

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className="mt-1 text-2xl font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/** 状态构成：单条水平堆叠条 + 图例（2px 间隔 + 直接标注计数） */
function StatusBar({
  segments,
}: {
  segments: { key: string; label: string; count: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  const visible = segments.filter((s) => s.count > 0);
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">暂无任务</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full">
        {visible.map((s) => (
          <div
            key={s.key}
            className="h-full min-w-1 first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
            title={`${s.label} ${s.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ background: s.color }}
            />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 单一度量的分类水平条（同一色相，数值直接标注） */
export function CategoryBars({
  items,
  color = "var(--chart-1)",
}: {
  items: { label: string; value: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex flex-col gap-2">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2.5">
          <span className="w-16 shrink-0 truncate text-right text-xs text-muted-foreground">
            {i.label}
          </span>
          <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(i.value / max) * 100}%`, background: color }}
            />
          </div>
          <span className="w-8 shrink-0 text-xs font-medium tabular-nums">
            {i.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">完成 {payload[0]?.value} 件</p>
    </div>
  );
}

export function StatsPanel({
  tasks,
  byId,
}: {
  tasks: Task[];
  byId: Map<string, Task>;
}) {
  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.status === "done");
    const doing = tasks.filter((t) => t.status === "doing");
    const blocked = tasks.filter(
      (t) => t.status === "todo" && isBlocked(t, byId)
    );
    const ready = tasks.filter(
      (t) => t.status === "todo" && !isBlocked(t, byId)
    );
    const today = format(new Date(), "yyyy-MM-dd");
    const overdue = tasks.filter(
      (t) => t.status !== "done" && t.dueDate && t.dueDate < today
    );

    // 近 14 天完成趋势
    const trend = Array.from({ length: 14 }, (_, i) => {
      const day = subDays(new Date(), 13 - i);
      const key = format(day, "yyyy-MM-dd");
      return {
        day: format(day, "M/d"),
        count: done.filter(
          (t) =>
            t.completedAt && format(t.completedAt, "yyyy-MM-dd") === key
        ).length,
      };
    });

    const priorities = (["high", "normal", "low"] as const).map((p) => ({
      label: PRIORITY_LABEL[p],
      value: tasks.filter((t) => t.status !== "done" && t.priority === p)
        .length,
    }));

    const tagCounts = new Map<string, number>();
    tasks.forEach((t) =>
      t.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1))
    );
    const tags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }));

    // 依赖结构
    const edges = tasks.reduce((s, t) => s + t.deps.length, 0);
    const roots = tasks.filter((t) => t.deps.length === 0).length;

    return {
      done: done.length,
      doing: doing.length,
      ready: ready.length,
      blocked: blocked.length,
      overdue: overdue.length,
      trend,
      priorities,
      tags,
      edges,
      roots,
    };
  }, [tasks, byId]);

  return (
    <div className="@container flex-1 overflow-y-auto px-6 py-4">
      <div className="mb-4 grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <StatTile label="全部任务" value={tasks.length} />
        <StatTile label="已完成" value={stats.done} accent={VIZ.done} />
        <StatTile label="受阻中" value={stats.blocked} accent={VIZ.blocked} />
        <StatTile
          label="已逾期"
          value={stats.overdue}
          accent={stats.overdue > 0 ? VIZ.blocked : undefined}
        />
      </div>

      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">状态构成</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBar
              segments={[
                { key: "done", label: "已完成", count: stats.done, color: VIZ.done },
                { key: "doing", label: "进行中", count: stats.doing, color: VIZ.doing },
                { key: "ready", label: "可着手", count: stats.ready, color: VIZ.ready },
                { key: "blocked", label: "受阻", count: stats.blocked, color: VIZ.blocked },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">近 14 天完成趋势</CardTitle>
          </CardHeader>
          <CardContent className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIZ.done} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={VIZ.done} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  interval={1}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  width={40}
                />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--border)" }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={VIZ.done}
                  strokeWidth={2}
                  fill="url(#trendFill)"
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">未完成任务 · 按优先级</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryBars items={stats.priorities} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">依赖结构</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">依赖关系数</span>
                <span className="font-medium tabular-nums">{stats.edges}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">可即刻着手的源头任务</span>
                <span className="font-medium tabular-nums">{stats.roots}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">平均每任务前置数</span>
                <span className="font-medium tabular-nums">
                  {tasks.length ? (stats.edges / tasks.length).toFixed(1) : "0"}
                </span>
              </p>
            </CardContent>
          </Card>
        </div>

        {stats.tags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">标签分布</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryBars items={stats.tags} color="var(--chart-2)" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
