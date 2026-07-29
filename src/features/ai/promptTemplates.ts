export type PromptKind = "project-plan" | "task-breakdown" | "dependency-suggest" | "notes-polish";

export interface PromptTemplate {
  id: string;
  name: string;
  kind: PromptKind;
  prompt: string;
  tags: string[];
  isDefault: boolean;
  updatedAt: number;
}

const KEY = "mailuo-ai-prompt-templates";
const defaults: PromptTemplate[] = [
  { id: "default-plan", name: "标准项目规划", kind: "project-plan", prompt: "根据目标生成可执行任务，明确验收标准和必要依赖。", tags: ["规划"], isDefault: true, updatedAt: 0 },
  { id: "default-breakdown", name: "可执行拆解", kind: "task-breakdown", prompt: "拆解为可以直接开始、粒度均衡的前置子任务。", tags: ["拆解"], isDefault: true, updatedAt: 0 },
  { id: "default-deps", name: "高置信依赖", kind: "dependency-suggest", prompt: "只建议高置信度、会影响执行顺序的缺失依赖。", tags: ["依赖"], isDefault: true, updatedAt: 0 },
  { id: "default-polish", name: "简洁可执行", kind: "notes-polish", prompt: "保留原意，改写得简洁、清晰、可执行，补充必要的验收标准。", tags: ["润色"], isDefault: true, updatedAt: 0 },
];

export function loadPromptTemplates(): PromptTemplate[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(stored) && stored.length ? stored : defaults;
  } catch {
    return defaults;
  }
}

export function savePromptTemplates(items: PromptTemplate[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("mailuo-prompt-templates-changed"));
}

export function defaultPrompt(kind: PromptKind): string {
  const items = loadPromptTemplates().filter((item) => item.kind === kind);
  return (items.find((item) => item.isDefault) ?? items[0])?.prompt ?? "";
}

