import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiRuntimeManager } from "./ai-runtime";
import { AiConfigStore } from "./ai-config-store";
import {
  AI_USE_CASES,
  createDefaultAiConfig,
  runtimeProviderId,
  type AiConfigV1,
} from "../src/shared/ai-config";

const roots: string[] = [];
const originalOpenAiKey = process.env.OPENAI_API_KEY;

async function setup(): Promise<{
  root: string;
  store: AiConfigStore;
  manager: AiRuntimeManager;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mailuo-ai-runtime-"));
  roots.push(root);
  const store = new AiConfigStore(root);
  return { root, store, manager: new AiRuntimeManager(store) };
}

afterEach(async () => {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

function configured(): AiConfigV1 {
  const config = createDefaultAiConfig();
  const providerId = "a9173512-b61c-4b13-bfe2-f42ea09575e1";
  config.providers.push({
    id: providerId,
    name: "Local Gateway",
    preset: "custom",
    enabled: true,
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-completions",
    authMode: "none",
    authHeader: false,
    headers: {},
    secretHeaderNames: [],
    discovery: { adapter: "manual" },
  });
  config.models.push(
    {
      providerId,
      modelId: "active-model",
      name: "Active",
      enabled: true,
      input: ["text"],
      reasoning: true,
      contextWindow: 32768,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      metadataSource: "manual",
      remoteStatus: "unknown",
    },
    {
      providerId,
      modelId: "disabled-model",
      name: "Disabled",
      enabled: false,
      input: ["text"],
      reasoning: false,
      contextWindow: 32768,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      metadataSource: "manual",
      remoteStatus: "unknown",
    }
  );
  config.routes.assistant = {
    model: { providerId, modelId: "active-model" },
    thinkingLevel: "high",
    contextProfileId: config.contextProfiles[0].id,
  };
  return config;
}

describe("AiRuntimeManager", () => {
  it("registers and resolves only explicitly enabled application models", async () => {
    const { store, manager } = await setup();
    await store.save(configured(), null);
    await manager.reload();

    expect(await manager.listEnabledModels()).toEqual([
      {
        providerId: "a9173512-b61c-4b13-bfe2-f42ea09575e1",
        providerName: "Local Gateway",
        modelId: "active-model",
        name: "Active",
        reasoning: true,
        input: ["text"],
      },
    ]);
    const resolved = await manager.resolve("assistant");
    expect(resolved.runtimeProviderId).toBe(
      runtimeProviderId("a9173512-b61c-4b13-bfe2-f42ea09575e1")
    );
    expect(resolved.model.id).toBe("active-model");
    expect(resolved.thinkingLevel).toBe("high");
    expect(resolved.contextProfile.name).toBe("助手完整");
  });

  it("does not fall back to pi built-ins or ambient provider credentials", async () => {
    process.env.OPENAI_API_KEY = "ambient-key-that-must-not-be-used";
    const { store, manager } = await setup();
    await store.save(createDefaultAiConfig(), null);
    await manager.reload();

    expect(await manager.listEnabledModels()).toEqual([]);
    await expect(manager.resolve("assistant")).rejects.toThrow(
      "用途「assistant」尚未配置模型"
    );
  });

  it("requires credentials for configured routes instead of silently changing models", async () => {
    const { store, manager } = await setup();
    const config = configured();
    config.providers[0].authMode = "api-key";
    config.providers[0].authHeader = true;
    await store.save(config, null);
    await manager.reload();

    await expect(manager.resolve("assistant")).rejects.toThrow(
      "Provider「Local Gateway」缺少凭据"
    );
  });

  it("resolves every application use case through its explicit route", async () => {
    const { store, manager } = await setup();
    const config = configured();
    const model = config.routes.assistant.model;
    if (!model) throw new Error("test model missing");
    for (const useCase of AI_USE_CASES) {
      config.routes[useCase] = {
        model,
        thinkingLevel: useCase === "assistant" ? "high" : "off",
        contextProfileId:
          useCase === "assistant"
            ? config.contextProfiles[0].id
            : config.contextProfiles[1].id,
      };
    }
    await store.save(config, null);
    await manager.reload();

    expect(await manager.routeStatuses()).toEqual(
      AI_USE_CASES.map((useCase) => ({
        useCase,
        ready: true,
        model: {
          providerId: "a9173512-b61c-4b13-bfe2-f42ea09575e1",
          providerName: "Local Gateway",
          modelId: "active-model",
          name: "Active",
          reasoning: true,
          input: ["text"],
        },
      }))
    );
  });
});
