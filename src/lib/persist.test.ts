import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `bridge` is resolved at module load from `window.mailuo`, so each case installs
 * its own fake window before importing a fresh copy of the module.
 */
async function loadWith(loadState: () => Promise<string | null>) {
  vi.resetModules();
  vi.stubGlobal("window", { mailuo: { loadState } });
  const { loadPersisted } = await import("./persist");
  return loadPersisted();
}

const validState = JSON.stringify({
  version: 3,
  projects: [{ id: "p1", name: "脉络", color: "#000", createdAt: 1 }],
  tasks: [],
});

describe("loadPersisted", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports ok with migrated data when the state file reads back cleanly", async () => {
    const result = await loadWith(async () => validState);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.projects).toHaveLength(1);
      expect(result.data.version).toBe(3);
    }
  });

  it("reports missing only when there is genuinely no saved state", async () => {
    const result = await loadWith(async () => null);
    expect(result.kind).toBe("missing");
  });

  // 这三条是防数据丢失的核心：任何一条退化成 "missing"，store 就会 seed 示例
  // 数据并在 350ms 后原子覆盖用户的真实存档。
  it("reports error — never missing — when reading the state file throws", async () => {
    const result = await loadWith(async () => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });
    expect(result.kind).toBe("error");
  });

  it("reports error — never missing — when the state file is not valid JSON", async () => {
    const result = await loadWith(async () => "{ this is not json");
    expect(result.kind).toBe("error");
  });

  it("reports error — never missing — when the state file has an unusable shape", async () => {
    const result = await loadWith(async () => JSON.stringify({ nope: true }));
    expect(result.kind).toBe("error");
  });
});
