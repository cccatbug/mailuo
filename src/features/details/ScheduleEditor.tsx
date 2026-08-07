import { useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays, CalendarRange, Infinity as InfinityIcon, Repeat, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RecurrenceRule, RecurrenceUnit, ScheduleType, TaskSchedule } from "@/types";
import { RECURRENCE_UNIT_LABEL, WEEKDAY_LABEL } from "@/types";
import {
  RECURRENCE_PRESETS,
  addDaysISO,
  describeRule,
  fromISODate,
  isoWeekday,
  nextOccurrence,
  scheduleStatus,
  todayISO,
} from "@/lib/task-schedule";

const DEFAULT_RULE: RecurrenceRule = {
  unit: "day",
  interval: 1,
  weekdays: [],
  monthDay: 0,
};

const STATE_TONE: Record<string, string> = {
  overdue: "text-destructive",
  today: "text-primary",
  tomorrow: "text-status-doing",
};

/** 日期选择按钮：一个 popover 日历 + 可选的清除 */
function DateButton({
  value,
  placeholder,
  onChange,
  onClear,
  className,
}: {
  value: string | null;
  placeholder: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? fromISODate(value) : undefined;
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 justify-start font-normal"
          >
            <CalendarDays data-icon="inline-start" />
            <span className="truncate">
              {selected
                ? format(selected, "yyyy年M月d日 EEE", { locale: zhCN })
                : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={zhCN}
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (date) onChange(format(date, "yyyy-MM-dd"));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {onClear && value && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="清除日期"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onClear}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

function QuickDates({ onPick }: { onPick: (value: string) => void }) {
  const today = todayISO();
  const options: { label: string; value: string }[] = [
    { label: "今天", value: today },
    { label: "明天", value: addDaysISO(today, 1) },
    { label: "本周末", value: addDaysISO(today, (6 - isoWeekday(today) + 7) % 7 || 7) },
    { label: "下周", value: addDaysISO(today, 7) },
    { label: "下个月", value: addDaysISO(today, 30) },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.label}
          className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RuleEditor({
  rule,
  onChange,
  anchor,
}: {
  rule: RecurrenceRule;
  onChange: (rule: RecurrenceRule) => void;
  anchor: string;
}) {
  const activePreset = RECURRENCE_PRESETS.find(
    (preset) =>
      preset.rule.unit === rule.unit &&
      preset.rule.interval === rule.interval &&
      preset.rule.weekdays.join() === rule.weekdays.join() &&
      preset.rule.monthDay === rule.monthDay
  );

  const toggleWeekday = (day: number) => {
    const weekdays = rule.weekdays.includes(day)
      ? rule.weekdays.filter((value) => value !== day)
      : [...rule.weekdays, day].sort((a, b) => a - b);
    onChange({ ...rule, weekdays });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1">
        {RECURRENCE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              activePreset?.key === preset.key
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-dashed text-muted-foreground hover:border-primary/50 hover:text-foreground"
            )}
            onClick={() => onChange({ ...preset.rule })}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0">每</span>
        <Input
          type="number"
          min={1}
          max={365}
          key={`interval-${rule.interval}`}
          defaultValue={rule.interval}
          className="h-7 w-16 text-xs tabular-nums"
          onBlur={(event) => {
            const interval = Number(event.currentTarget.value);
            onChange({
              ...rule,
              interval: Number.isFinite(interval)
                ? Math.min(365, Math.max(1, Math.round(interval)))
                : 1,
            });
          }}
        />
        <Select
          value={rule.unit}
          onValueChange={(unit) =>
            onChange({
              ...rule,
              unit: unit as RecurrenceUnit,
              weekdays: unit === "week" ? rule.weekdays : [],
              monthDay: unit === "month" ? rule.monthDay : 0,
            })
          }
        >
          <SelectTrigger size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["day", "week", "month"] as RecurrenceUnit[]).map((unit) => (
              <SelectItem key={unit} value={unit}>
                {RECURRENCE_UNIT_LABEL[unit]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="shrink-0">处理一次</span>
      </div>

      {rule.unit === "week" && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">
            指定星期（不选则沿用起始日）
          </span>
          <div className="flex gap-1">
            {WEEKDAY_LABEL.map((label, index) => {
              const day = index + 1;
              const active = rule.weekdays.includes(day);
              return (
                <button
                  key={label}
                  aria-pressed={active}
                  className={cn(
                    "size-7 rounded-md border text-[11px] transition-colors",
                    active
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                  onClick={() => toggleWeekday(day)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rule.unit === "month" && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          每月第
          <Input
            type="number"
            min={0}
            max={31}
            key={`month-day-${rule.monthDay}`}
            defaultValue={rule.monthDay}
            className="h-7 w-16 text-xs tabular-nums"
            onBlur={(event) => {
              const day = Number(event.currentTarget.value);
              onChange({
                ...rule,
                monthDay: Number.isFinite(day)
                  ? Math.min(31, Math.max(0, Math.round(day)))
                  : 0,
              });
            }}
          />
          天（0 = 沿用起始日 {fromISODate(anchor).getDate()} 号）
        </label>
      )}
    </div>
  );
}

export function ScheduleEditor({
  schedule,
  onChange,
  allowRecurring = true,
}: {
  schedule: TaskSchedule;
  onChange: (schedule: TaskSchedule) => void;
  /** 进度/打卡已有自己的完成周期，不再叠加一个会自动重置的定期安排 */
  allowRecurring?: boolean;
}) {
  const today = todayISO();
  const status = scheduleStatus(schedule, today);

  const setType = (type: ScheduleType) => {
    if (type === schedule.type) return;
    if (type === "none") return onChange({ type: "none" });
    const due = schedule.type === "none" ? today : schedule.due;
    if (type === "once") {
      onChange({
        type: "once",
        start: schedule.type === "recurring" ? schedule.start : null,
        due,
      });
      return;
    }
    onChange({
      type: "recurring",
      start: due,
      due,
      rule: DEFAULT_RULE,
      doneCount: 0,
      lastDone: null,
      until: null,
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <ToggleGroup
        type="single"
        variant="outline"
        className="w-full"
        value={schedule.type}
        onValueChange={(value) => value && setType(value as ScheduleType)}
      >
        <ToggleGroupItem value="none" className="flex-1">
          <InfinityIcon />
          不限期
        </ToggleGroupItem>
        <ToggleGroupItem value="once" className="flex-1">
          <CalendarRange />
          截止
        </ToggleGroupItem>
        <ToggleGroupItem
          value="recurring"
          className="flex-1"
          disabled={!allowRecurring}
        >
          <Repeat />
          定期
        </ToggleGroupItem>
      </ToggleGroup>

      {!allowRecurring && (
        <p className="text-xs text-muted-foreground">
          进度与打卡任务由目标值决定完成状态；可以设截止日期，但不叠加定期轮次。
        </p>
      )}

      {schedule.type === "none" && (
        <p className="text-xs text-muted-foreground">
          不设日期，这件事不会出现在主页的今日待办里。
        </p>
      )}

      {schedule.type === "once" && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
            截止日期
            <DateButton
              value={schedule.due}
              placeholder="设定截止日期"
              onChange={(due) =>
                onChange({
                  type: "once",
                  due,
                  start: schedule.start && schedule.start <= due ? schedule.start : null,
                })
              }
            />
          </label>
          <QuickDates
            onPick={(due) =>
              onChange({
                type: "once",
                due,
                start: schedule.start && schedule.start <= due ? schedule.start : null,
              })
            }
          />
          <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
            起始日期（可选，用来标记什么时候可以动手）
            <DateButton
              value={schedule.start}
              placeholder="不设起始日"
              onChange={(start) =>
                onChange({
                  ...schedule,
                  start: start <= schedule.due ? start : schedule.due,
                })
              }
              onClear={() => onChange({ ...schedule, start: null })}
            />
          </label>
          <p
            className={cn(
              "text-[11px] tabular-nums",
              STATE_TONE[status.state] ?? "text-muted-foreground"
            )}
          >
            {status.state === "overdue"
              ? `已逾期 ${-status.days} 天`
              : status.state === "today"
                ? "今天到期"
                : `还有 ${status.days} 天`}
            {status.notStarted && schedule.start
              ? ` · ${schedule.start.slice(5).replace("-", "/")} 起可着手`
              : ""}
          </p>
        </div>
      )}

      {schedule.type === "recurring" && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
          <RuleEditor
            rule={schedule.rule}
            anchor={schedule.start}
            onChange={(rule) =>
              onChange({
                ...schedule,
                rule,
                // 规则一改，本轮处理日就得重新落到合法日期上
                due: nextOccurrence(
                  addDaysISO(schedule.due, -1),
                  rule,
                  schedule.start
                ),
              })
            }
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              下次处理
              <DateButton
                value={schedule.due}
                placeholder="选择日期"
                onChange={(due) =>
                  onChange({
                    ...schedule,
                    due,
                    start: schedule.start <= due ? schedule.start : due,
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              结束于（可选）
              <DateButton
                value={schedule.until}
                placeholder="一直重复"
                onChange={(until) =>
                  onChange({ ...schedule, until: until >= schedule.due ? until : schedule.due })
                }
                onClear={() => onChange({ ...schedule, until: null })}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              {describeRule(schedule.rule)} · 已完成 {schedule.doneCount} 轮
              {schedule.lastDone
                ? ` · 上次 ${schedule.lastDone.slice(5).replace("-", "/")}`
                : ""}
            </span>
            <span
              className={cn("shrink-0 tabular-nums", STATE_TONE[status.state])}
            >
              {status.state === "overdue"
                ? `逾期 ${-status.days} 天`
                : status.state === "today"
                  ? "今天"
                  : `${status.days} 天后`}
            </span>
          </div>

          <p className="text-[10px] text-muted-foreground">
            标记完成会记下这一轮，并自动把处理日推到{" "}
            {nextOccurrence(schedule.due, schedule.rule, schedule.start)
              .slice(5)
              .replace("-", "/")}。
          </p>
        </div>
      )}
    </div>
  );
}
