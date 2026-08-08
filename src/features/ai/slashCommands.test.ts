import { describe, expect, it } from "vitest";
import { buildSlashCandidates } from "./slashCommands";

const capabilities = {
  commands: [
    { name: "review", description: "Review changes", source: "extension" as const, sourceLabel: "extension:review" },
    { name: "skill:release", description: "Prepare a release", source: "skill" as const, sourceLabel: "release/SKILL.md" },
  ],
};

describe("buildSlashCandidates", () => {
  it("lists every Pi runtime command directly", () => {
    expect(buildSlashCandidates(capabilities, "")).toEqual([
      expect.objectContaining({ name: "review", source: "extension" }),
      expect.objectContaining({ name: "skill:release", source: "skill" }),
    ]);
  });

  it("filters names and descriptions without restoring legacy shortcuts", () => {
    expect(buildSlashCandidates(capabilities, "release").map((item) => item.name)).toEqual(["skill:release"]);
    expect(buildSlashCandidates(capabilities, "周报")).toEqual([]);
  });
});
