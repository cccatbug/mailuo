import { describe, expect, it } from "vitest";
import { LayeredMemoryStore } from "./memory-store";

describe("layered long-term memory", () => {
  it("separates facts, preferences, project memory and inferred profile entries", () => {
    const memory = new LayeredMemoryStore();
    memory.upsert({ kind: "fact", key: "city", value: "上海", evidence: "用户明确说", confidence: 1 });
    memory.upsert({ kind: "preference", key: "language", value: "中文", evidence: "用户明确说", confidence: 1 });
    memory.upsert({ kind: "project", key: "stack", value: "Electron", projectId: "p1", evidence: "项目上下文", confidence: 1 });
    memory.upsert({ kind: "inference", key: "style", value: "偏好简洁", evidence: "多轮推断", confidence: 0.6 });

    expect(memory.context("p1")).toContain("明确事实");
    expect(memory.context("p1")).toContain("稳定偏好");
    expect(memory.context("p1")).toContain("项目记忆");
    expect(memory.context("p1")).toContain("推断画像（非事实）");
  });

  it("deduplicates matching entries and supersedes conflicting values", () => {
    const memory = new LayeredMemoryStore();
    const first = memory.upsert({ kind: "fact", key: "city", value: "北京", evidence: "旧消息", confidence: 1 });
    const duplicate = memory.upsert({ kind: "fact", key: "city", value: "北京", evidence: "再次确认", confidence: 1 });
    const replacement = memory.upsert({ kind: "fact", key: "city", value: "上海", evidence: "用户更正", confidence: 1 });

    expect(duplicate.id).toBe(first.id);
    expect(memory.list({ includeSuperseded: true }).find((entry) => entry.id === first.id)?.status).toBe("superseded");
    expect(replacement.value).toBe("上海");
  });

  it("can disable, edit, delete and rebuild memory", () => {
    const memory = new LayeredMemoryStore();
    const entry = memory.upsert({ kind: "preference", key: "tone", value: "简洁", evidence: "用户明确说", confidence: 1 });
    memory.update(entry.id, { value: "详细" });
    memory.enabled = false;

    expect(memory.context()).toBe("");
    memory.enabled = true;
    expect(memory.list()[0].value).toBe("详细");
    memory.remove(entry.id);
    memory.rebuild([]);
    expect(memory.list()).toEqual([]);
  });
});
