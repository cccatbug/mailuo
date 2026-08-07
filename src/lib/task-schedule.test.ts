import { describe, expect, it } from "vitest";
import {
  advanceRecurring,
  describeSchedule,
  effectiveDue,
  nextOccurrence,
  normalizeTaskSchedule,
  scheduleStatus,
  scheduleWithDue,
} from "./task-schedule";
import type { RecurrenceRule, TaskSchedule } from "@/types";

const rule = (patch: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  unit: "day",
  interval: 1,
  weekdays: [],
  monthDay: 0,
  ...patch,
});

describe("normalizeTaskSchedule", () => {
  it("把老存档的 dueDate 迁移成一次性安排", () => {
    expect(normalizeTaskSchedule(undefined, "2026-08-20")).toEqual({
      type: "once",
      start: null,
      due: "2026-08-20",
    });
  });

  it("没有 dueDate 的老任务保持不限期", () => {
    expect(normalizeTaskSchedule(undefined, null)).toEqual({ type: "none" });
  });

  it("丢弃晚于截止日的起始日", () => {
    expect(
      normalizeTaskSchedule({ type: "once", start: "2026-09-01", due: "2026-08-20" })
    ).toEqual({ type: "once", start: null, due: "2026-08-20" });
  });

  it("把越界的重复间隔收敛回合法范围", () => {
    const schedule = normalizeTaskSchedule({
      type: "recurring",
      start: "2026-08-01",
      due: "2026-08-01",
      rule: { unit: "day", interval: 0 },
    });
    expect(schedule).toMatchObject({ type: "recurring", rule: { interval: 1 } });
  });

  it("把不符合规则的 due 对齐到下一个合法日期", () => {
    // 隔天规则从 8/1 起：8/2 不是合法处理日，应对齐到 8/3
    const schedule = normalizeTaskSchedule({
      type: "recurring",
      start: "2026-08-01",
      due: "2026-08-02",
      rule: { unit: "day", interval: 2 },
    });
    expect(effectiveDue(schedule)).toBe("2026-08-03");
  });

  it("双周规则会跳过不在周期内的星期", () => {
    const schedule = normalizeTaskSchedule({
      type: "recurring",
      start: "2026-08-03",
      due: "2026-08-10",
      rule: { unit: "week", interval: 2, weekdays: [1] },
    });
    expect(effectiveDue(schedule)).toBe("2026-08-17");
  });

  it("每月指定日期会把本轮处理日对齐", () => {
    const schedule = normalizeTaskSchedule({
      type: "recurring",
      start: "2026-08-01",
      due: "2026-08-07",
      rule: { unit: "month", interval: 1, monthDay: 20 },
    });
    expect(effectiveDue(schedule)).toBe("2026-08-20");
  });

  it("结束日不会早于对齐后的本轮处理日", () => {
    const schedule = normalizeTaskSchedule({
      type: "recurring",
      start: "2026-08-01",
      due: "2026-08-07",
      until: "2026-08-10",
      rule: { unit: "month", interval: 1, monthDay: 20 },
    });
    expect(schedule).toMatchObject({ due: "2026-08-20", until: "2026-08-20" });
  });
});

describe("nextOccurrence", () => {
  it("隔天任务跳两天", () => {
    expect(nextOccurrence("2026-08-07", rule({ interval: 2 }))).toBe("2026-08-09");
  });

  it("跨月按自然日推进", () => {
    expect(nextOccurrence("2026-08-31", rule({ interval: 1 }))).toBe("2026-09-01");
  });

  it("指定星期时先走本周剩下的日子", () => {
    // 2026-08-07 是周五；规则是周一/周三/周五
    expect(
      nextOccurrence("2026-08-07", rule({ unit: "week", weekdays: [1, 3, 5] }))
    ).toBe("2026-08-10");
  });

  it("每周不指定星期时整周推进", () => {
    expect(nextOccurrence("2026-08-07", rule({ unit: "week", interval: 2 }))).toBe(
      "2026-08-21"
    );
  });

  it("每月 31 日在短月落到当月最后一天", () => {
    expect(
      nextOccurrence("2026-01-31", rule({ unit: "month", monthDay: 31 }))
    ).toBe("2026-02-28");
  });

  it("沿用起始日的月度任务经过短月后不会漂移", () => {
    expect(
      nextOccurrence(
        "2026-02-28",
        rule({ unit: "month", monthDay: 0 }),
        "2026-01-31"
      )
    ).toBe("2026-03-31");
  });
});

describe("advanceRecurring", () => {
  const base = {
    type: "recurring",
    start: "2026-08-01",
    due: "2026-08-07",
    rule: rule({ interval: 2 }),
    doneCount: 1,
    lastDone: "2026-08-05",
    until: null,
  } satisfies Extract<TaskSchedule, { type: "recurring" }>;

  it("完成一轮后滚到下一轮并记账", () => {
    const next = advanceRecurring(base, "2026-08-07");
    expect(next).toMatchObject({
      type: "recurring",
      due: "2026-08-09",
      doneCount: 2,
      lastDone: "2026-08-07",
    });
  });

  it("越过结束日期后退化为一次性安排", () => {
    const next = advanceRecurring({ ...base, until: "2026-08-08" }, "2026-08-07");
    expect(next).toEqual({ type: "once", start: "2026-08-01", due: "2026-08-07" });
  });
});

describe("scheduleStatus", () => {
  const due = (date: string): TaskSchedule => ({ type: "once", start: null, due: date });

  it("过去的日期算逾期", () => {
    expect(scheduleStatus(due("2026-08-01"), "2026-08-07")).toMatchObject({
      state: "overdue",
      days: -6,
    });
  });

  it("当天算今天", () => {
    expect(scheduleStatus(due("2026-08-07"), "2026-08-07").state).toBe("today");
  });

  it("一周内算即将", () => {
    expect(scheduleStatus(due("2026-08-12"), "2026-08-07").state).toBe("soon");
  });

  it("更远的日期算以后", () => {
    expect(scheduleStatus(due("2026-09-12"), "2026-08-07").state).toBe("later");
  });

  it("起始日未到的任务标记为未开始", () => {
    expect(
      scheduleStatus({ type: "once", start: "2026-08-10", due: "2026-08-20" }, "2026-08-07")
    ).toMatchObject({ notStarted: true });
  });
});

describe("scheduleWithDue", () => {
  it("清空日期回到不限期", () => {
    expect(scheduleWithDue({ type: "once", start: null, due: "2026-08-07" }, null)).toEqual({
      type: "none",
    });
  });

  it("改日期时保留重复规则", () => {
    const recurring: TaskSchedule = {
      type: "recurring",
      start: "2026-08-01",
      due: "2026-08-07",
      rule: rule({ interval: 2 }),
      doneCount: 0,
      lastDone: null,
      until: null,
    };
    expect(scheduleWithDue(recurring, "2026-08-11")).toMatchObject({
      type: "recurring",
      due: "2026-08-11",
      rule: { interval: 2 },
    });
  });
});

describe("describeSchedule", () => {
  it("描述隔天规则", () => {
    expect(
      describeSchedule({
        type: "recurring",
        start: "2026-08-01",
        due: "2026-08-09",
        rule: rule({ interval: 2 }),
        doneCount: 0,
        lastDone: null,
        until: null,
      })
    ).toBe("隔天 · 下次 08/09");
  });

  it("描述带起始日的一次性安排", () => {
    expect(
      describeSchedule({ type: "once", start: "2026-08-01", due: "2026-08-20" })
    ).toBe("08/01 → 08/20");
  });
});
