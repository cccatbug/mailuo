import { describe, expect, it } from "vitest";
import { assembleAiContext } from "./context-assembly";
import { createDefaultAiConfig } from "../src/shared/ai-config";

describe("assembleAiContext", () => {
  it("includes only sources enabled by the selected context profile and applies limits", () => {
    const profile = createDefaultAiConfig().contextProfiles[1];
    profile.appendSystemPrompt = "始终使用简体中文。";
    profile.sources.projectSnapshot.maxChars = 5;
    profile.sources.taskDetails.maxChars = 4;

    const result = assembleAiContext({
      profile,
      baseSystemPrompt: "不可覆盖的业务协议",
      userMessage: "开始",
      requestContext: {
        projectSnapshot: "123456789",
        taskDetails: "abcdef",
        conversationHistory: "不应出现的历史",
        skillNames: ["hidden"],
      },
      longTermMemory: "不应出现的记忆",
      skills: [{ name: "hidden", content: "不应出现的 skill" }],
    });

    expect(result.systemPrompt).toBe(
      "不可覆盖的业务协议\n\n# 应用配置追加指令\n始终使用简体中文。"
    );
    expect(result.message).toContain("12345");
    expect(result.message).toContain("abcd");
    expect(result.message).not.toContain("123456");
    expect(result.message).not.toContain("不应出现");
  });
});
