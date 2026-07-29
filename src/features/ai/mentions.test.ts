import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import type { BrowserTabInfo } from "@/shared/browser";
import { buildMentionCandidates } from "./mentions";

const task = {
  id: "task-1",
  projectId: "project",
  title: "发布说明",
  notes: "",
  status: "todo",
  priority: "normal",
  dueDate: null,
  tags: [],
  deps: [],
  createdAt: 1,
  completedAt: null,
} satisfies Task;

const tab = {
  id: "browser:docs",
  title: "Release docs",
  url: "https://docs.example.com/release",
  active: true,
  loading: false,
  canGoBack: false,
  canGoForward: false,
} satisfies BrowserTabInfo;

describe("buildMentionCandidates", () => {
  it("groups matching tasks and browser tabs while excluding selected refs", () => {
    const candidates = buildMentionCandidates(
      [task],
      [tab],
      [],
      "release"
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        group: "browser",
        mention: expect.objectContaining({
          kind: "browser-tab",
          tabId: "browser:docs",
        }),
      }),
    ]);
    expect(
      buildMentionCandidates([task], [tab], [candidates[0].mention], "release")
    ).toEqual([]);
  });
});
