import type {
  AiContextProfile,
  AiRequestContext,
} from "../src/shared/ai-config";

export interface ContextSkill {
  name: string;
  content: string;
}

interface AssembleAiContextInput {
  profile: AiContextProfile;
  baseSystemPrompt: string;
  userMessage: string;
  requestContext?: AiRequestContext;
  longTermMemory?: string;
  skills?: ContextSkill[];
}

function clipped(value: string | undefined, maxChars: number): string {
  if (!value || maxChars <= 0) return "";
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}\n…（已按上下文配置截断）`;
}

export function assembleAiContext({
  profile,
  baseSystemPrompt,
  userMessage,
  requestContext = {},
  longTermMemory = "",
  skills = [],
}: AssembleAiContextInput): {
  systemPrompt: string;
  message: string;
} {
  const blocks: string[] = [];
  const add = (
    title: string,
    value: string | undefined,
    source: { enabled: boolean; maxChars: number }
  ) => {
    if (!source.enabled) return;
    const content = clipped(value, source.maxChars);
    if (content) blocks.push(`【${title}】\n${content}`);
  };

  add(
    "项目快照",
    requestContext.projectSnapshot,
    profile.sources.projectSnapshot
  );
  add("任务详情", requestContext.taskDetails, profile.sources.taskDetails);
  add("长期记忆", longTermMemory, profile.sources.longTermMemory);
  add(
    "此前对话摘录",
    requestContext.conversationHistory,
    profile.sources.conversationHistory
  );

  if (profile.sources.skills.enabled && requestContext.skillNames?.length) {
    const selected = new Set(requestContext.skillNames);
    const content = skills
      .filter((skill) => selected.has(skill.name))
      .map((skill) => `<skill name="${skill.name}">\n${skill.content}\n</skill>`)
      .join("\n\n");
    const skillContext = clipped(content, profile.sources.skills.maxChars);
    if (skillContext) blocks.push(`【用户选择的 Skills】\n${skillContext}`);
  }

  const append = profile.appendSystemPrompt.trim();
  return {
    systemPrompt: append
      ? `${baseSystemPrompt}\n\n# 应用配置追加指令\n${append}`
      : baseSystemPrompt,
    message: [...blocks, userMessage].filter(Boolean).join("\n\n"),
  };
}
