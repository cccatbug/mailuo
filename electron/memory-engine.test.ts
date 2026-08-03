import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractExplicitMemoryCue,
  MemoryEngine,
  type MemoryExtractor,
} from "./memory-engine";

async function fixture(extractor?: MemoryExtractor) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mailuo-memory-"));
  return {
    root,
    engine: new MemoryEngine({
      filePath: path.join(root, "memory-v1.json"),
      legacyPath: path.join(root, "memory.md"),
      extractor,
      now: () => "2026-08-03T10:00:00.000Z",
      createId: (() => {
        let id = 0;
        return () => `memory-${++id}`;
      })(),
    }),
  };
}

describe("MemoryEngine", () => {
  it("recognizes explicit remember commands without learning negated requests", () => {
    expect(extractExplicitMemoryCue("请记住：我习惯用中文交流")).toBe("我习惯用中文交流");
    expect(extractExplicitMemoryCue("记一下以后回答先给结论")).toBe("以后回答先给结论");
    expect(extractExplicitMemoryCue("不要记住这段临时信息")).toBeNull();
    expect(extractExplicitMemoryCue("你还记得我说过什么吗？")).toBeNull();
  });

  it("writes explicit memory immediately and reinforces repeated evidence", async () => {
    const { engine } = await fixture();

    await engine.remember({
      content: "我偏好简洁直接的回答",
      kind: "preference",
      scope: { type: "global" },
      source: "explicit",
    });
    await engine.remember({
      content: "我偏好简洁直接的回答",
      kind: "preference",
      scope: { type: "global" },
      source: "explicit",
    });

    const snapshot = await engine.snapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      content: "我偏好简洁直接的回答",
      confidence: 1,
      reinforcementCount: 2,
      status: "active",
    });
  });

  it("supersedes a conflicting preference but never lets inference replace a fact", async () => {
    const extractor: MemoryExtractor = {
      extract: async ({ userMessage }) => ({
        candidates:
          userMessage === "new preference"
            ? [{
                key: "reply-style",
                kind: "preference",
                content: "我偏好详细解释",
                scope: { type: "global" },
                confidence: 0.95,
                evidence: "用户要求详细解释",
              }]
            : [{
                key: "occupation",
                kind: "inference",
                content: "用户可能是设计师",
                scope: { type: "global" },
                confidence: 0.8,
                evidence: "谈到设计稿",
              }],
      }),
    };
    const { engine } = await fixture(extractor);
    await engine.remember({
      key: "reply-style",
      content: "我偏好简短回答",
      kind: "preference",
      scope: { type: "global" },
      source: "explicit",
    });
    await engine.remember({
      key: "occupation",
      content: "我是工程师",
      kind: "fact",
      scope: { type: "global" },
      source: "explicit",
    });

    await engine.learnTurn({
      requestId: "turn-1",
      conversationId: "chat-1",
      projectId: "project-a",
      userMessage: "new preference",
      assistantMessage: "好的",
    });
    await engine.learnTurn({
      requestId: "turn-2",
      conversationId: "chat-1",
      projectId: "project-a",
      userMessage: "weak inference",
      assistantMessage: "好的",
    });

    const snapshot = await engine.snapshot();
    expect(snapshot.entries.find((entry) => entry.content === "我偏好简短回答")?.status)
      .toBe("superseded");
    expect(snapshot.entries.find((entry) => entry.content === "我偏好详细解释")?.status)
      .toBe("active");
    expect(snapshot.entries.find((entry) => entry.content === "我是工程师")?.status)
      .toBe("active");
    expect(snapshot.entries.some((entry) => entry.content === "用户可能是设计师"))
      .toBe(false);
  });

  it("injects only global and current-project memories within the budget", async () => {
    const { engine } = await fixture();
    await engine.remember({ content: "全局偏好", kind: "preference", scope: { type: "global" }, source: "explicit" });
    await engine.remember({ content: "甲项目决策", kind: "project", scope: { type: "project", projectId: "a" }, source: "explicit" });
    await engine.remember({ content: "乙项目秘密", kind: "project", scope: { type: "project", projectId: "b" }, source: "explicit" });

    const context = await engine.context("a", 1_000);
    expect(context).toContain("全局偏好");
    expect(context).toContain("甲项目决策");
    expect(context).not.toContain("乙项目秘密");
  });

  it("keeps data while disabled and stops extraction and injection", async () => {
    let calls = 0;
    const { engine } = await fixture({
      extract: async () => {
        calls++;
        return { candidates: [] };
      },
    });
    await engine.remember({ content: "保留的数据", kind: "fact", scope: { type: "global" }, source: "explicit" });
    await engine.setEnabled(false);
    await engine.learnTurn({ requestId: "turn", conversationId: "chat", projectId: "p", userMessage: "hello", assistantMessage: "hi" });

    expect(calls).toBe(0);
    expect(await engine.context("p", 1_000)).toBe("");
    expect((await engine.snapshot()).entries).toHaveLength(1);
  });

  it("migrates legacy markdown once without deleting the source file", async () => {
    const { root, engine } = await fixture();
    const legacy = path.join(root, "memory.md");
    await writeFile(legacy, "# 小枢的长期记忆\n\n- (2026-01-02) 喜欢中文回答\n", "utf8");

    const snapshot = await engine.snapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      kind: "unclassified",
      content: "喜欢中文回答",
      status: "active",
    });
    expect(await readFile(legacy, "utf8")).toContain("喜欢中文回答");
    expect((await engine.snapshot()).entries).toHaveLength(1);
  });

  it("classifies migrated legacy entries when rebuilding", async () => {
    const { root, engine } = await fixture({
      extract: async () => ({ candidates: [] }),
      classify: async (entries) => ({
        candidates: entries.map((entry) => ({
          key: entry.key,
          kind: "preference",
          content: entry.content,
          scope: { type: "global" },
          confidence: 1,
          evidence: entry.content,
        })),
      }),
    });
    await writeFile(path.join(root, "memory.md"), "- 喜欢中文回答\n", "utf8");

    const rebuilt = await engine.rebuild();
    expect(rebuilt.entries).toHaveLength(1);
    expect(rebuilt.entries[0]).toMatchObject({
      kind: "preference",
      content: "喜欢中文回答",
      status: "active",
    });
  });

  it("treats user edits as confirmed and permanently deletes requested entries", async () => {
    const { engine } = await fixture();
    const remembered = await engine.remember({
      content: "可能喜欢长回答",
      kind: "inference",
      scope: { type: "global" },
      source: "conversation",
    });

    const updated = await engine.update(remembered.id, {
      content: "我喜欢有结论的简短回答",
      kind: "preference",
    });
    expect(updated).toMatchObject({
      kind: "preference",
      confidence: 1,
      content: "我喜欢有结论的简短回答",
    });
    expect(updated.evidence[updated.evidence.length - 1]?.source).toBe("user-edit");

    await expect(engine.delete(remembered.id)).resolves.toBe(true);
    await expect(engine.delete(remembered.id)).resolves.toBe(false);
    expect((await engine.snapshot()).entries).toEqual([]);
  });
});
