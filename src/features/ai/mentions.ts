import type { Task } from "@/types";
import type {
  AssistantMention,
  BrowserTabInfo,
  BrowserTabMention,
  TaskMention,
} from "@/shared/browser";

export interface MentionCandidate {
  group: "task" | "browser";
  mention: AssistantMention;
  searchText: string;
}

export function mentionKey(mention: AssistantMention): string {
  return mention.kind === "task"
    ? `task:${mention.taskId}`
    : `browser:${mention.tabId}`;
}

export function mentionLabel(mention: AssistantMention): string {
  return mention.title || (mention.kind === "task" ? "未命名任务" : "浏览器");
}

export function mentionInputToken(mention: AssistantMention): string {
  return `@${mentionLabel(mention)}`;
}

export function buildMentionCandidates(
  tasks: Task[],
  tabs: BrowserTabInfo[],
  selected: AssistantMention[],
  query: string
): MentionCandidate[] {
  const selectedKeys = new Set(selected.map(mentionKey));
  const needle = query.trim().toLowerCase();
  const taskCandidates: MentionCandidate[] = tasks.map((task) => {
    const mention: TaskMention = {
      kind: "task",
      taskId: task.id,
      title: task.title,
    };
    return {
      group: "task",
      mention,
      searchText: `${task.title} ${task.notes} ${task.tags.join(" ")}`,
    };
  });
  const browserCandidates: MentionCandidate[] = tabs.map((tab) => {
    const mention: BrowserTabMention = {
      kind: "browser-tab",
      tabId: tab.id,
      title: tab.title || "浏览器",
      url: tab.url,
    };
    let domain = "";
    try {
      domain = new URL(tab.url).hostname;
    } catch {
      domain = tab.url;
    }
    return {
      group: "browser",
      mention,
      searchText: `${tab.title} ${tab.url} ${domain}`,
    };
  });
  return [...taskCandidates, ...browserCandidates]
    .filter((candidate) => !selectedKeys.has(mentionKey(candidate.mention)))
    .filter(
      (candidate) =>
        !needle || candidate.searchText.toLowerCase().includes(needle)
    )
    .slice(0, 12);
}
