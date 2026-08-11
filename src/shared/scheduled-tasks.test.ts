import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  describeScheduledTaskSchedule,
  formatNextRunCountdown,
  parseHHmm,
} from "./scheduled-tasks";

describe("scheduled-tasks 纯函数", () => {
  it("parseHHmm 只接受合法的 24 小时制时间", () => {
    expect(parseHHmm("09:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseHHmm("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseHHmm("24:00")).toBeNull();
    expect(parseHHmm("9:00")).toBeNull();
    expect(parseHHmm("12:60")).toBeNull();
    expect(parseHHmm("ab:cd")).toBeNull();
  });

  it("daily：当天时间未到取今天，已过取明天", () => {
    const from = new Date(2026, 7, 11, 8, 0); // 2026-08-11 08:00 周二
    const today = computeNextRunAt({ kind: "daily", time: "09:00" }, from);
    expect(new Date(today)).toEqual(new Date(2026, 7, 11, 9, 0));
    const tomorrow = computeNextRunAt({ kind: "daily", time: "07:30" }, from);
    expect(new Date(tomorrow)).toEqual(new Date(2026, 7, 12, 7, 30));
  });

  it("daily：恰好等于触发时刻时取下一次（严格大于）", () => {
    const from = new Date(2026, 7, 11, 9, 0);
    const next = computeNextRunAt({ kind: "daily", time: "09:00" }, from);
    expect(new Date(next)).toEqual(new Date(2026, 7, 12, 9, 0));
  });

  it("weekly：跳到下一个命中的星期", () => {
    const from = new Date(2026, 7, 11, 12, 0); // 周二
    // 只选周三（3）
    const next = computeNextRunAt(
      { kind: "weekly", time: "10:00", weekdays: [3] },
      from
    );
    expect(new Date(next)).toEqual(new Date(2026, 7, 12, 10, 0));
    // 只选周二（2）但今天时刻已过 → 下周二
    const nextWeek = computeNextRunAt(
      { kind: "weekly", time: "10:00", weekdays: [2] },
      from
    );
    expect(new Date(nextWeek)).toEqual(new Date(2026, 7, 18, 10, 0));
  });

  it("weekly：多个星期取最近一个", () => {
    const from = new Date(2026, 7, 11, 12, 0); // 周二中午
    const next = computeNextRunAt(
      { kind: "weekly", time: "09:00", weekdays: [1, 4, 7] },
      from
    );
    // 周四（13 日）最近
    expect(new Date(next)).toEqual(new Date(2026, 7, 13, 9, 0));
  });

  it("describeScheduledTaskSchedule 输出中文描述", () => {
    expect(describeScheduledTaskSchedule({ kind: "daily", time: "09:00" })).toBe(
      "每天 09:00"
    );
    expect(
      describeScheduledTaskSchedule({ kind: "weekly", time: "18:30", weekdays: [5, 1] })
    ).toBe("每周一、周五 18:30");
  });

  it("formatNextRunCountdown 分档显示", () => {
    const now = Date.now();
    expect(formatNextRunCountdown(null, now)).toBe("已停用");
    expect(formatNextRunCountdown(now - 1000, now)).toBe("即将运行");
    expect(formatNextRunCountdown(now + 30_000, now)).toBe("即将运行");
    expect(formatNextRunCountdown(now + 90_000, now)).toBe("1 分钟后");
    expect(formatNextRunCountdown(now + 2 * 3_600_000 + 15 * 60_000, now)).toBe(
      "2 小时 15 分后"
    );
    expect(formatNextRunCountdown(now + 3 * 3_600_000, now)).toBe("3 小时后");
    expect(formatNextRunCountdown(now + 2 * 86_400_000 + 3_600_000, now)).toBe(
      "2 天后"
    );
  });
});
